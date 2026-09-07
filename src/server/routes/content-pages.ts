import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { FaqPage, getFaqEntries } from "../../views/faq-page";
import { UseCasesPage, USE_CASES } from "../../views/use-cases-page";
import { AboutPage } from "../../views/about-page";
import { PricingPage } from "../../views/pricing-page";
import { TermsPage } from "../../views/terms-page";
import { PrivacyPage } from "../../views/privacy-page";
import { Layout } from "../../views/layout";
import { RulesCatalogPage } from "../../views/rules-catalog-page";
import { RuleDetailPage, getRuleDescription } from "../../views/rule-detail-page";
import { buildRuleApiResponse } from "../lib/rule-api-builder";
import { ChecklistPage } from "../../views/checklist-page";
import { ComparisonPage } from "../../views/comparison-page";
import { ComparisonHubPage } from "../../views/comparison-hub-page";
import { COMPARISON_PAGES, getComparisonPage } from "../lib/comparison-data";
import { CLUSTER_PAGES, getClusterPage } from "../lib/cluster-data";
import { ClusterPage } from "../../views/cluster-page";
import { marked } from "marked";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function renderMarkdown(contentFile: string): string {
  const fullPath = join(__dirname, "..", contentFile.replace("src/server/", ""));
  try {
    const md = readFileSync(fullPath, "utf-8");
    return marked.parse(md, { async: false }) as string;
  } catch {
    return "";
  }
}
import { faqPageLd, articleLd, pageCoreSchemas, personLd, breadcrumbFor, aboutPageLd, webPageLd } from "../lib/json-ld";
import { TEAM_MEMBERS } from "../lib/team-data";
import { getRegistry } from "../registry/loader";
import type { RegistryIndex } from "../registry/types";

export const contentPageRoutes = new Hono();

contentPageRoutes.get(
  "/faq",
  describeRoute({
    description: "FAQ page with 40+ Q&A pairs about AgentBadge, organized by category, rendered server-side with FAQPage JSON-LD.",
    responses: {
      200: { description: "HTML FAQ page" },
    },
  }),
  (c) => {
    const allEntries = getFaqEntries();
    const schemas = [...pageCoreSchemas(), faqPageLd(allEntries), breadcrumbFor("/faq", "FAQ")];
    return c.html(FaqPage(allEntries, schemas));
  },
);

contentPageRoutes.get(
  "/use-cases",
  describeRoute({
    description: "Use cases page with 5 real-world scenarios, rendered server-side with Article JSON-LD.",
    responses: {
      200: { description: "HTML use cases page" },
    },
  }),
  (c) => {
    const schemas = [
      ...pageCoreSchemas(),
      articleLd({
        title: "Use Cases — How AI Agents Use AgentBadge",
        description:
          "Real-world scenarios for on-chain AI agent identity on Hedera: verified hiring, x402 payments, medical workflows, reputation gating, and cross-agent discovery.",
        path: "/use-cases",
        sections: USE_CASES.map((uc) => ({
          title: uc.title,
          body: `Problem: ${uc.problem} Solution: ${uc.solution} On-chain proof: ${uc.onChainProof}`,
        })),
      }),
      breadcrumbFor("/use-cases", "Use Cases"),
    ];
    return c.html(UseCasesPage(schemas));
  },
);

contentPageRoutes.get(
  "/about",
  describeRoute({
    tags: ["Content"],
    summary: "About AgentBadge",
    description: "Mission, architecture, and open-source information about AgentBadge.",
    responses: { 200: { description: "HTML about page" } },
  }),
  async (c) => {
    let registry: RegistryIndex | undefined;
    try {
      registry = await getRegistry();
    } catch {
      // Registry load failed — page still renders with static data
    }
    const schemas = [
      ...pageCoreSchemas(),
      ...TEAM_MEMBERS.map((m) =>
        personLd({
          name: m.name,
          role: m.role,
          description: m.bio,
          url: m.url,
          linkedin: m.linkedin,
        })
      ),
      aboutPageLd({
        title: "About AgentBadge — On-Chain Identity for AI Agents",
        description:
          "AgentBadge gives AI agents a verifiable on-chain identity on Hedera. NFT passports (HTS), HCS directory, A2A messaging, marketplace, MCP server.",
        path: "/about",
      }),
      breadcrumbFor("/about", "About"),
    ];
    return c.html(AboutPage(schemas, registry));
  },
);

contentPageRoutes.get(
  "/pricing",
  describeRoute({
    tags: ["Content"],
    summary: "Passport pricing in HBAR",
    description:
      "Public pricing for AgentBadge passport tiers: Bronze 10 HBAR, Silver 50 HBAR, Gold 200 HBAR, Platinum 500 HBAR. Includes upgrade deltas and comparison with alternatives.",
    responses: { 200: { description: "HTML pricing page" } },
  }),
  (c) => {
    const schemas = [
      ...pageCoreSchemas(),
      webPageLd({
        title: "AgentBadge Pricing — Passport Tiers in HBAR",
        description:
          "Passport tier pricing on Hedera: Bronze 10 HBAR, Silver 50 HBAR, Gold 200 HBAR, Platinum 500 HBAR. Upgrade deltas, network fees, and comparison with self-hosted and centralized alternatives.",
        path: "/pricing",
      }),
      breadcrumbFor("/pricing", "Pricing"),
    ];
    return c.html(PricingPage(schemas));
  },
);

contentPageRoutes.get(
  "/terms",
  describeRoute({
    tags: ["Content"],
    summary: "Terms of Service",
    description: "Legal terms governing the use of AgentBadge. MIT-licensed, no warranty, testnet service.",
    responses: { 200: { description: "HTML terms page" } },
  }),
  (c) => c.html(TermsPage([...pageCoreSchemas(), webPageLd({ title: "Terms of Service", description: "Legal terms governing the use of AgentBadge. MIT-licensed, no warranty, testnet service.", path: "/terms" }), breadcrumbFor("/terms", "Terms")])),
);

contentPageRoutes.get(
  "/privacy",
  describeRoute({
    tags: ["Content"],
    summary: "Privacy Policy",
    description: "Privacy disclosure for AgentBadge: on-chain data is public, no cookies, no third-party analytics, LLM crawler permissions specified.",
    responses: { 200: { description: "HTML privacy page" } },
  }),
  (c) => c.html(PrivacyPage([...pageCoreSchemas(), webPageLd({ title: "Privacy Policy", description: "Privacy disclosure for AgentBadge: on-chain data is public, no cookies, no third-party analytics, LLM crawler permissions specified.", path: "/privacy" }), breadcrumbFor("/privacy", "Privacy")])),
);

contentPageRoutes.get(
  "/rules",
  describeRoute({
    tags: ["Content"],
    summary: "Rules Catalog",
    description:
      "All agent readiness rules across categories with plain-language descriptions, effort hints, and cost estimates.",
    responses: { 200: { description: "HTML rules catalog page" } },
  }),
  (c) => {
    return c.html(RulesCatalogPage());
  },
);

contentPageRoutes.get(
  "/rules/:id.json",
  describeRoute({
    tags: ["Content"],
    summary: "Rule Detail (JSON)",
    description: "Machine-readable JSON for a single agent readiness rule. Same response as GET /api/rules/:id.",
    responses: {
      200: { description: "JSON rule data" },
      404: { description: "Rule not found" },
    },
  }),
  (c) => {
    const ruleId = c.req.param("id") ?? "";
    const rule = buildRuleApiResponse(ruleId);
    if (!rule) {
      return c.json({ error: "Rule not found", rule_id: ruleId }, 404);
    }
    return c.json(rule, 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    });
  },
);

contentPageRoutes.get(
  "/rules/:id",
  describeRoute({
    tags: ["Content"],
    summary: "Rule Detail",
    description: "Detailed page for a single agent readiness rule with examples, effort, and cost.",
    responses: {
      200: { description: "HTML rule detail page" },
      404: { description: "Rule not found" },
    },
  }),
  (c) => {
    const ruleId = c.req.param("id");
    const rule = getRuleDescription(ruleId);
    if (!rule) {
      return c.html(Layout("Rule not found", "404 — Rule Not Found", { title: "404", description: "Rule not found", path: "/404" }, defaultCoreSchemas()), 404);
    }
    return c.html(RuleDetailPage(rule));
  },
);

contentPageRoutes.get(
  "/agent-readiness-checklist",
  describeRoute({
    tags: ["Content"],
    summary: "Agent Readiness Checklist",
    description:
      "Dynamic checklist of all agent readiness rules with stable anchors, core rule highlighting, and editorial intro.",
    responses: { 200: { description: "HTML checklist page" } },
  }),
  (c) => {
    return c.html(ChecklistPage());
  },
);

// Comparison hub page
contentPageRoutes.get(
  "/comparisons",
  describeRoute({
    tags: ["Content"],
    summary: "AgentBadge vs Other Tools — Comparisons Hub",
    description: "Overview comparison table and links to detailed comparisons: AgentBadge vs MCP, vs Postman, vs Swagger.",
    responses: { 200: { description: "HTML comparisons hub page" } },
  }),
  (c) => {
    return c.html(ComparisonHubPage());
  },
);

// Individual comparison pages
for (const page of COMPARISON_PAGES) {
  contentPageRoutes.get(
    `/comparisons/${page.slug}`,
    describeRoute({
      tags: ["Content"],
      summary: page.title,
      description: page.description,
      responses: { 200: { description: "HTML comparison page" } },
    }),
    (c) => {
      const data = getComparisonPage(page.slug);
      if (!data) return c.html("Not found", 404);
      const markdownHtml = renderMarkdown(data.contentFile);
      return c.html(ComparisonPage(data, markdownHtml));
    },
  );
}

// Cluster pages (SLICE-116-3)
for (const page of CLUSTER_PAGES) {
  contentPageRoutes.get(
    `/${page.slug}`,
    describeRoute({
      tags: ["Content"],
      summary: page.title,
      description: page.description,
      responses: { 200: { description: "HTML cluster page" } },
    }),
    (c) => {
      const data = getClusterPage(page.slug);
      if (!data) return c.html("Not found", 404);
      const markdownHtml = renderMarkdown(data.contentFile);
      return c.html(ClusterPage(data, markdownHtml));
    },
  );
}
