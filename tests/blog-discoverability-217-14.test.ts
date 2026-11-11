/**
 * SLICE-217-14: Blog agent-discoverability + llms.txt/llms-full.txt fixes.
 *
 * Spec checks (docs/EPICS/217-ops-stats-digest/slices/):
 * - Blog: pagination above AND below cards, filter preserved in page links,
 *   tag/channel bar below cards before bottom pagination, newest-first in
 *   list/channel/tag views, rubric <title> carries name + count.
 * - Sitemap: /blog + every ?channel= URL.
 * - llms.txt: /blog + six channel links; no internal tools/routes.
 * - llms-full.txt: no unresolved {{...}}, no stale HBAR payment claims,
 *   "Blog Articles" before half the file, honest annotation description.
 */

import { describe, it, expect } from "vitest";
import {
  buildLlmsTxt,
  buildLlmsFullTxt,
  collectSources,
  type DiscoverySources,
} from "../src/server/lib/agent-discovery";
import { buildSitemap } from "../src/server/routes/well-known/sitemaps";
import {
  BLOG_ARTICLES,
  BLOG_CHANNELS,
  paginateArticles,
} from "../src/server/lib/blog-data";
import { getFaqEntries } from "../src/views/faq-page";
import { makeTestApp, setupMockEnv } from "./e2e/helpers";

setupMockEnv();
const app = makeTestApp();

function realSources(): DiscoverySources {
  return collectSources(app);
}

// ── Blog list view ─────────────────────────────────────────────────────

describe("SLICE-217-14: blog list page", () => {
  it("renders pagination above and below the cards", async () => {
    const r = await app.request("/blog");
    const html = await r.text();
    expect(r.status).toBe(200);
    const navs = html.match(/aria-label="Pagination"/g) ?? [];
    expect(navs.length).toBe(2);
  });

  it("pagination links preserve the channel filter", async () => {
    const r = await app.request("/blog?channel=payments-x402");
    const html = await r.text();
    // Any page-number or prev/next link must keep ?channel= in the URL.
    const links = [...html.matchAll(/href="([^"]+page=[^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) {
      expect(l).toContain("channel=payments-x402");
    }
    // rel=next in <head> keeps the filter too.
    const rel = html.match(/rel="next" href="([^"]+)"/);
    if (rel) expect(rel[1]).toContain("channel=payments-x402");
  });

  it("channel filter bar renders below the article cards", async () => {
    const r = await app.request("/blog");
    const html = await r.text();
    const firstCard = html.indexOf('class="blog-post');
    const bar = html.indexOf("All tags (");
    expect(firstCard).toBeGreaterThan(-1);
    expect(bar).toBeGreaterThan(firstCard);
  });

  it("articles are ordered newest-first", async () => {
    const r = await app.request("/blog");
    const html = await r.text();
    const dates = [...html.matchAll(/datetime="(\d{4}-\d{2}-\d{2})"/g)].map(
      (m) => m[1],
    );
    const sorted = [...dates].sort((a, b) => b.localeCompare(a));
    expect(dates).toEqual(sorted);
  });

  it("channel page title names the rubric and article count", async () => {
    const r = await app.request("/blog?channel=payments-x402");
    const html = await r.text();
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? "";
    expect(title).toContain("Payments &amp; x402");
    expect(title).toMatch(/\d+ articles/);
  });
});

// ── Sitemap ────────────────────────────────────────────────────────────

describe("SLICE-217-14: sitemap", () => {
  it("includes /blog and every channel URL", async () => {
    const xml = buildSitemap();
    expect(xml).toContain("/blog</loc>");
    for (const ch of BLOG_CHANNELS) {
      expect(xml).toContain(`/blog?channel=${ch.key}`);
    }
    // Route smoke check.
    const r = await app.request("/sitemap.xml");
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain("/blog?channel=payments-x402");
  });
});

// ── llms.txt ───────────────────────────────────────────────────────────

describe("SLICE-217-14: llms.txt", () => {
  const txt = buildLlmsTxt(realSources());

  it("links the blog index and all six channels", () => {
    expect(txt).toContain("/blog");
    for (const ch of BLOG_CHANNELS) {
      expect(txt).toContain(`/blog?channel=${ch.key}`);
    }
  });

  it("excludes internal ops tools and routes", () => {
    expect(txt).not.toContain("rebuild_cache");
    expect(txt).not.toContain("[OPS/INTERNAL]");
    expect(txt).not.toContain("circle_wallet_balance");
    expect(txt).not.toContain("payment_history");
    expect(txt).not.toContain("/api/indexer");
    expect(txt).not.toContain("/api/stripe/webhook");
  });
});

// ── llms-full.txt ──────────────────────────────────────────────────────

describe("SLICE-217-14: llms-full.txt", () => {
  const txt = buildLlmsFullTxt(realSources());

  it("has no unresolved template placeholders", () => {
    expect(txt).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it("states content honestly — annotations + links, not full text", () => {
    expect(txt).toContain("/blog/<slug>.md");
    expect(txt).not.toContain("whole site corpus");
  });

  it("keeps mainnet/testnet chain IDs labelled", () => {
    expect(txt).toContain("eip155:5042");
    expect(txt).toContain("eip155:5042002");
  });

  it("never names a network as the payment currency", () => {
    // The old bug: "pays in {{CHAIN_NAME}}" rendered a chain name as the
    // currency ("pays in Arc Mainnet"). Currency is env-resolved
    // ({{CURRENCY}}), so we ban chain names after "pays in" only.
    expect(txt).not.toMatch(/pays in (Arc|Hedera|Base)( Mainnet| Testnet| Sepolia)?/i);
  });

  it("puts Blog Articles before half the file", () => {
    const pos = txt.indexOf("## Blog Articles");
    expect(pos).toBeGreaterThan(-1);
    expect(pos).toBeLessThan(txt.length / 2);
  });
});

// ── FAQ template resolution ────────────────────────────────────────────

describe("SLICE-217-14: FAQ templates", () => {
  it("no question or answer retains {{...}}", () => {
    for (const e of getFaqEntries()) {
      expect(e.question).not.toContain("{{");
      expect(e.answer).not.toContain("{{");
    }
  });
});

// ── Content hygiene ────────────────────────────────────────────────────

describe("SLICE-217-14: article hygiene", () => {
  it("Hedera-era articles carry the legacy flag", () => {
    const x402 = BLOG_ARTICLES.find((a) => a.slug === "x402-payments");
    expect(x402?.legacy).toBe(true);
    expect(x402?.tags).not.toContain("hbar");
  });

  it("paginateArticles keeps the provided (sorted) order", () => {
    const sorted = [...BLOG_ARTICLES].sort((a, b) =>
      b.date.localeCompare(a.date),
    );
    const { items } = paginateArticles(sorted, 1);
    expect(items[0]?.date).toBe(sorted[0].date);
  });
});
