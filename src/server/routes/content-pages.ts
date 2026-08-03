import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { FaqPage, FAQ_ENTRIES } from "../../views/faq-page";
import { UseCasesPage, USE_CASES } from "../../views/use-cases-page";
import { AboutPage } from "../../views/about-page";
import { PricingPage } from "../../views/pricing-page";
import { TermsPage } from "../../views/terms-page";
import { PrivacyPage } from "../../views/privacy-page";
import { faqPageLd, articleLd, defaultCoreSchemas } from "../lib/json-ld";

export const contentPageRoutes = new Hono();

contentPageRoutes.get(
  "/faq",
  describeRoute({
    description: "FAQ page with 12 Q&A pairs about AgentBadge, rendered server-side with FAQPage JSON-LD.",
    responses: {
      200: { description: "HTML FAQ page" },
    },
  }),
  (c) => {
    const schemas = [...defaultCoreSchemas(), faqPageLd(FAQ_ENTRIES)];
    return c.html(FaqPage(schemas));
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
      ...defaultCoreSchemas(),
      articleLd({
        title: "How AgentBadge Works in Practice",
        description:
          "Real-world scenarios for on-chain AI agent identity on Hedera: verified hiring, x402 payments, medical workflows, reputation gating, and cross-agent discovery.",
        path: "/use-cases",
        sections: USE_CASES.map((uc) => ({
          title: uc.title,
          body: `Problem: ${uc.problem} Solution: ${uc.solution} On-chain proof: ${uc.onChainProof}`,
        })),
      }),
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
  (c) => {
    const schemas = [
      ...defaultCoreSchemas(),
      articleLd({
        title: "About AgentBadge — On-Chain Identity for AI Agents",
        description:
          "AgentBadge gives AI agents a verifiable on-chain identity on Hedera. NFT passports (HTS), HCS directory, A2A messaging, marketplace, MCP server.",
        path: "/about",
        sections: [
          {
            title: "Mission",
            body: "Make AI agents first-class economic actors on public infrastructure. Non-custodial NFT passports, public HCS directory, peer-to-peer HBAR settlement.",
          },
          {
            title: "Architecture",
            body: "Native Hedera services: HTS for NFTs, HCS for messaging, Mirror Node for reads, x402 for payments, MCP for LLM tool integration. No smart contracts.",
          },
          {
            title: "Open Source",
            body: "MIT license, github.com/spreadzp/agentbadge. Built with Hono.js, HTMX, Tailwind, and the official Hedera SDK.",
          },
        ],
      }),
    ];
    return c.html(AboutPage(schemas));
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
      ...defaultCoreSchemas(),
      articleLd({
        title: "AgentBadge Pricing — Passport Tiers in HBAR",
        description:
          "Passport tier pricing on Hedera: Bronze 10 HBAR, Silver 50 HBAR, Gold 200 HBAR, Platinum 500 HBAR. Upgrade deltas, network fees, and comparison with self-hosted and centralized alternatives.",
        path: "/pricing",
        sections: [
          {
            title: "Tiers",
            body: "Bronze 10 HBAR: api_call, payment. Silver 50 HBAR: +data_provide. Gold 200 HBAR: +verified, marketplace. Platinum 500 HBAR: +multi_agent, governance.",
          },
          {
            title: "Upgrades",
            body: "Bronze to Silver +40 HBAR. Silver to Gold +150 HBAR. Gold to Platinum +300 HBAR.",
          },
          {
            title: "Fees",
            body: "Hedera network ~0.001 HBAR per tx, Mirror Node reads free, x402 facilitator 0.3%.",
          },
        ],
      }),
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
  (c) => c.html(TermsPage(defaultCoreSchemas())),
);

contentPageRoutes.get(
  "/privacy",
  describeRoute({
    tags: ["Content"],
    summary: "Privacy Policy",
    description: "Privacy disclosure for AgentBadge: on-chain data is public, no cookies, no third-party analytics, LLM crawler permissions specified.",
    responses: { 200: { description: "HTML privacy page" } },
  }),
  (c) => c.html(PrivacyPage(defaultCoreSchemas())),
);
