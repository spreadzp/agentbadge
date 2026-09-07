import { describe, it, expect } from "vitest";
import {
  aboutPageLd,
  collectionPageLd,
  webPageLd,
  personLd,
  breadcrumbFor,
  defaultCoreSchemas,
} from "../../../src/server/lib/json-ld";
import { TEAM_MEMBERS } from "../../../src/server/lib/team-data";

/**
 * SLICE-112-5: Fix /about, /pricing, /rules schema types.
 *
 * /about should use AboutPage (not Article)
 * /pricing should use WebPage (not Article)
 * /rules should use CollectionPage (not FAQPage)
 */
describe("SLICE-112-5: Fix schema types on /about, /pricing, /rules", () => {
  function findType(schemas: object[], type: string): Record<string, unknown> | undefined {
    return schemas.find(
      (s) => (s as Record<string, unknown>)["@type"] === type,
    ) as Record<string, unknown> | undefined;
  }

  // ─── /about ───
  it("/about has AboutPage schema (not Article)", () => {
    const schemas = [
      ...defaultCoreSchemas(),
      ...TEAM_MEMBERS.map((m) =>
        personLd({ name: m.name, role: m.role, description: m.bio, url: m.url, linkedin: m.linkedin }),
      ),
      aboutPageLd({
        title: "About AgentBadge — On-Chain Identity for AI Agents",
        description: "AgentBadge gives AI agents a verifiable on-chain identity on Hedera.",
        path: "/about",
      }),
      breadcrumbFor("/about", "About"),
    ];
    expect(findType(schemas, "AboutPage")).toBeDefined();
    expect(findType(schemas, "Article")).toBeUndefined();
  });

  it("/about still has Person schemas for team members", () => {
    const schemas = [
      ...defaultCoreSchemas(),
      ...TEAM_MEMBERS.map((m) =>
        personLd({ name: m.name, role: m.role, description: m.bio, url: m.url, linkedin: m.linkedin }),
      ),
      aboutPageLd({
        title: "About AgentBadge",
        description: "About page",
        path: "/about",
      }),
    ];
    const persons = schemas.filter((s) => (s as Record<string, unknown>)["@type"] === "Person");
    expect(persons.length).toBe(TEAM_MEMBERS.length);
  });

  // ─── /pricing ───
  it("/pricing has WebPage schema (not Article)", () => {
    const schemas = [
      ...defaultCoreSchemas(),
      webPageLd({
        title: "AgentBadge Pricing — Passport Tiers in HBAR",
        description: "Passport tier pricing on Hedera.",
        path: "/pricing",
      }),
      breadcrumbFor("/pricing", "Pricing"),
    ];
    expect(findType(schemas, "WebPage")).toBeDefined();
    expect(findType(schemas, "Article")).toBeUndefined();
  });

  // ─── /rules ───
  it("/rules has CollectionPage schema (not FAQPage)", () => {
    const schemas = [
      ...defaultCoreSchemas(),
      collectionPageLd({
        name: "Rules Catalog",
        description: "All agent readiness rules across categories.",
        path: "/rules",
      }),
      breadcrumbFor("/rules", "Rules"),
    ];
    expect(findType(schemas, "CollectionPage")).toBeDefined();
    expect(findType(schemas, "FAQPage")).toBeUndefined();
  });
});
