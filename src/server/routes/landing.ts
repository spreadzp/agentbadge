import { Hono } from "hono";
import { LandingLayout } from "../../views/landing/layout";
import { LandingPage } from "../../views/landing/landing-page";
import { AgencyHubPage } from "../../views/landing/agency-hub-page";
import { PageMeta as PageMetaRegistry } from "../lib/page-meta";
import { landingJsonLd } from "../lib/json-ld";
import { getNftsForToken, getTopicMessages, type NftInfo } from "@agentgate-hedera/hedera-core";
import { listTasks as marketListTasks } from "@agentgate-hedera/passport";

/**
 * Landing page routes.
 * SLICE-43-1: Old landing moved to /passport, new Agent Readiness landing at /.
 */
export const landingRoutes = new Hono();

// SLICE-51-11: Redirects from old paths → new /services/* paths
landingRoutes.get("/scanner", (c) => c.redirect("/services/scanner", 301));
landingRoutes.get("/marketplace", (c) => c.redirect("/services/marketplace", 301));

/**
 * GET / — Agent Readiness landing page.
 *
 * Renders the new Agent Readiness product landing page.
 * SLICE-43-2: Hero section implemented. More sections in subsequent slices.
 */
landingRoutes.get("/", async (c) => {
  const meta = PageMetaRegistry["/"];
  const jsonLd = landingJsonLd();

  const content = AgencyHubPage().toString();
  const pageHtml = LandingLayout(content, undefined, meta, jsonLd);
  const response = await c.html(pageHtml);
  response.headers.set("Vary", "Accept");
  response.headers.set(
    "Link",
    [
      '</.well-known/api-catalog>; rel="api-catalog"',
      '</.well-known/mcp.json>; rel="service-desc"',
      '</openapi.json>; rel="service-desc"',
      '</.well-known/oauth-authorization-server>; rel="oauth-server"',
      '</sitemap.xml>; rel="sitemap"',
    ].join(", "),
  );
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
 * GET /datahub — 301 redirect to /hackathon/datahub (SLICE-91-2).
 *
 * DataHub moved under /hackathon/:name routing pattern.
 * Query parameters preserved in redirect.
 */
landingRoutes.get("/datahub", (c) => {
  const query = new URL(c.req.url).search;
  return c.redirect(`/hackathon/datahub${query}`, 301);
});

// Note: GET /dashboard is registered in ui.ts (the former GET / handler).
// landingRoutes owns GET /, GET /passport. /datahub now redirects to /hackathon/datahub.
