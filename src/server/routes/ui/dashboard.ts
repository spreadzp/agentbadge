// EPIC-140 (SLICE-140-15): dashboard + passport views — extracted from routes/ui.ts.
import { Hono } from "hono";
import { html, raw } from "hono/html";
import { Dashboard, DashboardSsrData } from "../../../views/dashboard";
import { PassportCard } from "../../../views/feed-fragment";
import { PassportDetailCard, PassportNotFound } from "../../../views/passport-card";
import { AuditEventWithTx } from "../../../views/audit-fragment";
import { PassportRequestForm } from "../../../views/passport-request-form";
import { PageTitles } from "../../lib/page-titles";
import { PageMeta as PageMetaRegistry } from "../../lib/page-meta";
import { getCatalog, getNftsForToken, getNftInfo, getTopicMessages, type NftInfo, type Tier, type Capability, type AuditMessage } from "@agentbadge/hedera-core";
import { retrieveMetadata, type PassportInfo } from "@agentbadge/passport";
import { listTasks as marketListTasks } from "@agentbadge/passport";
import { wrapFragment } from "./helpers";

export const dashboardRoutes = new Hono();

dashboardRoutes.get("/dashboard", async (c) => {
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
  return c.html(pageHtml, 200, { "X-Robots-Tag": "noindex" });
});

dashboardRoutes.get("/ui/feed", async (c) => {
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

dashboardRoutes.get("/ui/passport/:tokenId/:serial", async (c) => {
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

dashboardRoutes.get("/ui/passport/request", (c) => {
  const tier = c.req.query("tier") ?? "bronze";
  const tiers = getCatalog();
  return c.html(wrapFragment(c, PassportRequestForm({ tiers, selectedTier: tier }).toString(), PageTitles["/ui/passport/request"], PageMetaRegistry["/ui/passport/request"]));
});
