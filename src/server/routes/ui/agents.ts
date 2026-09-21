// EPIC-140 (SLICE-140-15): agent directory + profile + search — extracted from routes/ui.ts.
import { Hono } from "hono";
import { html, raw } from "hono/html";
import { AgentsFragment, AgentRow, AgentWithActive } from "../../../views/agents-fragment";
import { SearchForm, SearchResults, parseSearchQuery } from "../../../views/search-fragment";
import { AgentProfilePage } from "../../../views/agent-profile";
import { Layout } from "../../../views/layout";
import { PageHeader } from "../../../views/page-header";
import { PageTitles } from "../../lib/page-titles";
import { PageMeta as PageMetaRegistry } from "../../lib/page-meta";
import { passportLd, profilePageLd, defaultCoreSchemas } from "../../lib/json-ld";
import { getAcceptedFormat } from "../../lib/content-negotiation";
import { getNftsForToken, getNftInfo, type NftInfo, type Tier, type Capability } from "@agentbadge/hedera-core";
import { retrieveMetadata, getAll, DirectoryEntry } from "@agentbadge/passport";
import { isHtmxRequest, wrapFragment } from "./helpers";

export const agentsRoutes = new Hono();

agentsRoutes.get("/ui/agents", async (c) => {
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

agentsRoutes.get("/ui/agents/:param1/:param2?", async (c) => {
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

agentsRoutes.get("/ui/search", async (c) => {
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
