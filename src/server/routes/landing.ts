import { Hono } from "hono";
import { html, raw } from "hono/html";
import { LandingLayout } from "../../views/landing/layout";
import { LandingPage } from "../../views/landing/landing-page";
import { PageMeta as PageMetaRegistry, type PageMeta } from "../lib/page-meta";
import { defaultCoreSchemas, landingJsonLd } from "../lib/json-ld";
import { getNftsForToken, getTopicMessages, type NftInfo, type Tier } from "@agentgate-hedera/hedera-core";
import { retrieveMetadata } from "@agentgate-hedera/passport";
import { listTasks as marketListTasks } from "@agentgate-hedera/passport";

/**
 * Landing page routes.
 * SLICE-43-1: Old landing moved to /passport, new Agent Readiness landing at /.
 */
export const landingRoutes = new Hono();

/**
 * GET / — Agent Readiness landing page (new).
 *
 * Placeholder for the new Agent Readiness product landing page.
 * Full implementation in subsequent SLICE-43 slices.
 */
landingRoutes.get("/", async (c) => {
  const meta = PageMetaRegistry["/"];
  const jsonLd = landingJsonLd();

  const content = html`<div id="agent-readiness-landing">
    <section class="hero">
      <h1>Agent Readiness for the Agentic Web</h1>
      <p class="subtitle">Can AI agents discover, understand, and use your API?</p>
      <p class="description">
        AgentBadge measures your API's Agent Readiness with deterministic checks,
        evidence-based scoring, and actionable fixes.
      </p>
      <div class="cta-group">
        <a href="/agent-guide/articles/what-is-agent-readiness" class="btn btn-primary">Learn More</a>
        <a href="/agent-guide/" class="btn btn-secondary">Agent Guide</a>
      </div>
    </section>
    <section class="placeholder-notice">
      <p><em>Landing page redesign in progress. <a href="/passport">View the original Hedera marketplace page →</a></em></p>
    </section>
  </div>`.toString();

  const pageHtml = LandingLayout(content, undefined, meta, jsonLd);
  return c.html(pageHtml);
});

/**
 * GET /passport — Original Hedera marketplace landing page (preserved).
 *
 * This is the original landing page, preserved for hackathon use and
 * backward compatibility. New visitors see the Agent Readiness landing at /.
 */
landingRoutes.get("/passport", async (c) => {
  const meta = PageMetaRegistry["/passport"];
  const jsonLd = landingJsonLd();

  // Fetch SSR stats data for LiveStatsSection
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

  const content = LandingPage({ totalIssued, activeCount, totalUpgrades, tasksCount }).toString();
  const pageHtml = LandingLayout(content, undefined, meta, jsonLd);
  return c.html(pageHtml);
});

// Note: GET /dashboard is registered in ui.ts (the former GET / handler).
// landingRoutes owns GET / and GET /passport to avoid route conflicts.
