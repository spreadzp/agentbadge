import { Hono } from "hono";
import { html, raw } from "hono/html";
import { LandingLayout } from "../../views/landing/layout";
import { HeroSection } from "../../views/landing/hero";
import { LiveStatsSection } from "../../views/landing/live-stats";
import { ProblemSolutionSection } from "../../views/landing/problem-solution";
import { FeaturesSection } from "../../views/landing/features";
import { HowItWorksSection } from "../../views/landing/how-it-works";
import { ForWhoSection } from "../../views/landing/for-who";
import { ArchitectureSection } from "../../views/landing/architecture";
import { PricingPreviewSection } from "../../views/landing/pricing-preview";
import { PageMeta as PageMetaRegistry, type PageMeta } from "../lib/page-meta";
import { defaultCoreSchemas, landingJsonLd } from "../lib/json-ld";
import { getNftsForToken, getTopicMessages, type NftInfo, type Tier } from "@agentgate-hedera/hedera-core";
import { retrieveMetadata } from "@agentgate-hedera/passport";
import { listTasks as marketListTasks } from "@agentgate-hedera/passport";

/**
 * Landing page routes.
 * (SLICE-19-2)
 *
 * GET /           — landing page (marketing)
 * GET /dashboard  — dashboard page (was previously GET / in ui.ts)
 */
export const landingRoutes = new Hono();

/**
 * GET / — landing page.
 *
 * Renders the landing page using LandingLayout.
 * The actual page content (sections) will be assembled by LandingPage()
 * in SLICE-19-11. For now, a placeholder is rendered.
 */
landingRoutes.get("/", async (c) => {
  const meta = PageMetaRegistry["/"];
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

  const content = HeroSection().toString() + LiveStatsSection({ totalIssued, activeCount, totalUpgrades, tasksCount }).toString() + ProblemSolutionSection().toString() + FeaturesSection().toString() + HowItWorksSection().toString() + ForWhoSection().toString() + ArchitectureSection().toString() + PricingPreviewSection().toString();
  const pageHtml = LandingLayout(content, undefined, meta, jsonLd);
  return c.html(pageHtml);
});

// Note: GET /dashboard is registered in ui.ts (the former GET / handler).
// landingRoutes only owns GET / to avoid route conflicts.
