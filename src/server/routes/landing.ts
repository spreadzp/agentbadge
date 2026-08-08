import { Hono } from "hono";
import { html, raw } from "hono/html";
import { LandingLayout } from "../../views/landing/layout";
import { LandingPage } from "../../views/landing/landing-page";
import { ReadinessLandingPage } from "../../views/landing/readiness-landing-page";
import { DataHubLandingPage } from "../../views/landing/datahub-landing-page";
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
 * GET / — Agent Readiness landing page.
 *
 * Renders the new Agent Readiness product landing page.
 * SLICE-43-2: Hero section implemented. More sections in subsequent slices.
 */
landingRoutes.get("/", async (c) => {
  const meta = PageMetaRegistry["/"];
  const jsonLd = landingJsonLd();

  const content = ReadinessLandingPage().toString();
  const pageHtml = LandingLayout(content, undefined, meta, jsonLd);
  const response = await c.html(pageHtml);
  response.headers.set("Vary", "Accept");
  return response;
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

/**
 * GET /datahub — DataHub hackathon landing page.
 *
 * Showcases how AgentBadge integrates DataHub MCP Server for medical data
 * verification with Hedera escrow. Linked from the dashboard sidebar.
 */
landingRoutes.get("/datahub", async (c) => {
  const meta = PageMetaRegistry["/datahub"];
  const jsonLd = landingJsonLd();

  const content = DataHubLandingPage().toString();
  const pageHtml = LandingLayout(content, undefined, meta, jsonLd);
  return c.html(pageHtml);
});

// Note: GET /dashboard is registered in ui.ts (the former GET / handler).
// landingRoutes owns GET /, GET /passport, and GET /datahub to avoid route conflicts.
