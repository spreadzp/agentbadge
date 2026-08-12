/**
 * UI routes — HTMX dashboard + live passport feed + agent directory + search + stats + audit.
 * (SLICE-4-1, SLICE-4-2, SLICE-4-3, hackathon-flow.md:122-132)
 *
 * GET /                              — full HTML dashboard page
 * GET /ui/feed                       — HTML fragment with recent passports (polled every 5s)
 * GET /ui/passport/:tokenId/:serial  — passport detail fragment
 * GET /ui/agents                     — agent directory fragment (polled every 10s)
 * GET /ui/agents/:accountId          — agent profile mini-landing page
 * GET /ui/search?q=                  — search form + results fragment
 * GET /ui/stats                      — stats counters fragment (polled every 10s)
 * GET /ui/audit                      — audit stream fragment (polled every 5s)
 * GET /ui/catalog                    — tier pricing cards fragment
 * GET /ui/passport/request           — passport request form page
 * GET /ui/help                       — help & overview page (site map, agent guide link, MCP tools)
 * GET /ui/a2a/inbox                  — A2A inbox fragment (polled every 10s)
 * GET /ui/a2a/outbox                 — A2A outbox page (polled every 10s)
 * GET /ui/conversation               — bidirectional conversation view (polled every 10s)
 * GET /ui/market/tasks               — marketplace task board fragment (polled every 10s)
 * GET /ui/market/tasks/:id           — task details fragment
 */

import { Hono, type Context } from "hono";
import { html, raw } from "hono/html";
import { Dashboard, type DashboardSsrData } from "../../views/dashboard";
import { FeedFragment, PassportCard } from "../../views/feed-fragment";
import { PassportDetailCard, PassportNotFound } from "../../views/passport-card";
import { AgentsFragment, AgentRow, type AgentWithActive } from "../../views/agents-fragment";
import { SearchForm, SearchResults, parseSearchQuery } from "../../views/search-fragment";
import { StatsFragment } from "../../views/stats-fragment";
import { LandingStatsFragment } from "../../views/landing/landing-stats-fragment";
import { AuditFragment, AuditRow, type AuditEventWithTx } from "../../views/audit-fragment";
import { CatalogFragment } from "../../views/catalog-fragment";
import { PassportRequestForm } from "../../views/passport-request-form";
import { HelpPage } from "../../views/help-page";
import { MedicalDemoPage } from "../../views/medical-demo-page";
import { A2AInboxFragment } from "../../views/a2a-fragment";
import { MarketplaceTaskBoardFragment, TaskDetailsFragment, TaskMessagesFragment, EscrowPanel } from "../../views/marketplace-fragment";
import { AgentProfilePage } from "../../views/agent-profile";
import { Layout } from "../../views/layout";
import { PageHeader } from "../../views/page-header";
import { PageTitles } from "../lib/page-titles";
import { PageMeta as PageMetaRegistry, type PageMeta } from "../lib/page-meta";
import { passportLd, jobPostingLd, profilePageLd, defaultCoreSchemas } from "../lib/json-ld";
import { getAcceptedFormat } from "../lib/content-negotiation";
import { getCatalog, getNftsForToken, getNftInfo, getTopicMessages, isValidA2ADid, prepareA2ATopicMessage, signTransactionBytes, submitSignedTopicMessage } from "@agentgate-hedera/hedera-core";
import type { NftInfo, Tier, Capability, AuditMessage, CachedA2AMessage } from "@agentgate-hedera/hedera-core";
import { retrieveMetadata, getAll, type DirectoryEntry } from "@agentgate-hedera/passport";
import { getMessagesByTo as getA2AMessagesByTo, getMessagesByFrom as getA2AMessagesByFrom, getConversation as getA2AConversation, a2aUpsert as a2aCacheUpsert } from "@agentgate-hedera/passport";
import { listTasks as marketListTasks, marketGet } from "@agentgate-hedera/passport";
import type { PassportInfo } from "@agentgate-hedera/passport";

/** Check if request is from HTMX (partial) vs direct browser access (full page). */
function isHtmxRequest(c: Context): boolean {
  return c.req.header("HX-Request") === "true";
}

/** Wrap fragment in Layout if direct browser access, return raw if HTMX. */
function wrapFragment(c: Context, fragment: string, title?: string, meta?: PageMeta, jsonLd?: object[]): string {
  return isHtmxRequest(c) ? fragment : Layout(fragment, title, meta, jsonLd, true).toString();
}

export const uiRoutes = new Hono();

/**
 * GET /dashboard — dashboard page (full HTML).
 *
 * (SLICE-19-2: moved from GET / to GET /dashboard so that
 * GET / can serve the landing page from landing.ts)
 */
uiRoutes.get("/dashboard", async (c) => {
  const tokenId = process.env.PASSPORT_TOKEN_ID;
  const auditTopicId = process.env.AUDIT_TOPIC_ID;

  const ssrData: DashboardSsrData = {};

  // Fetch stats data (same service calls as /ui/stats)
  if (tokenId) {
    try {
      const nfts = await getNftsForToken(tokenId);
      const totalIssued = nfts.length;
      const activeCount = nfts.filter((n: NftInfo) => !n.deleted).length;
      const revokedCount = nfts.filter((n: NftInfo) => n.deleted).length;

      let totalUpgrades = 0;
      if (auditTopicId) {
        try {
          const messages = await getTopicMessages(auditTopicId);
          for (const msg of messages) {
            try {
              const parsed = JSON.parse(msg.message) as Record<string, unknown>;
              if (parsed.type === "tier_upgraded") totalUpgrades++;
            } catch {
              // Skip malformed
            }
          }
        } catch {
          // Audit topic fetch failed — skip
        }
      }

      const byTier: Record<Tier, number> = { bronze: 0, silver: 0, gold: 0, platinum: 0 };
      const activeNfts = nfts.filter((n: NftInfo) => !n.deleted);
      await Promise.all(
        activeNfts.map(async (nft: NftInfo) => {
          if (!nft.metadata) return;
          try {
            const metadata = await retrieveMetadata(nft.metadata);
            if (metadata.tier) {
              byTier[metadata.tier]++;
            }
          } catch {
            // IPFS fetch failed — skip
          }
        }),
      );

      ssrData.stats = { totalIssued, totalUpgrades, activeCount, revokedCount, byTier };
      ssrData.feed = nfts.sort((a: NftInfo, b: NftInfo) => b.serial_number - a.serial_number);
    } catch {
      // Mirror Node fetch failed — leave stats/feed as empty states
    }
  }

  // Fetch audit events (same service calls as /ui/audit)
  if (auditTopicId) {
    try {
      const messages = await getTopicMessages(auditTopicId);
      const VALID_TYPES = new Set([
        "passport_issued",
        "tier_upgraded",
        "passport_revoked",
        "agent_registered",
        "agent_deregistered",
      ]);

      const events: AuditEventWithTx[] = [];
      for (const msg of messages) {
        try {
          const parsed = JSON.parse(msg.message) as Record<string, unknown>;
          if (!VALID_TYPES.has(parsed.type as string)) continue;
          events.push({
            ...(parsed as unknown as AuditMessage),
            consensusTimestamp: msg.consensus_timestamp,
          });
        } catch {
          // Skip malformed
        }
      }
      ssrData.audit = events;
    } catch {
      // Audit topic fetch failed — leave as empty state
    }
  }

  // Fetch marketplace tasks (same service call as /ui/market/tasks)
  try {
    const result = marketListTasks({ limit: 100 });
    ssrData.tasks = result.tasks;
  } catch {
    // Marketplace cache cold — leave as empty state
  }

  const pageHtml = Dashboard(ssrData);
  return c.html(pageHtml);
});
// Dashboard page uses PageMeta["/dashboard"] title — "Dashboard — AgentBadge"

/**
 * GET /ui/feed — HTML fragment with recent passports.
 * Polled by HTMX every 5s from the dashboard.
 */
uiRoutes.get("/ui/feed", async (c) => {
  const tokenId = process.env.PASSPORT_TOKEN_ID;

  if (!tokenId) {
    return c.html(
      html`<div
        class="rounded-lg border border-slate-800 bg-slate-900 p-4 text-center text-amber-400"
      >
        PASSPORT_TOKEN_ID not configured — feed unavailable.
      </div>`.toString(),
    );
  }

  try {
    const nfts = await getNftsForToken(tokenId);
    // Sort by serial descending (most recent first)
    const sorted = nfts.sort((a: NftInfo, b: NftInfo) => b.serial_number - a.serial_number);
    const offset = parseInt(c.req.query("offset") ?? "0", 10) || 0;
    const PAGE_SIZE = 4;
    const page = sorted.slice(offset, offset + PAGE_SIZE);
    const remaining = sorted.length - offset - PAGE_SIZE;
    const cardsHtml = page.map((nft: NftInfo) => PassportCard({ nft }).toString()).join("");
    const buttonHtml = remaining > 0
      ? `<button type="button" hx-get="/ui/feed?offset=${offset + PAGE_SIZE}" hx-target="this" hx-swap="outerHTML" class="mt-3 w-full rounded-lg border border-slate-700 bg-slate-800 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors">Show more (${remaining} remaining)</button>`
      : "";
    return c.html(raw(cardsHtml + buttonHtml));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.html(
      html`<div
        class="rounded-lg border border-slate-800 bg-slate-900 p-4 text-center text-red-400"
      >
        Feed error: ${message}
      </div>`.toString(),
    );
  }
});

/**
 * GET /ui/passport/:tokenId/:serial — passport detail HTML fragment.
 * (SLICE-4-3, hackathon-flow.md:130)
 *
 * Returns full detail: DID, tier, capabilities, owner, issued date, status, HashScan link.
 * Returns 200 with not-found fragment for missing passports (HTMX convention).
 */
uiRoutes.get("/ui/passport/:tokenId/:serial", async (c) => {
  const tokenId = c.req.param("tokenId");
  const serial = Number(c.req.param("serial"));

  if (!tokenId || Number.isNaN(serial)) {
    return c.html(PassportNotFound().toString());
  }

  try {
    const nft = await getNftInfo(tokenId, serial);
    if (!nft) {
      return c.html(PassportNotFound().toString());
    }

    let tier: Tier | null = null;
    let capabilities: Capability[] = [];
    let did = `did:hcs:${tokenId}:${serial}`;
    let issuedAt = Math.floor(parseFloat(nft.created_timestamp));
    let endpoint: string | undefined;

    if (nft.metadata) {
      try {
        const metadata = await retrieveMetadata(nft.metadata);
        tier = metadata.tier;
        capabilities = metadata.capabilities;
        if (metadata.did) did = metadata.did;
        if (metadata.issuedAt) issuedAt = metadata.issuedAt;
        if (metadata.endpoint) endpoint = metadata.endpoint;
      } catch {
        // IPFS fetch failed — return on-chain data only
      }
    }

    const info: PassportInfo = {
      active: !nft.deleted,
      tokenId: nft.token_id,
      serialNumber: nft.serial_number,
      tier,
      capabilities,
      did,
      owner: nft.account_id,
      issuedAt,
      endpoint,
    };

    return c.html(PassportDetailCard({ info }).toString());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.html(
      html`<div
        class="rounded-lg border border-slate-800 bg-slate-900 p-4 text-center text-red-400"
      >
        Error: ${message}
      </div>`.toString(),
    );
  }
});

/**
 * GET /ui/agents — agent directory HTML fragment.
 * (SLICE-4-3, hackathon-flow.md:131 — polls every 10s)
 *
 * Lists all directory entries with capability badges and active/inactive indicator.
 */
uiRoutes.get("/ui/agents", async (c) => {
  try {
    const format = getAcceptedFormat(c);

    if (format === "json") {
      const capability = c.req.query("capability") as Capability | undefined;
      const skill = c.req.query("skill");
      let entries = getAll();
      if (capability) entries = entries.filter((e) => e.capabilities.includes(capability));
      if (skill) entries = entries.filter((e) => e.skills?.includes(skill));
      const agents = await Promise.all(
        entries.map(async (entry) => {
          try {
            const nft = await getNftInfo(entry.tokenId, entry.serial);
            return { ...entry, active: nft ? !nft.deleted : false };
          } catch {
            return { ...entry, active: false };
          }
        }),
      );
      return c.json({ agents, count: agents.length, total: entries.length, limit: 100, offset: 0 });
    }

    const tokenId = process.env.PASSPORT_TOKEN_ID;

    if (!tokenId) {
      return c.html(
        wrapFragment(
          c,
          html`<div
            class="rounded-lg border border-slate-800 bg-slate-900 p-4 text-center text-amber-400"
          >
            PASSPORT_TOKEN_ID not configured — agent directory unavailable.
          </div>`.toString(),
        ),
      );
    }

    // Fetch all NFTs from Mirror Node
    const nfts = (await getNftsForToken(tokenId)) ?? [];
    const entries = getAll();

    // Build a lookup map from directory cache: did → entry
    const dirMap = new Map<string, DirectoryEntry>();
    for (const entry of entries) {
      dirMap.set(entry.did, entry);
    }

    // Merge: every NFT becomes an agent entry, enriched with directory data if available
    const agents: AgentWithActive[] = await Promise.all(
      nfts.map(async (nft: NftInfo) => {
        const did = `did:hcs:${nft.token_id}:${nft.serial_number}`;
        const dirEntry = dirMap.get(did);

        // Try to get metadata for tier/capabilities
        let tier: Tier = "bronze";
        let capabilities: Capability[] = [];
        let name = "Unregistered Agent";
        let endpoint = "";
        let timestamp = Math.floor(parseFloat(nft.created_timestamp));
        let skills: string[] | undefined;
        let image: string | undefined;

        if (dirEntry) {
          name = dirEntry.name;
          tier = dirEntry.tier;
          capabilities = dirEntry.capabilities;
          endpoint = dirEntry.endpoint;
          timestamp = dirEntry.timestamp;
          image = dirEntry.image;
        } else if (nft.metadata) {
          try {
            const metadata = await retrieveMetadata(nft.metadata);
            if (metadata.tier) tier = metadata.tier;
            if (metadata.capabilities) capabilities = metadata.capabilities;
            if (metadata.name) name = metadata.name;
            if (metadata.endpoint) endpoint = metadata.endpoint;
            if (metadata.issuedAt) timestamp = metadata.issuedAt;
            if (metadata.skills) skills = metadata.skills;
            if (metadata.image) image = metadata.image;
          } catch {
            // IPFS fetch failed — use defaults
          }
        }

        return {
          did,
          tokenId: nft.token_id,
          serial: nft.serial_number,
          accountId: nft.account_id ?? "",
          name,
          capabilities,
          endpoint,
          tier,
          timestamp,
          active: !nft.deleted,
          skills,
          image,
        };
      }),
    );

    // Sort by serial descending (most recent first)
    agents.sort((a, b) => b.serial - a.serial);

    const offset = parseInt(c.req.query("offset") ?? "0", 10) || 0;
    if (offset > 0) {
      const PAGE_SIZE = 4;
      const page = agents.slice(offset, offset + PAGE_SIZE);
      const remaining = agents.length - offset - PAGE_SIZE;
      const fragment = html`${page.map((agent) => raw(AgentRow({ agent }).toString())).join("")}${remaining > 0
        ? html`<button type="button" hx-get="/ui/agents?offset=${offset + PAGE_SIZE}" hx-target="this" hx-swap="outerHTML" class="mt-3 w-full rounded-lg border border-slate-700 bg-slate-800 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors">Show more (${remaining} remaining)</button>`
        : ""}`.toString();
      return c.html(fragment);
    }

    const fragment = html`${raw(PageHeader({
      badge: "HCS Directory",
      title: "Agent Directory",
      description: "All agents with on-chain passports. Registered agents appear here with their capabilities, tier, and endpoint.",
    }).toString())}<section class="mt-8"><h2 class="text-lg font-semibold text-white">Registered Agents</h2><div class="mt-4">${raw(AgentsFragment({ agents }).toString())}</div></section>`.toString();
    return c.html(wrapFragment(c, fragment, PageTitles["/ui/agents"], PageMetaRegistry["/ui/agents"]));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.html(
      html`<div
        class="rounded-lg border border-slate-800 bg-slate-900 p-4 text-center text-red-400"
      >
        Agent directory error: ${message}
      </div>`.toString(),
    );
  }
});

/**
 * GET /ui/agents/:accountId — agent profile mini-landing page.
 *
 * Looks up agent by Hedera account ID (e.g. 0.0.5266614) from NFTs + directory cache.
 * Falls back to :tokenId/:serial if accountId not found.
 */
uiRoutes.get("/ui/agents/:param1/:param2?", async (c) => {
  try {
    const tokenId = process.env.PASSPORT_TOKEN_ID;
    if (!tokenId) {
      return c.html(Layout(html`<div class="rounded-lg border border-slate-800 bg-slate-900 p-4 text-center text-amber-400">PASSPORT_TOKEN_ID not configured.</div>`.toString(), "Agent Profile", undefined, undefined, true).toString());
    }

    const param1 = c.req.param("param1");
    const param2 = c.req.param("param2");

    let lookupAccountId: string | undefined;
    let lookupTokenId: string | undefined;
    let lookupSerial: number | undefined;

    if (param2 !== undefined) {
      lookupTokenId = param1;
      lookupSerial = parseInt(param2, 10);
    } else {
      lookupAccountId = param1;
    }

    const nfts = (await getNftsForToken(tokenId)) ?? [];
    const entries = getAll();
    const dirMap = new Map<string, DirectoryEntry>();
    for (const entry of entries) {
      dirMap.set(entry.did, entry);
    }

    const matchingNft = nfts.find((nft: NftInfo) => {
      if (lookupAccountId) {
        return nft.account_id === lookupAccountId;
      }
      if (lookupTokenId && lookupSerial !== undefined) {
        return nft.token_id === lookupTokenId && nft.serial_number === lookupSerial;
      }
      return false;
    });

    if (!matchingNft) {
      const notFound = html`${raw(PageHeader({
        badge: "Not Found",
        title: "Agent Not Found",
        description: "No agent matches the provided identifier.",
      }).toString())}
      <section class="mt-8 text-center">
        <p class="text-slate-400">No agent found${lookupAccountId ? ` for account ${lookupAccountId}` : ""}.</p>
        <a href="/ui/agents" class="mt-4 inline-block text-emerald-400 hover:underline">← Back to Directory</a>
      </section>`;
      return c.html(Layout(notFound.toString(), "Agent Not Found", undefined, undefined, true).toString(), 404);
    }

    const did = `did:hcs:${matchingNft.token_id}:${matchingNft.serial_number}`;
    const dirEntry = dirMap.get(did);

    let tier: Tier = "bronze";
    let capabilities: Capability[] = [];
    let name = "Unregistered Agent";
    let endpoint = "";
    let timestamp = Math.floor(parseFloat(matchingNft.created_timestamp));
    let skills: string[] | undefined;
    let image: string | undefined;

    if (dirEntry) {
      name = dirEntry.name;
      tier = dirEntry.tier;
      capabilities = dirEntry.capabilities;
      endpoint = dirEntry.endpoint;
      timestamp = dirEntry.timestamp;
      skills = dirEntry.skills;
      image = dirEntry.image;
    } else if (matchingNft.metadata) {
      try {
        const metadata = await retrieveMetadata(matchingNft.metadata);
        if (metadata.tier) tier = metadata.tier;
        if (metadata.capabilities) capabilities = metadata.capabilities;
        if (metadata.name) name = metadata.name;
        if (metadata.endpoint) endpoint = metadata.endpoint;
        if (metadata.issuedAt) timestamp = metadata.issuedAt;
        if (metadata.skills) skills = metadata.skills;
        if (metadata.image) image = metadata.image;
      } catch {
        // IPFS fetch failed — use defaults
      }
    }

    const agent: AgentWithActive = {
      did,
      tokenId: matchingNft.token_id,
      serial: matchingNft.serial_number,
      accountId: matchingNft.account_id ?? "",
      name,
      capabilities,
      endpoint,
      tier,
      timestamp,
      active: !matchingNft.deleted,
      skills,
      image,
    };

    // Fetch HBAR balance from Mirror Node
    if (agent.accountId) {
      try {
        const network = process.env.HEDERA_NETWORK ?? "testnet";
        const mirrorBase = network === "mainnet"
          ? "https://mainnet.mirrornode.hedera.com"
          : "https://testnet.mirrornode.hedera.com";
        const acctResp = await fetch(`${mirrorBase}/api/v1/accounts/${agent.accountId}`);
        if (acctResp.ok) {
          const acctData = await acctResp.json() as { balance?: { balance?: number } };
          if (acctData.balance?.balance != null) {
            agent.hbarBalance = acctData.balance.balance / 1e8;
          }
        }
      } catch {
        // Mirror Node fetch failed — balance unavailable
      }
    }

    const pageContent = AgentProfilePage({ agent });
    const entitySchemas = [
      ...defaultCoreSchemas(),
      profilePageLd(agent),
      passportLd({ tokenId: agent.tokenId, serial: agent.serial, tier: agent.tier, ownerDID: agent.did }),
    ];
    return c.html(Layout(pageContent.toString(), "Agent Profile", undefined, entitySchemas, true).toString());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.html(Layout(html`<div class="rounded-lg border border-slate-800 bg-slate-900 p-4 text-center text-red-400">Agent profile error: ${message}</div>`.toString(), "Agent Profile", undefined, undefined, true).toString(), 500);
  }
});

/**
 * GET /ui/search?q=... — search form + results HTML fragment.
 * (SLICE-4-3, hackathon-flow.md:132)
 *
 * Parses query heuristically:
 * - DID (`did:hcs:...`) → find agent by DID in directory
 * - TokenId (`N.N.N`) → find agents with matching tokenId
 * - Name (other) → substring match against directory entry names
 */
uiRoutes.get("/ui/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const selectedSkills = c.req.queries("skills") ?? [];

  try {
    const entries = getAll();

    // Build a lookup map from directory cache: did → entry
    const dirMap = new Map<string, DirectoryEntry>();
    for (const entry of entries) {
      dirMap.set(entry.did, entry);
    }

    // Fetch all NFTs from Mirror Node to search across all passports
    const passportTokenId = process.env.PASSPORT_TOKEN_ID;
    let allNfts: NftInfo[] = [];
    if (passportTokenId) {
      try {
        allNfts = (await getNftsForToken(passportTokenId)) ?? [];
      } catch {
        // Mirror Node unavailable — fall back to directory-only search
      }
    }

    // Build complete list of agents from NFTs + directory cache
    const allAgents: DirectoryEntry[] = await Promise.all(
      allNfts.map(async (nft: NftInfo) => {
        const did = `did:hcs:${nft.token_id}:${nft.serial_number}`;
        const dirEntry = dirMap.get(did);

        if (dirEntry) {
          return dirEntry;
        }

        // Not in directory — try IPFS metadata
        let name = "Unregistered Agent";
        let tier: Tier = "bronze";
        let capabilities: Capability[] = [];
        let endpoint = "";
        let timestamp = Math.floor(parseFloat(nft.created_timestamp));
        let skills: string[] | undefined;
        let image: string | undefined;

        if (nft.metadata) {
          try {
            const metadata = await retrieveMetadata(nft.metadata);
            if (metadata.name) name = metadata.name;
            if (metadata.tier) tier = metadata.tier;
            if (metadata.capabilities) capabilities = metadata.capabilities;
            if (metadata.endpoint) endpoint = metadata.endpoint;
            if (metadata.issuedAt) timestamp = metadata.issuedAt;
            if (metadata.skills) skills = metadata.skills;
            if (metadata.image) image = metadata.image;
          } catch {
            // IPFS fetch failed
          }
        }

        return {
          did,
          tokenId: nft.token_id,
          serial: nft.serial_number,
          accountId: nft.account_id ?? "",
          name,
          capabilities,
          endpoint,
          tier,
          timestamp,
          skills,
          image,
        };
      }),
    );

    // Collect all unique skills across all agents
    const allSkills = new Set<string>();
    for (const agent of allAgents) {
      if (agent.skills) {
        for (const s of agent.skills) allSkills.add(s);
      }
    }
    const sortedSkills = Array.from(allSkills).sort();

    // If no query and no skills selected, just show the form with skills filter
    if (!q.trim() && selectedSkills.length === 0) {
      const formHtml = SearchForm({ allSkills: sortedSkills }).toString();
      if (isHtmxRequest(c)) return c.html(formHtml);
      return c.html(wrapFragment(c, html`${raw(PageHeader({
        badge: "Mirror Node",
        title: "Search Agents",
        description: "Find agents by DID, token ID, name, or skills. Search runs against on-chain passports and the HCS directory.",
      }).toString())}<section class="mt-8"><h2 class="text-lg font-semibold text-white">Search</h2><div class="mt-4">${raw(formHtml)}</div></section>`.toString(), PageTitles["/ui/search"], PageMetaRegistry["/ui/search"]));
    }

    let matched: DirectoryEntry[] = allAgents;

    // Filter by text query
    if (q.trim()) {
      const parsed = parseSearchQuery(q);
      if (parsed.type === "did") {
        matched = matched.filter((e) => e.did === parsed.value);
      } else if (parsed.type === "tokenId") {
        matched = matched.filter((e) => e.tokenId === parsed.value);
      } else {
        const lower = parsed.value.toLowerCase();
        matched = matched.filter((e) => e.name.toLowerCase().includes(lower));
      }
    }

    // Filter by selected skills (agent must have ALL selected skills)
    if (selectedSkills.length > 0) {
      matched = matched.filter((e) => {
        if (!e.skills) return false;
        return selectedSkills.every((s) => e.skills!.includes(s));
      });
    }

    // Batch-check active status
    const agents: AgentWithActive[] = await Promise.all(
      matched.map(async (entry: DirectoryEntry) => {
        try {
          const nft = await getNftInfo(entry.tokenId, entry.serial);
          return { ...entry, active: nft ? !nft.deleted : false };
        } catch {
          return { ...entry, active: false };
        }
      }),
    );

    const resultsHtml = SearchResults({ query: q, agents, allSkills: sortedSkills }).toString();
    if (isHtmxRequest(c)) return c.html(resultsHtml);
    return c.html(
      wrapFragment(
        c,
        html`${raw(PageHeader({
          badge: "Mirror Node",
          title: "Search Agents",
          description: "Find agents by DID, token ID, name, or skills. Search runs against on-chain passports and the HCS directory.",
        }).toString())}<section class="mt-8"><h2 class="text-lg font-semibold text-white">Results</h2><div class="mt-4">${raw(resultsHtml)}</div></section>`.toString(),
        PageTitles["/ui/search"],
        PageMetaRegistry["/ui/search"],
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.html(
      html`<div
        class="rounded-lg border border-slate-800 bg-slate-900 p-4 text-center text-red-400"
      >
        Search error: ${message}
      </div>`.toString(),
    );
  }
});

/**
 * GET /ui/stats — stats counters HTML fragment.
 * (SLICE-4-2, hackathon-flow.md:127 — polls every 10s)
 *
 * Returns: total issued, total upgrades, active/revoked counts, tier breakdown.
 */
uiRoutes.get("/ui/stats", async (c) => {
  const tokenId = process.env.PASSPORT_TOKEN_ID;
  const auditTopicId = process.env.AUDIT_TOPIC_ID;

  if (!tokenId) {
    return c.html(
      html`<div
        class="rounded-lg border border-slate-800 bg-slate-900 p-4 text-center text-amber-400"
      >
        PASSPORT_TOKEN_ID not configured — stats unavailable.
      </div>`.toString(),
    );
  }

  try {
    const nfts = await getNftsForToken(tokenId);
    const totalIssued = nfts.length;
    const activeCount = nfts.filter((n: NftInfo) => !n.deleted).length;
    const revokedCount = nfts.filter((n: NftInfo) => n.deleted).length;

    // Count upgrades from audit trail
    let totalUpgrades = 0;
    if (auditTopicId) {
      const messages = await getTopicMessages(auditTopicId);
      for (const msg of messages) {
        try {
          const parsed = JSON.parse(msg.message) as Record<string, unknown>;
          if (parsed.type === "tier_upgraded") totalUpgrades++;
        } catch {
          // Skip malformed
        }
      }
    }

    // Tier breakdown from IPFS metadata for active passports
    const byTier: Record<Tier, number> = {
      bronze: 0,
      silver: 0,
      gold: 0,
      platinum: 0,
    };

    const activeNfts = nfts.filter((n: NftInfo) => !n.deleted);
    await Promise.all(
      activeNfts.map(async (nft: NftInfo) => {
        if (!nft.metadata) return;
        try {
          const metadata = await retrieveMetadata(nft.metadata);
          if (metadata.tier) {
            byTier[metadata.tier]++;
          }
        } catch {
          // IPFS fetch failed — skip
        }
      }),
    );

    return c.html(
      wrapFragment(
        c,
        StatsFragment({
          totalIssued,
          totalUpgrades,
          activeCount,
          revokedCount,
          byTier,
        }).toString(),
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.html(
      html`<div
        class="rounded-lg border border-slate-800 bg-slate-900 p-4 text-center text-red-400"
      >
        Stats error: ${message}
      </div>`.toString(),
    );
  }
});

/**
 * GET /ui/landing-stats — landing page stats fragment (HTMX-polled every 10s).
 *
 * Returns 4 cards with icons matching the landing page SSR format.
 * Separate from /ui/stats (dashboard) to keep landing page styling consistent.
 */
uiRoutes.get("/ui/landing-stats", async (c) => {
  const tokenId = process.env.PASSPORT_TOKEN_ID;
  const auditTopicId = process.env.AUDIT_TOPIC_ID;

  let totalIssued = 0;
  let activeCount = 0;
  let totalUpgrades = 0;
  let tasksCount = 0;

  if (tokenId) {
    try {
      const nfts = await getNftsForToken(tokenId);
      totalIssued = nfts.length;
      activeCount = nfts.filter((n: NftInfo) => !n.deleted).length;

      if (auditTopicId) {
        try {
          const messages = await getTopicMessages(auditTopicId);
          for (const msg of messages) {
            try {
              const parsed = JSON.parse(msg.message) as Record<string, unknown>;
              if (parsed.type === "tier_upgraded") totalUpgrades++;
            } catch {
              // Skip malformed
            }
          }
        } catch {
          // Audit topic fetch failed — skip
        }
      }
    } catch {
      // Mirror Node fetch failed — leave as zeros
    }
  }

  try {
    const result = marketListTasks({ limit: 100 });
    tasksCount = result.tasks.length;
  } catch {
    // Marketplace cache cold — leave as 0
  }

  return c.html(LandingStatsFragment({ totalIssued, activeCount, totalUpgrades, tasksCount }).toString());
});

/**
 * GET /ui/audit — audit stream HTML fragment.
 * (SLICE-4-2, hackathon-flow.md:127 — polls every 5s)
 *
 * Returns recent audit events from HCS passport.audit topic, most recent first.
 */
uiRoutes.get("/ui/audit", async (c) => {
  const auditTopicId = process.env.AUDIT_TOPIC_ID;

  if (!auditTopicId) {
    return c.html(
      html`<div
        class="rounded-lg border border-slate-800 bg-slate-900 p-4 text-center text-amber-400"
      >
        AUDIT_TOPIC_ID not configured — audit stream unavailable.
      </div>`.toString(),
    );
  }

  try {
    const messages = await getTopicMessages(auditTopicId);
    const VALID_TYPES = new Set([
      "passport_issued",
      "tier_upgraded",
      "passport_revoked",
      "agent_registered",
      "agent_deregistered",
    ]);

    const events: AuditEventWithTx[] = [];
    for (const msg of messages) {
      try {
        const parsed = JSON.parse(msg.message) as Record<string, unknown>;
        if (!VALID_TYPES.has(parsed.type as string)) continue;
        events.push({
          ...(parsed as unknown as AuditMessage),
          consensusTimestamp: msg.consensus_timestamp,
        });
      } catch {
        // Skip malformed
      }
    }

    const offset = parseInt(c.req.query("offset") ?? "0", 10) || 0;
    if (offset > 0) {
      const PAGE_SIZE = 4;
      const sorted = [...events].reverse();
      const page = sorted.slice(offset, offset + PAGE_SIZE);
      const remaining = sorted.length - offset - PAGE_SIZE;
      const rowsHtml = page.map((event) => AuditRow({ event }).toString()).join("");
      const buttonHtml = remaining > 0
        ? `<button type="button" hx-get="/ui/audit?offset=${offset + PAGE_SIZE}" hx-target="this" hx-swap="outerHTML" class="mt-3 w-full rounded-lg border border-slate-700 bg-slate-800 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors">Show more (${remaining} remaining)</button>`
        : "";
      return c.html(raw(rowsHtml + buttonHtml));
    }

    return c.html(wrapFragment(c, AuditFragment({ events }).toString(), "Audit Stream"));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.html(
      html`<div
        class="rounded-lg border border-slate-800 bg-slate-900 p-4 text-center text-red-400"
      >
        Audit stream error: ${message}
      </div>`.toString(),
    );
  }
});

/**
 * GET /ui/catalog — tier pricing cards HTML fragment.
 * (hackathon-flow.md:226-231 §6)
 *
 * Shows 4 tiers (Bronze/Silver/Gold/Platinum) with HBAR prices and capabilities.
 */
uiRoutes.get("/ui/catalog", (c) => {
  const format = getAcceptedFormat(c);
  const tiers = getCatalog();

  if (format === "json") {
    return c.json({ tiers });
  }

  if (format === "markdown") {
    const md = `# AgentBadge Passport Tiers\n\n| Tier | Price (HBAR) | Capabilities |\n|------|-------------|--------------|\n${tiers.map((t) => `| ${t.name} | ${t.price} | ${t.capabilities.join(", ")} |`).join("\n")}`;
    return new Response(md, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
  }

  return c.html(wrapFragment(c, html`${raw(PageHeader({
    badge: "HTS Pricing",
    title: "Passport Tiers",
    description: "Choose a tier for your agent passport. Each tier unlocks more capabilities and higher reputation on the Hedera network.",
  }).toString())}<section class="mt-8"><h2 class="text-lg font-semibold text-white">Available Tiers</h2><div class="mt-4">${raw(CatalogFragment({ tiers }).toString())}</div></section>`.toString(), PageTitles["/ui/catalog"], PageMetaRegistry["/ui/catalog"]));
});

/**
 * GET /ui/passport/request — passport request form page.
 *
 * Shows a form pre-filled with the selected tier (from ?tier= query param).
 * Form submits via HTMX to POST /passport/request.
 */
uiRoutes.get("/ui/passport/request", (c) => {
  const tier = c.req.query("tier") ?? "bronze";
  const tiers = getCatalog();
  return c.html(wrapFragment(c, PassportRequestForm({ tiers, selectedTier: tier }).toString(), PageTitles["/ui/passport/request"], PageMetaRegistry["/ui/passport/request"]));
});

/**
 * GET /ui/help — help & overview page.
 *
 * Describes what AgentBadge is, lists all site pages,
 * links to the machine-readable Agent Guide for AI agents,
 * and shows MCP tools table and contact info.
 */
uiRoutes.get("/ui/help", (c) => {
  return c.html(HelpPage().toString());
});

/**
 * GET /ui/medical-demo — Medical Data Skills demo page (static, no task).
 *
 * Shows the full agent-to-agent medical data processing workflow
 * with interactive demo buttons, data format reference, and API docs.
 */
uiRoutes.get("/ui/medical-demo", (c) => {
  return c.html(MedicalDemoPage().toString());
});

/**
 * GET /ui/medical-demo/:taskId — Medical Data Skills demo page bound to a live task.
 *
 * Loads the marketplace task from cache and renders the demo page with a
 * task banner showing live status, price, capabilities, and delivery result.
 */
uiRoutes.get("/ui/medical-demo/:taskId", (c) => {
  const taskId = c.req.param("taskId");
  const task = marketGet(taskId);
  if (!task) {
    return c.html(
      MedicalDemoPage().toString(),
    );
  }
  return c.html(MedicalDemoPage(task).toString());
});

/**
 * GET /ui/a2a — A2A Inbox landing page with DID input form.
 *
 * Query params:
 *   did  — DID of the inbox owner (optional, pre-fills the form)
 *
 * Full page with DID input. When DID is provided, the inbox fragment
 * is loaded via HTMX polling every 10s.
 */
uiRoutes.get("/ui/a2a", (c) => {
  const did = c.req.query("did") ?? "";
  const page = html`
    <section class="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-8">
      <span class="inline-block rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">A2A Messaging</span>
      <h1 class="mt-4 text-3xl font-semibold text-white sm:text-4xl">A2A Inbox</h1>
      <p class="mt-3 max-w-2xl text-slate-300">
        View incoming agent-to-agent messages from the HCS directory. Enter your DID to load your inbox.
      </p>
    </section>

    <section class="mt-8">
      <form method="GET" action="/ui/a2a" class="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div class="flex-1">
          <label for="did-input" class="block text-sm font-medium text-slate-300">Your DID</label>
          <input
            id="did-input"
            type="text"
            name="did"
            value="${did}"
            placeholder="did:hcs:0.0.123:1"
            class="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <button
          type="submit"
          class="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 transition-colors"
        >
          Load Inbox
        </button>
      </form>
    </section>

    ${did
      ? html`<section class="mt-8">
          <div class="flex items-baseline justify-between">
            <h2 class="text-lg font-semibold text-white">Messages</h2>
            <span class="text-sm text-slate-400">Auto-refreshes every 10s</span>
          </div>
          <div
            id="a2a-inbox"
            hx-get="/ui/a2a/inbox/fragment?did=${encodeURIComponent(did)}"
            hx-trigger="load, every 10s"
            hx-swap="innerHTML"
            class="mt-4 space-y-3"
          >
            <p class="text-slate-400">Loading inbox…</p>
          </div>
        </section>`
      : ""}
  `;
  return c.html(Layout(page.toString(), PageTitles["/ui/a2a"], PageMetaRegistry["/ui/a2a"], undefined, true).toString());
});

/**
 * GET /ui/a2a/inbox — A2A Inbox page for a specific agent.
 *
 * Query params:
 *   did  — DID of the inbox owner (required)
 *
 * Full page showing incoming messages for the agent, with HTMX polling every 10s.
 */
uiRoutes.get("/ui/a2a/inbox", (c) => {
  const did = c.req.query("did") ?? "";
  if (!did) {
    const page = html`
      <section class="rounded-xl border border-slate-800 bg-slate-900 p-8 text-center">
        <h1 class="text-2xl font-semibold text-white">A2A Inbox</h1>
        <p class="mt-3 text-slate-400">No DID provided. Go to <a href="/ui/agents" class="text-emerald-400 hover:underline">Agents</a> to select an agent.</p>
      </section>
    `;
    return c.html(Layout(page.toString(), PageTitles["/ui/a2a"], undefined, undefined, true).toString());
  }

  const messages = getA2AMessagesByTo(did);
  const fragment = A2AInboxFragment({ messages, userDid: did });
  const page = html`
    <section class="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-6">
      <div class="flex items-center justify-between">
        <div>
          <span class="inline-block rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">Inbox</span>
          <h1 class="mt-3 text-2xl font-semibold text-white">Incoming Messages</h1>
          <p class="mt-1 text-sm text-slate-400 font-mono">${did}</p>
        </div>
        <a href="/ui/a2a/outbox?did=${encodeURIComponent(did)}" class="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors">
          View Outbox →
        </a>
      </div>
    </section>
    <section class="mt-6">
      <div class="flex items-baseline justify-between mb-3">
        <h2 class="text-lg font-semibold text-white">Messages</h2>
        <span class="text-sm text-slate-400">Auto-refreshes every 10s</span>
      </div>
      <div
        id="a2a-inbox"
        hx-get="/ui/a2a/inbox/fragment?did=${encodeURIComponent(did)}"
        hx-trigger="load, every 10s"
        hx-swap="innerHTML"
        class="space-y-3"
      >
        ${raw(fragment.toString())}
      </div>
    </section>
  `;
  return c.html(Layout(page.toString(), PageTitles["/ui/a2a"], undefined, undefined, true).toString());
});

/**
 * GET /ui/a2a/inbox/fragment — A2A inbox fragment only (for HTMX polling).
 */
uiRoutes.get("/ui/a2a/inbox/fragment", (c) => {
  const did = c.req.query("did") ?? "";
  if (!did) return c.html("");
  const messages = getA2AMessagesByTo(did);
  const fragment = A2AInboxFragment({ messages, userDid: did });
  return c.html(fragment.toString());
});

/**
 * GET /ui/a2a/outbox — A2A Outbox page for a specific agent.
 *
 * Query params:
 *   did  — DID of the sender (required)
 *
 * Full page showing sent messages by the agent, with HTMX polling every 10s.
 */
uiRoutes.get("/ui/a2a/outbox", (c) => {
  const did = c.req.query("did") ?? "";
  if (!did) {
    const page = html`
      <section class="rounded-xl border border-slate-800 bg-slate-900 p-8 text-center">
        <h1 class="text-2xl font-semibold text-white">A2A Outbox</h1>
        <p class="mt-3 text-slate-400">No DID provided. Go to <a href="/ui/agents" class="text-emerald-400 hover:underline">Agents</a> to select an agent.</p>
      </section>
    `;
    return c.html(Layout(page.toString(), "A2A Outbox", undefined, undefined, true).toString());
  }

  const messages = getA2AMessagesByFrom(did);
  const fragment = A2AInboxFragment({ messages, userDid: did });
  const page = html`
    <section class="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-6">
      <div class="flex items-center justify-between">
        <div>
          <span class="inline-block rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">Outbox</span>
          <h1 class="mt-3 text-2xl font-semibold text-white">Sent Messages</h1>
          <p class="mt-1 text-sm text-slate-400 font-mono">${did}</p>
        </div>
        <a href="/ui/a2a/inbox?did=${encodeURIComponent(did)}" class="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors">
          ← View Inbox
        </a>
      </div>
    </section>
    <section class="mt-6">
      <div class="flex items-baseline justify-between mb-3">
        <h2 class="text-lg font-semibold text-white">Messages</h2>
        <span class="text-sm text-slate-400">Auto-refreshes every 10s</span>
      </div>
      <div
        id="a2a-outbox"
        hx-get="/ui/a2a/outbox/fragment?did=${encodeURIComponent(did)}"
        hx-trigger="load, every 10s"
        hx-swap="innerHTML"
        class="space-y-3"
      >
        ${raw(fragment.toString())}
      </div>
    </section>
  `;
  return c.html(Layout(page.toString(), "A2A Outbox", undefined, undefined, true).toString());
});

/**
 * GET /ui/a2a/outbox/fragment — A2A outbox fragment only (for HTMX polling).
 */
uiRoutes.get("/ui/a2a/outbox/fragment", (c) => {
  const did = c.req.query("did") ?? "";
  if (!did) return c.html("");
  const messages = getA2AMessagesByFrom(did);
  const fragment = A2AInboxFragment({ messages, userDid: did });
  return c.html(fragment.toString());
});

/**
 * GET /ui/conversation — bidirectional conversation view between two DIDs.
 *
 * Query params:
 *   didA  — first DID (required)
 *   didB  — second DID (required)
 *
 * Full page showing all messages between two agents, with HTMX polling every 10s.
 */
uiRoutes.get("/ui/conversation", (c) => {
  const didA = c.req.query("didA") ?? "";
  const didB = c.req.query("didB") ?? "";
  if (!didA || !didB) {
    return c.html(wrapFragment(c, '<div class="max-w-2xl mx-auto p-6 text-center text-slate-400"><p>Missing didA or didB parameter.</p></div>', "Conversation"));
  }
  const messages = getA2AConversation(didA, didB);
  const encA = encodeURIComponent(didA);
  const encB = encodeURIComponent(didB);
  const page = html`
    <div class="max-w-2xl mx-auto space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-semibold text-white">Conversation</h1>
          <div class="mt-1 flex items-center gap-2 text-sm">
            <span class="font-mono text-emerald-400" title="${didA}">${didA.length > 16 ? `…${didA.slice(-8)}` : didA}</span>
            <svg class="h-3 w-3 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
            <span class="font-mono text-sky-400" title="${didB}">${didB.length > 16 ? `…${didB.slice(-8)}` : didB}</span>
          </div>
        </div>
        <a href="/ui/a2a/inbox?did=${encA}" class="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors">
          ← Back to Inbox
        </a>
      </div>
      <div
        id="conversation-messages"
        hx-get="/ui/conversation/fragment?didA=${encA}&didB=${encB}"
        hx-trigger="load, every 10s"
        hx-swap="innerHTML"
        class="space-y-3"
      >
        ${messages.length === 0
      ? html`<div class="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center text-slate-400"><p>No messages in this conversation yet.</p></div>`
      : html`<div class="space-y-3">
              ${messages.map((msg) => html`<div class="flex ${msg.from === didA ? "justify-end" : "justify-start"} mb-1.5">
                <div class="max-w-[80%] rounded-lg px-3 py-2 text-sm ${msg.from === didA ? "bg-emerald-900 text-emerald-50" : "bg-slate-800 text-slate-200"}">
                  <p>${msg.body}</p>
                  <div class="flex items-center gap-1.5 mt-0.5">
                    <span class="text-xs ${msg.from === didA ? "text-emerald-400" : "text-slate-500"}">${msg.timestamp ? new Date(msg.timestamp * 1000).toLocaleString() : ""}</span>
                  </div>
                </div>
              </div>`)}
            </div>`}
      </div>
    </div>
  `;
  return c.html(wrapFragment(c, page.toString(), "Conversation"));
});

/**
 * GET /ui/conversation/fragment — conversation fragment only (for HTMX polling).
 */
uiRoutes.get("/ui/conversation/fragment", (c) => {
  const didA = c.req.query("didA") ?? "";
  const didB = c.req.query("didB") ?? "";
  if (!didA || !didB) return c.html("");
  const messages = getA2AConversation(didA, didB);
  if (messages.length === 0) {
    return c.html('<div class="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center text-slate-400"><p>No messages in this conversation yet.</p></div>');
  }
  return c.html(html`<div class="space-y-3">
    ${messages.map((msg) => html`<div class="flex ${msg.from === didA ? "justify-end" : "justify-start"} mb-1.5">
      <div class="max-w-[80%] rounded-lg px-3 py-2 text-sm ${msg.from === didA ? "bg-emerald-900 text-emerald-50" : "bg-slate-800 text-slate-200"}">
        <p>${msg.body}</p>
        <div class="flex items-center gap-1.5 mt-0.5">
          <span class="text-xs ${msg.from === didA ? "text-emerald-400" : "text-slate-500"}">${msg.timestamp ? new Date(msg.timestamp * 1000).toLocaleString() : ""}</span>
        </div>
      </div>
    </div>`)}
  </div>`.toString());
});

/**
 * GET /ui/market/tasks — marketplace task board fragment (HTMX-polled every 10s).
 *
 * Query params:
 *   offset  — pagination offset (default 0)
 *   capability — filter by capability (optional)
 *
 * Returns HTML fragment with task cards, pagination, and "No tasks" placeholder.
 */
uiRoutes.get("/ui/market/tasks", (c) => {
  const offset = parseInt(c.req.query("offset") ?? "0", 10) || 0;
  const capability = c.req.query("capability") || undefined;
  const result = marketListTasks({ offset, limit: 100, capability });

  if (getAcceptedFormat(c) === "json") {
    return c.json({ tasks: result.tasks, count: result.tasks.length, total: result.total, limit: 100, offset });
  }

  const fragment = MarketplaceTaskBoardFragment(result.tasks);
  return c.html(wrapFragment(c, fragment.toString(), PageTitles["/ui/market/tasks"], PageMetaRegistry["/ui/market/tasks"]));
});

/**
 * GET /ui/market/tasks/:id — task details fragment.
 *
 * Shows full task information: title, description, price, capabilities, status,
 * claimer, delivery result. Claim button (HTMX POST) shown for "posted" tasks.
 */
uiRoutes.get("/ui/market/tasks/:id", (c) => {
  const taskId = c.req.param("id");
  const task = marketGet(taskId);
  if (!task) {
    return c.html(
      wrapFragment(
        c,
        html`<div class="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center text-slate-400">
          <p>Task not found.</p>
        </div>`.toString(),
      ),
      404,
    );
  }
  const viewerDid = c.req.query("did") ?? "";
  const otherDid = viewerDid === task.posterDid
    ? (task.claimerDid ?? task.posterDid)
    : task.posterDid;
  const messages = viewerDid ? getA2AConversation(viewerDid, otherDid) : [];
  const fragment = TaskDetailsFragment(task, viewerDid || undefined, messages);
  const pollUrl = `/ui/market/tasks/${taskId}/fragment${viewerDid ? `?did=${encodeURIComponent(viewerDid)}` : ""}`;
  const wrapped = html`<div class="htmx-poll-wrapper" hx-get="${pollUrl}" hx-trigger="every 10s" hx-swap="outerHTML">
    ${fragment}
  </div>`;
  const entitySchemas = [...defaultCoreSchemas(), jobPostingLd(task)];
  return c.html(wrapFragment(c, wrapped.toString(), "Task Details", undefined, entitySchemas));
});

/**
 * GET /ui/market/tasks/:id/fragment — task details fragment only (for HTMX polling).
 */
uiRoutes.get("/ui/market/tasks/:id/fragment", (c) => {
  const taskId = c.req.param("id");
  const task = marketGet(taskId);
  if (!task) {
    return c.html('<div class="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center text-slate-400"><p>Task not found.</p></div>');
  }
  const viewerDid = c.req.query("did") ?? "";
  const otherDid = viewerDid === task.posterDid
    ? (task.claimerDid ?? task.posterDid)
    : task.posterDid;
  const messages = viewerDid ? getA2AConversation(viewerDid, otherDid) : [];
  const fragment = TaskDetailsFragment(task, viewerDid || undefined, messages);
  const pollUrl = `/ui/market/tasks/${taskId}/fragment${viewerDid ? `?did=${encodeURIComponent(viewerDid)}` : ""}`;
  return c.html(html`<div class="htmx-poll-wrapper" hx-get="${pollUrl}" hx-trigger="every 10s" hx-swap="outerHTML">
    ${fragment}
  </div>`.toString());
});

/**
 * GET /ui/market/tasks/:id/escrow-fragment — escrow panel fragment only (for HTMX polling).
 */
uiRoutes.get("/ui/market/tasks/:id/escrow-fragment", (c) => {
  const taskId = c.req.param("id");
  const task = marketGet(taskId);
  if (!task) {
    return c.html('<div class="rounded-lg border border-slate-800 bg-slate-900 p-4 text-center text-slate-400"><p>Task not found.</p></div>');
  }
  const viewerDid = c.req.query("did") ?? "";
  return c.html(EscrowPanel(task, viewerDid || undefined).toString());
});

/**
 * GET /ui/market/tasks/:id/result — raw delivery result.
 *
 * Returns the resultBody as-is (HTML page, JSON, or text) so the user can
 * open the full report in a new browser tab.
 */
uiRoutes.get("/ui/market/tasks/:id/result", (c) => {
  const taskId = c.req.param("id");
  const task = marketGet(taskId);
  if (!task) {
    return c.text("Task not found", 404);
  }
  if (!task.resultBody) {
    return c.text("No delivery result available", 404);
  }
  const trimmed = task.resultBody.trim();
  if (
    trimmed.startsWith("<!DOCTYPE") ||
    trimmed.startsWith("<html") ||
    (trimmed.startsWith("<") && trimmed.includes("<body"))
  ) {
    return c.html(task.resultBody);
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return c.json(JSON.parse(trimmed));
  }
  return c.text(task.resultBody);
});

/**
 * POST /ui/market/tasks/:id/send-message — send signed A2A message from task detail page.
 *
 * Form fields: from, to, body, fromAccountId, privateKey
 * Signs with agent's key, submits to HCS, caches locally, returns updated fragment.
 */
uiRoutes.post("/ui/market/tasks/:id/send-message", async (c) => {
  const taskId = c.req.param("id");
  const task = marketGet(taskId);
  if (!task) {
    return c.html(
      html`<div class="rounded-lg border border-red-800 bg-red-900 p-4 text-sm text-red-200">
        Task not found.
      </div>`.toString(),
      404,
    );
  }

  const formData = await c.req.formData();
  const from = (formData.get("from") as string) ?? "";
  const to = (formData.get("to") as string) ?? "";
  const body = (formData.get("body") as string) ?? "";
  const fromAccountId = (formData.get("fromAccountId") as string) ?? "";
  const privateKey = (formData.get("privateKey") as string) ?? "";

  if (!from || !to || !body) {
    const messages = getA2AConversation(from, task.posterDid);
    return c.html(
      html`<div id="task-messages" class="space-y-3">
        <div class="rounded-lg border border-red-800 bg-red-900 p-3 text-sm text-red-200">
          Missing from, to, or body.
        </div>
      </div>`.toString(),
    );
  }

  if (!fromAccountId || !privateKey) {
    return c.html(
      html`<div id="task-messages" class="space-y-3">
        <div class="rounded-lg border border-red-800 bg-red-900 p-3 text-sm text-red-200">
          Missing fromAccountId or privateKey for signed submission.
        </div>
      </div>`.toString(),
    );
  }

  if (!isValidA2ADid(from) || !isValidA2ADid(to)) {
    return c.html(
      html`<div id="task-messages" class="space-y-3">
        <div class="rounded-lg border border-red-800 bg-red-900 p-3 text-sm text-red-200">
          Invalid DID format.
        </div>
      </div>`.toString(),
    );
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const message = {
      type: "a2a_message" as const,
      from,
      to,
      body,
      contentType: "text/plain",
      timestamp,
    };
    const { txBytes } = await prepareA2ATopicMessage(fromAccountId, message);
    const { signature, publicKey } = signTransactionBytes(txBytes, privateKey);
    const sigB64Array = JSON.parse(signature) as string[];
    const signatureBytes = sigB64Array.map((s) => new Uint8Array(Buffer.from(s, "base64")));
    const txId = await submitSignedTopicMessage(txBytes, publicKey, signatureBytes);
    const consensusTimestamp = `${timestamp}.${String(Date.now() % 1_000_000_000).padStart(9, "0")}`;
    a2aCacheUpsert({ ...message, txId, consensusTimestamp });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "HCS submission failed";
    return c.html(
      html`<div id="task-messages" class="space-y-3">
        <div class="rounded-lg border border-red-800 bg-red-900 p-3 text-sm text-red-200">
          Failed to send: ${errMsg}
        </div>
      </div>`.toString(),
    );
  }

  const messages = getA2AConversation(from, task.posterDid);
  const fragment = TaskMessagesFragment(task, messages, from);
  return c.html(fragment.toString());
});
