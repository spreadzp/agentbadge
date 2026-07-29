import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { FaqPage, FAQ_ENTRIES } from "../../views/faq-page";
import { UseCasesPage, USE_CASES } from "../../views/use-cases-page";
import { faqPageLd, articleLd, defaultCoreSchemas } from "../lib/json-ld";

export const contentPageRoutes = new Hono();

contentPageRoutes.get(
  "/faq",
  describeRoute({
    description: "FAQ page with 12 Q&A pairs about AgentGate, rendered server-side with FAQPage JSON-LD.",
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
        title: "How AgentGate Works in Practice",
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
