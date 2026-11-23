import { describe, it, expect } from "vitest";

process.env.MOCK_HEDERA = "true";
const { createApp } = await import("../src/server/index");

// SLICE-259-20: Hedera/HTS/HCS/HBAR are the LEGACY stack — every
// occurrence on a current-facing surface must sit next to a legacy
// marker ("legacy:", "historical", "deprecated", "read-only").
// Arc/USDC/ERC-721 is the current stack — taught literally.

const app = createApp();

const LEGACY_TERM = /\b(?:Hedera|HTS|HCS|HBAR|did:hcs)\b/gi;
const LEGACY_MARKER = /legacy|historical|deprecated|read-only/i;
const WINDOW = 200;

/** Strip dated blog-article bodies (historical documents). */
function stripArticleBodies(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inArticle = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^###\s/.test(l)) {
      // Article body header: next ~3 lines carry "URL:" + "Date:".
      inArticle = lines
        .slice(i + 1, i + 4)
        .some((x) => /^Date:\s*\d{4}-\d{2}-\d{2}/.test(x));
    }
    if (/^##\s/.test(l)) inArticle = false;
    if (!inArticle) out.push(l);
  }
  return out.join("\n");
}

/** Every match must have a legacy marker within ±WINDOW chars. */
function unmarkedOccurrences(text: string, path: string): string[] {
  const bad: string[] = [];
  for (const m of text.matchAll(LEGACY_TERM)) {
    const i = m.index ?? 0;
    const ctx = text.slice(
      Math.max(0, i - WINDOW),
      Math.min(text.length, i + m[0].length + WINDOW),
    );
    if (!LEGACY_MARKER.test(ctx)) {
      bad.push(`${path} @${i}: "${m[0]}" …${ctx.replace(/\s+/g, " ").trim().slice(0, 140)}…`);
    }
  }
  return bad;
}

const SURFACES = [
  "/",
  "/passport",
  "/faq",
  "/faq.md",
  "/faq.json",
  "/about",
  "/about.md",
  "/pricing",
  "/pricing.md",
  "/index.md",
  "/llms.txt",
  "/agents.txt",
  "/.well-known/agent-card.json",
];

describe("legacy wording gate — current-facing surfaces", () => {
  for (const path of SURFACES) {
    it(`${path}: every Hedera|HTS|HCS|HBAR|did:hcs is legacy-marked`, async () => {
      const res = await app.request(path);
      expect(res.status, `${path} unreachable`).toBe(200);
      const bad = unmarkedOccurrences(await res.text(), path);
      expect(bad, bad.join("\n")).toEqual([]);
    });
  }

  it("/llms-full.txt: manifest sections legacy-marked (dated articles exempt)", async () => {
    const res = await app.request("/llms-full.txt");
    expect(res.status).toBe(200);
    const bad = unmarkedOccurrences(stripArticleBodies(await res.text()), "/llms-full.txt");
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("current stack is taught literally on /faq", async () => {
    const html = await (await app.request("/faq")).text();
    expect(html).toContain("USDC");
    expect(html).toContain("Arc");
  });
});
