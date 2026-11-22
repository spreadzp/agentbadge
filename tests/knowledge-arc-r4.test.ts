import { describe, expect, it } from "vitest";

import {
  addEvidence,
  collectSeedCapabilities,
  createKnowledgeItem,
  createMemoryKnowledgeStores,
  isPublicEvidenceUri,
  resolveGap,
  seedCapabilities,
  triageGap,
} from "../src/server/lib/knowledge";
import { approveTransition } from "./helpers/knowledge";
import { cjkTerms, tokenizeTerms } from "../src/server/lib/knowledge/terms";
import { flashBanner } from "../src/views/admin-knowledge/shared";
import { Layout } from "../src/views/chrome/layout";

/**
 * Arc Studio R4 regression pack — one test per finding class:
 * - H-1: trailing-dot hostnames + hex-form compat-v6 bypass the
 *   evidence-URI classifier.
 * - M-1: capped gap reopen keeps linkedItemId (memory parity w/ PG).
 * - M-4: store enforces from→to legality under its own lock.
 * - M-5: hiragana-only terms can't fake CJK coverage; Hangul is
 *   spaced, so it stays in the latin lane.
 * - M-6: `ok` flash whitelisted like `err` — no free-text banners.
 * - M-8: degraded-manifest guard skips mass drift un-verify.
 * - M-11: vendored htmx + analytics scripts off /admin pages.
 */

const OP = "ops_test";

const mkItem = async (store: ReturnType<typeof createMemoryKnowledgeStores>) => {
  const c = await createKnowledgeItem(
    store, { kind: "GUIDE", title: "x", body: "b" }, OP,
  );
  if (!c.ok) throw new Error("create failed");
  return c;
};

describe("Arc R4 — H-1 classifier boundary", () => {
  it.each([
    ["trailing-dot localhost", "https://localhost./x", false],
    ["trailing-dot metadata", "https://metadata./x", false],
    ["trailing-dot internal", "https://svc.internal./x", false],
    ["compat-v6 hextet loopback", "https://[::7f00:1]/x", false],
    ["compat-v6 hextet private", "https://[::a00:1]/x", false],
    ["mapped-v6 hextet loopback", "https://[::ffff:7f00:1]/x", false],
    ["dotted compat-v6 private", "https://[::127.0.0.1]/x", false],
    ["dotted compat-v6 public", "https://[::1.2.3.4]/x", true],
    ["v6 unspecified", "https://[::]/x", false],
    ["public host", "https://a.example.com/x", true],
  ])("%s → %s", (_label, uri, want) => {
    expect(isPublicEvidenceUri(uri)).toBe(want);
  });
});

describe("Arc R4 — M-1 capped reopen keeps linkedItemId", () => {
  it("RESOLVED gap at openCap: bump lands, link survives", async () => {
    const store = createMemoryKnowledgeStores();
    const c = await mkItem(store);
    const g = await store.recordGap({
      id: "kg_r4",
      normalizedQuery: "q",
      sampleQuery: "q",
      source: "MANUAL",
      capabilityRef: null,
      intent: null,
    });
    // resolveGap requires a PUBLISHED target — push the item through.
    await addEvidence(store, c.version.id, {
      type: "EXTERNAL_URL", uri: "https://a.example.com/x", addedBy: OP,
    });
    await approveTransition(store, c.item.id, "PENDING", OP);
    await approveTransition(store, c.item.id, "VERIFIED", "ops_review");
    await approveTransition(store, c.item.id, "PUBLISHED", "ops_publish");
    await triageGap(store, g.row!.id, OP);
    const resolved = await resolveGap(store, g.row!.id, c.item.id, OP);
    expect(resolved.ok).toBe(true);
    // openCap:0 → no open slots → the reopen MUST be refused and the
    // link to the resolved item preserved, not cleared.
    const g2 = await store.recordGap(
      {
        id: "kg_r4",
        normalizedQuery: "q",
        sampleQuery: "q2",
        source: "MANUAL",
        capabilityRef: null,
        intent: null,
      },
      { openCap: 0 },
    );
    expect(g2.row?.status).toBe("RESOLVED");
    expect(g2.row?.linkedItemId).toBe(c.item.id);
  });
});

describe("Arc R4 — M-4 store-level legality", () => {
  it("DRAFT→PUBLISHED refused inside the store, not just the facade", async () => {
    const store = createMemoryKnowledgeStores();
    const c = await mkItem(store);
    const r = await store.transitionItem(c.item.id, {
      from: "DRAFT",
      to: "PUBLISHED",
      actor: OP,
      expectedVersionId: c.version.id,
    });
    expect(r.transitioned).toBe(false);
    if (!r.transitioned) expect(r.reason).toBe("illegal");
  });

  it("WITHDRAWN is terminal — even WITHDRAWN→DRAFT refuses", async () => {
    const store = createMemoryKnowledgeStores();
    const c = await mkItem(store);
    const w = await store.transitionItem(c.item.id, {
      from: "DRAFT",
      to: "WITHDRAWN",
      actor: OP,
    });
    expect(w.transitioned).toBe(true);
    const r = await store.transitionItem(c.item.id, {
      from: "WITHDRAWN",
      to: "DRAFT",
      actor: OP,
    });
    expect(r.transitioned).toBe(false);
    if (!r.transitioned) expect(r.reason).toBe("illegal");
  });
});

describe("Arc R4 — M-5 CJK honesty", () => {
  it("hiragana-only bigrams are dropped — no particle-driven coverage", () => {
    expect(cjkTerms("これについて")).toEqual([]);
  });

  it("Hangul stays out of the unsegmented lane (Korean is spaced)", () => {
    const cjk = cjkTerms("지식 검색");
    expect(cjk.length).toBe(0);
    expect(tokenizeTerms("지식 검색")).toContain("지식");
  });
});

describe("Arc R4 — M-6 flash whitelist", () => {
  it("arbitrary ?ok= text renders the generic banner, not the payload", () => {
    const s = flashBanner({ ok: "<script>alert(1)</script>" }).toString();
    expect(s).not.toContain("script");
    expect(s).toContain("done");
  });

  it("ok=transitioned_PUBLISHED renders the friendly arrow form", () => {
    const s = flashBanner({ ok: "transitioned_PUBLISHED" }).toString();
    expect(s).toContain("PUBLISHED");
  });

  it("err reason with -> survives as a code, unsafe text collapses", () => {
    const good = flashBanner({ err: "invalid_transition:DRAFT->PUBLISHED" }).toString();
    expect(good).toContain("invalid_transition:DRAFT-&gt;PUBLISHED");
    const bad = flashBanner({ err: "<b>x</b>" }).toString();
    expect(bad).toContain("request_refused");
  });
});

describe("Arc R4 — M-8 drift guard", () => {
  it("stale seeded rows > half the manifest → un-verify refused", async () => {
    const store = createMemoryKnowledgeStores();
    // More stale SEEDED rows than the whole manifest → the run
    // looks degraded regardless of how big the ruleset grows.
    const stale = collectSeedCapabilities().length + 1;
    for (let i = 0; i < stale; i++) {
      await store.upsertCapability({
        id: `kc_stale_${i}`,
        name: `stale-cap-${i}`,
        kind: "x",
        description: null,
        source: "SEEDED",
        verified: true,
      });
    }
    const report = await seedCapabilities(store);
    expect(report.driftGuardTripped).toBe(true);
    expect(report.unverified.length).toBe(0);
    const row = await store.getCapabilityByName("stale-cap-0");
    expect(row?.verified).toBe(true); // untouched
    expect(report.dbOnlySeeded.length).toBeGreaterThanOrEqual(stale);
  });
});

describe("Arc R4 — M-11 admin chrome", () => {
  const meta = (path: string) => ({
    path,
    title: "t",
    description: "d",
  });

  it("htmx is vendored — no unpkg anywhere in the chrome", () => {
    const html = Layout("x", "t", meta("/admin/knowledge")).toString();
    expect(html).toContain("/vendor/htmx.min.js");
    expect(html).not.toContain("unpkg.com");
  });

  it("analytics script slots are suppressed on /admin pages", () => {
    process.env.GA4_ENABLED = "true";
    process.env.GA4_MEASUREMENT_ID = "G-TEST123";
    const admin = Layout("x", "t", meta("/admin/knowledge")).toString();
    const pub = Layout("x", "t", meta("/blog/x")).toString();
    delete process.env.GA4_ENABLED;
    delete process.env.GA4_MEASUREMENT_ID;
    expect(admin).not.toContain("googletagmanager");
    expect(admin).not.toContain("G-TEST123");
    expect(pub).toContain("G-TEST123");
  });
});
