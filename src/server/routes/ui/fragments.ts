// EPIC-140 (SLICE-140-15): polling fragments + static pages — extracted from routes/ui.ts.
import { Hono } from "hono";
import { html, raw } from "hono/html";
import { StatsFragment } from "../../../views/stats-fragment";
import { LandingStatsFragment } from "../../../views/landing/landing-stats-fragment";
import { AuditFragment, AuditRow, AuditEventWithTx } from "../../../views/audit-fragment";
import { CatalogFragment } from "../../../views/catalog-fragment";
import { HelpPage } from "../../../views/help-page";
import { PageHeader } from "../../../views/page-header";
import { PageTitles } from "../../lib/page-titles";
import { PageMeta as PageMetaRegistry } from "../../lib/page-meta";
import { getAcceptedFormat } from "../../lib/content-negotiation";
import { getCatalog, getNftsForToken, getTopicMessages, type NftInfo, type Tier, type AuditMessage } from "@agentbadge/hedera-core";
import { retrieveMetadata } from "@agentbadge/passport";
import { listTasks as marketListTasks } from "@agentbadge/passport";
import { wrapFragment } from "./helpers";

export const fragmentRoutes = new Hono();

fragmentRoutes.get("/ui/stats", async (c) => {
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

fragmentRoutes.get("/ui/landing-stats", async (c) => {
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

fragmentRoutes.get("/ui/audit", async (c) => {
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

fragmentRoutes.get("/ui/catalog", (c) => {
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

fragmentRoutes.get("/ui/help", (c) => {
  return c.html(HelpPage().toString());
});
