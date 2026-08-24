import { describe, it, expect } from "bun:test";
import { landingJsonLd } from "../../src/server/lib/json-ld";
import { getCatalog } from "@agentgate-hedera/hedera-core";

/**
 * SLICE-80-1: FAQ/Offer JSON-LD prices must match catalog source.
 *
 * The landing page emits a FAQPage JSON-LD with an answer mentioning
 * tier prices. Those prices must match getCatalog() — the single
 * source of truth used by /catalog and /pricing.json.
 *
 * Additionally, the HowTo estimatedCost must match the minimum tier
 * price (bronze).
 */
describe("SLICE-80-1: JSON-LD price sync with catalog", () => {
  const catalog = getCatalog();
  const tiersByName = Object.fromEntries(
    catalog.map((t) => [t.name.toLowerCase(), t]),
  );

  it("FAQPage answer for tiers matches catalog prices", () => {
    const schemas = landingJsonLd();
    const faq = schemas.find(
      (s) => (s as Record<string, unknown>)["@type"] === "FAQPage",
    ) as Record<string, unknown> | undefined;

    expect(faq).toBeDefined();

    const mainEntity = faq!.mainEntity as Array<{
      name: string;
      acceptedAnswer: { text: string };
    }>;

    const tiersQa = mainEntity.find(
      (qa) => qa.name === "What is the difference between passport tiers?",
    );

    expect(tiersQa).toBeDefined();

    const answerText = tiersQa!.acceptedAnswer.text;

    for (const tier of catalog) {
      const tierName = tier.name.charAt(0).toUpperCase() + tier.name.slice(1);
      const expectedPattern = new RegExp(
        `${tierName}.*?\\(${tier.price} HBAR\\)`,
        "i",
      );
      expect(answerText).toMatch(expectedPattern);
    }
  });

  it("FAQPage answer for 'Is AgentBadge free' mentions correct minimum price", () => {
    const schemas = landingJsonLd();
    const faq = schemas.find(
      (s) => (s as Record<string, unknown>)["@type"] === "FAQPage",
    ) as Record<string, unknown> | undefined;

    const mainEntity = faq!.mainEntity as Array<{
      name: string;
      acceptedAnswer: { text: string };
    }>;

    const freeQa = mainEntity.find((qa) =>
      qa.name.toLowerCase().includes("free"),
    );

    expect(freeQa).toBeDefined();

    const bronzePrice = tiersByName["bronze"].price;
    expect(freeQa!.acceptedAnswer.text).toContain(
      `from ${bronzePrice} HBAR`,
    );
  });

  it("HowTo estimatedCost matches minimum tier price (bronze)", () => {
    const schemas = landingJsonLd();
    const howTo = schemas.find(
      (s) => (s as Record<string, unknown>)["@type"] === "HowTo",
    ) as Record<string, unknown> | undefined;

    expect(howTo).toBeDefined();

    const estimatedCost = howTo!.estimatedCost as {
      currency: string;
      value: string;
    };

    const bronzePrice = tiersByName["bronze"].price;
    expect(estimatedCost.value).toBe(String(bronzePrice));
  });

  it("SoftwareApplication OfferCatalog prices match catalog", () => {
    const schemas = landingJsonLd();
    const app = schemas.find(
      (s) => (s as Record<string, unknown>)["@type"] === "SoftwareApplication",
    ) as Record<string, unknown> | undefined;

    expect(app).toBeDefined();

    const offers = app!.offers as {
      itemListElement: Array<{
        name: string;
        price: string;
        priceCurrency: string;
      }>;
    };

    const offerList = offers.itemListElement;

    for (const tier of catalog) {
      const offer = offerList.find((o) =>
        o.name.toLowerCase().startsWith(tier.name.toLowerCase()),
      );
      expect(offer).toBeDefined();
      expect(offer!.price).toBe(String(tier.price));
    }
  });
});
