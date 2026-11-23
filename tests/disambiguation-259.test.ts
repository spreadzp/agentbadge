import { describe, it, expect, beforeAll } from "vitest";

process.env.MOCK_HEDERA = "true";
const { createApp } = await import("../src/server/index");
const { BRAND_DISAMBIGUATION, BRAND_SAME_AS } = await import(
  "../src/server/lib/brand"
);

// SLICE-259-25: brand disambiguation vs the foreign unscoped npm
// package `agentbadge` (Emreceyhnn/Agentbadge — repo scoring for
// AI coding agents). Every agent-facing surface must carry the
// same disambiguation sentence; Organization JSON-LD must carry
// disambiguatingDescription + canonical sameAs profiles.

const app = createApp();
const texts = new Map<string, string>();

beforeAll(async () => {
  for (const p of [
    "/",
    "/index.md",
    "/llms.txt",
    "/skill.md",
    "/about",
    "/about.md",
    "/faq",
    "/faq.json",
  ]) {
    const res = await app.request(p);
    expect(res.status, p).toBe(200);
    texts.set(p, await res.text());
  }
});

describe("SLICE-259-25: brand disambiguation", () => {
  it.each(["/index.md", "/llms.txt", "/skill.md", "/about", "/about.md"])(
    "%s carries the shared disambiguation sentence",
    (p) => {
      expect(texts.get(p)).toContain("Emreceyhnn/Agentbadge");
      expect(texts.get(p)).toContain("@agentbadge/*");
      expect(texts.get(p)).toContain("not affiliated");
    },
  );

  it("homepage markdown (Accept: text/markdown) carries it too", async () => {
    const res = await app.request("/", {
      headers: { Accept: "text/markdown" },
    });
    const md = await res.text();
    expect(md).toContain("Emreceyhnn/Agentbadge");
  });

  it("agent-card x-agentbadge.disambiguation matches shared text", async () => {
    const res = await app.request("/.well-known/agent-card.json");
    const card = (await res.json()) as {
      "x-agentbadge"?: { disambiguation?: string };
    };
    expect(card["x-agentbadge"]?.disambiguation).toBe(BRAND_DISAMBIGUATION);
  });

  it("Organization JSON-LD: disambiguatingDescription + sameAs profiles", () => {
    // pageCoreSchemas (webSite + Organization) ride on content pages
    // like /faq — the homepage ships no inline JSON-LD.
    const html = texts.get("/faq")!;
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap(
      (m) => {
        const parsed = JSON.parse(m[1]) as
          | Record<string, unknown>
          | Record<string, unknown>[];
        return Array.isArray(parsed) ? parsed : [parsed];
      },
    );
    const org = blocks.find((b) => b["@type"] === "Organization");
    expect(org, "Organization JSON-LD present").toBeTruthy();
    expect(org!.disambiguatingDescription as string).toContain(
      "agentbadge.xyz",
    );
    const sameAs = org!.sameAs as string[];
    for (const profile of BRAND_SAME_AS) {
      expect(sameAs, `sameAs missing ${profile}`).toContain(profile);
    }
  });

  it("sameAs never lists the foreign repo as ours", () => {
    for (const [p, html] of texts) {
      if (!html.includes("application/ld+json")) continue;
      const sameAsMatches = [
        ...html.matchAll(/"sameAs"\s*:\s*\[([\s\S]*?)\]/g),
      ];
      for (const m of sameAsMatches) {
        expect(m[1], `sameAs on ${p}`).not.toContain("Emreceyhnn");
      }
    }
  });

  it("FAQ has the npm-collision Q&A with a resolvable anchor", () => {
    const faq = texts.get("/faq")!;
    expect(faq).toContain('npm package "agentbadge"');
    expect(faq).toContain("Emreceyhnn/Agentbadge");
    expect(faq).toContain(
      'id="is-agentbadge-the-same-as-the-npm-package-agentbadge"',
    );
    const faqJson = JSON.parse(texts.get("/faq.json")!) as {
      entries?: { question: string }[];
    };
    expect(
      faqJson.entries?.some((x) =>
        x.question.includes('npm package "agentbadge"'),
      ),
    ).toBe(true);
  });

  it("disambiguation names the npm scope, never the unscoped install", () => {
    for (const p of ["/llms.txt", "/skill.md", "/index.md"]) {
      const body = texts.get(p)!;
      expect(body).toContain("@agentbadge/*");
      // The only bare `agentbadge` mention must be inside the
      // disambiguation sentence itself (quoted npm name).
      expect(body).not.toMatch(/npm install(?: -g)? agentbadge\b/);
    }
  });
});
