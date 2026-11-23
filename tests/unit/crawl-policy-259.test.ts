import { describe, it, expect } from "vitest";
import {
  CRAWL_POLICY,
  BOT_CLASSES,
  renderRobotsTxt,
} from "../../src/server/lib/crawl-policy";
import { PUBLIC_PAGES } from "../../src/server/lib/page-meta";

// SLICE-259-14: declarative path→contentClass→search/train matrix is the
// single source for robots.txt. These tests pin the matrix semantics and
// the rendered output (baseline = docs/REVIEW/2211/round4/robots.final.txt
// + selective-train disallows + the /agents$ prefix-bug fix).

const rendered = renderRobotsTxt({ baseUrl: "https://agentbadge.xyz" });

describe("SLICE-259-14: crawl policy matrix", () => {
  it("every policy row is classified and internally valid", () => {
    for (const p of CRAWL_POLICY) {
      expect(p.path.startsWith("/")).toBe(true);
      expect(p.contentClass).toBeTruthy();
      for (const col of ["default", "search", "training", "user"] as const) {
        expect(["allow", "disallow"]).toContain(p[col]);
      }
    }
  });

  it("/rules + /api/rules are search-allow but training-disallow", () => {
    const rules = CRAWL_POLICY.filter(
      (p) => p.contentClass === "rules",
    );
    expect(rules.length).toBeGreaterThanOrEqual(3);
    for (const r of rules) {
      expect(r.search).toBe("allow");
      expect(r.user).toBe("allow");
      expect(r.training).toBe("disallow");
    }
  });

  it("/blog/*.json knowledge objects are training-disallow", () => {
    const ko = CRAWL_POLICY.find((p) => p.path === "/blog/*.json");
    expect(ko).toBeDefined();
    expect(ko!.contentClass).toBe("knowledge");
    expect(ko!.training).toBe("disallow");
    expect(ko!.search).toBe("allow");
  });

  it("/agents uses $-anchored pattern — /agents.txt/.json stay reachable", () => {
    const agents = CRAWL_POLICY.find((p) => p.path === "/agents$");
    expect(agents).toBeDefined();
    // no bare /agents row (it would swallow /agents.txt, /agents.json)
    expect(CRAWL_POLICY.some((p) => p.path === "/agents")).toBe(false);
  });

  it("sensitive paths are disallow for every class", () => {
    for (const p of CRAWL_POLICY.filter(
      (x) => x.contentClass === "sensitive",
    )) {
      for (const col of ["default", "search", "training", "user"] as const) {
        expect(p[col], `${p.path} must be disallow for ${col}`).toBe(
          "disallow",
        );
      }
    }
  });

  it("drift-gate: every PUBLIC_PAGES path resolves to a policy row", () => {
    // A path is "covered" when some policy pattern matches it —
    // prefix match honours `*`/`$` metachars loosely for this gate.
    const uncovered = PUBLIC_PAGES.map((p) => p.path).filter((path) => {
      return !CRAWL_POLICY.some((pol) => {
        const pat = pol.path
          .replace(/\$$/, "")
          .replace(/\*.*$/, "");
        if (pol.path.endsWith("$")) return path === pat;
        if (pol.path.includes("*")) return path.startsWith(pat);
        if (pol.path.endsWith("/"))
          return path.startsWith(pol.path) || path === pol.path.slice(0, -1);
        return path === pol.path || path.startsWith(pol.path + "/");
      });
    });
    expect(uncovered).toEqual([]);
  });
});

describe("SLICE-259-14: renderRobotsTxt", () => {
  it("* group matches robots.final baseline (allow + disallows + api allows)", () => {
    const starGroup = rendered.split("User-agent: *")[1].split("\n\n")[0];
    for (const line of [
      "Allow: /",
      "Disallow: /admin",
      "Disallow: /ui/",
      "Disallow: /a2a/",
      "Disallow: /agents$",
      "Disallow: /agents/",
      "Disallow: /market/tasks/",
      "Disallow: /api/",
      "Allow: /a2a/challenge",
      "Allow: /api/specs",
      "Allow: /api/rules",
      "Allow: /api/search",
      "Crawl-delay: 1",
      "Content-Signal: search=yes, ai-input=yes, ai-train=yes",
    ]) {
      expect(starGroup).toContain(line);
    }
  });

  it("training group repeats base rules + selective-train disallows", () => {
    const tBlock = rendered.split("# AI-training crawlers")[1];
    for (const bot of BOT_CLASSES.training) {
      expect(tBlock).toContain(`User-agent: ${bot}`);
    }
    for (const line of [
      "Disallow: /admin",
      "Disallow: /api/",
      "Allow: /api/specs",
      "Disallow: /rules",
      "Disallow: /api/rules",
      "Disallow: /blog/*.json",
    ]) {
      expect(tBlock).toContain(line);
    }
    // but training still allows /api/rules? NO — selective-train
    // overrides: the api allow stays (allow-listed read endpoints are
    // fine to train on) but /api/rules itself must be a Disallow line.
    expect(tBlock).toContain("Disallow: /api/rules");
  });

  it("seo block fully disallows", () => {
    const seoBlock = rendered.split("high-load crawlers")[1];
    for (const bot of BOT_CLASSES.seo) {
      expect(seoBlock).toContain(`User-agent: ${bot}`);
    }
    expect(seoBlock).toContain("Disallow: /");
  });

  it("real sitemap lines, no example.com placeholder", () => {
    expect(rendered).toContain("Sitemap: https://agentbadge.xyz/sitemap.xml");
    expect(rendered).toContain(
      "Sitemap: https://agentbadge.xyz/ai-sitemap.xml",
    );
    expect(rendered).not.toContain("example.com");
  });
});
