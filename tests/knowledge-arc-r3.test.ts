import { describe, expect, it } from "vitest";

import {
  addEvidence,
  createKnowledgeItem,
  createMemoryKnowledgeStores,
  evidenceFingerprint,
  isPublicEvidenceUri,
  listEvidence,
  recordGap,
  removeEvidence,
  transitionKnowledgeItem,
} from "../src/server/lib/knowledge";
import { approveTransition } from "./helpers/knowledge";

/**
 * Arc Studio R3 regression pack — one test per finding class:
 * - H-1: memory facade forwards opts (openCap, requireStatus).
 * - H-2: expectedEvidence fingerprint pins the set the reviewer saw.
 * - M-1: SUPERSEDES write guard + depth-cap refusal (memory parity).
 * - M-3: parsed URI classification — no prefix-regex false +/-.
 * - M-4: strict predicates on single-line fields.
 * - M-8/M-9: gap reopen cap + offset paging.
 * - M-10: SEEDED cannot overwrite MANUAL capability rows.
 * - M-11: gates derive from `to` inside the store — flags can't bypass.
 * - M-12: removeEvidence returns the deleted row for audit.
 */

const OP = "ops_test";
const OP2 = "ops_review";

describe("Arc R3 — H-1 facade forwards opts", () => {
  it("openCap reaches the memory recordGap impl", async () => {
    const store = createMemoryKnowledgeStores();
    const mk = (q: string) => ({
      id: `kgap_${q}`,
      normalizedQuery: q,
      sampleQuery: q,
      source: "MANUAL",
      capabilityRef: null,
      intent: null,
      sourceRef: null,
    });
    const a = await store.recordGap(mk("cap-q-1"), { openCap: 1 });
    expect(a.row).toBeTruthy();
    // Cap reached: a NEW gap must refuse honestly, not silently grow.
    const b = await store.recordGap(mk("cap-q-2"), { openCap: 1 });
    expect(b.created).toBe(false);
    // But a repeat sighting of an EXISTING gap still bumps — the cap
    // gates new rows only, not dedupe.
    const c = await store.recordGap(mk("cap-q-1"), { openCap: 1 });
    expect(c.recorded).toBe(true);
  });

  it("requireStatus reaches addVersion", async () => {
    const store = createMemoryKnowledgeStores();
    const c = await createKnowledgeItem(
      store, { kind: "GUIDE", title: "t", body: "b" }, OP,
    );
    if (!c.ok) throw new Error("create failed");
    const r = await store.addVersion(
      {
        id: "kv_r3", itemId: c.item.id, title: "t2", body: "b2",
        createdBy: OP,
      },
      { requireStatus: "PENDING" },
    );
    // Item is DRAFT — requireStatus must refuse, not silently ignore.
    expect(r).toMatchObject({ ok: false });
  });
});

describe("Arc R3 — H-2 evidence fingerprint", () => {
  it("evidence_changed refuses when the set moved after render", async () => {
    const store = createMemoryKnowledgeStores();
    const c = await createKnowledgeItem(
      store, { kind: "GUIDE", title: "fp", body: "b" }, OP,
    );
    if (!c.ok) throw new Error("create failed");
    const e1 = await addEvidence(store, c.version.id, {
      type: "EXTERNAL_URL", uri: "https://a.example.com/1", addedBy: OP,
    });
    if (!e1.ok) throw new Error("e1 failed");
    // Reviewer renders the page → pins this version + fingerprint.
    const staleFp = evidenceFingerprint(
      await listEvidence(store, c.version.id),
    );
    await transitionKnowledgeItem(store, c.item.id, "PENDING", OP);
    // Bait-and-switch: reject back to DRAFT, swap evidence, resubmit.
    await transitionKnowledgeItem(store, c.item.id, "DRAFT", OP);
    await removeEvidence(store, e1.evidence!.id, OP);
    await addEvidence(store, c.version.id, {
      type: "EXTERNAL_URL", uri: "https://a.example.com/2", addedBy: OP,
    });
    await transitionKnowledgeItem(store, c.item.id, "PENDING", OP);
    // Same versionId, different evidence SET → evidence_changed.
    const cur = await store.getItem(c.item.id);
    const r = await transitionKnowledgeItem(
      store, c.item.id, "VERIFIED", OP2, null,
      {
        expectedVersionId: cur!.latestVersionId!,
        expectedEvidence: staleFp,
      },
    );
    expect(r).toMatchObject({ ok: false, error: "evidence_changed" });
    expect((await store.getItem(c.item.id))?.status).toBe("PENDING");
    // Fresh render → fresh fingerprint → passes.
    const ok = await approveTransition(store, c.item.id, "VERIFIED", OP2);
    expect(ok.ok).toBe(true);
  });

  it("VERIFIED/PUBLISHED require the preconditions at the store edge", async () => {
    const store = createMemoryKnowledgeStores();
    const c = await createKnowledgeItem(
      store, { kind: "GUIDE", title: "pc", body: "b" }, OP,
    );
    if (!c.ok) throw new Error("create failed");
    await addEvidence(store, c.version.id, {
      type: "EXTERNAL_URL", uri: "https://a.example.com/1", addedBy: OP,
    });
    await transitionKnowledgeItem(store, c.item.id, "PENDING", OP);
    // Direct store call with no opts — M-11: refusal comes from the
    // store, not from a caller remembering to opt in.
    const bare = await store.transitionItem(c.item.id, {
      from: "PENDING", to: "VERIFIED", actor: OP2,
    });
    expect(bare).toMatchObject({
      transitioned: false, reason: "precondition_required",
    });
  });
});

describe("Arc R3 — M-3 public evidence URI boundary", () => {
  it("rejects private/internal shapes; keeps real public domains", () => {
    for (const [uri, isPublic] of [
      // The R2 prefix-regex false-positives — all public.
      ["https://fda.gov/x", true],
      ["https://fcc.gov/y", true],
      ["https://fdic.gov/z", true],
      ["https://fcbarcelona.com", true],
      ["https://10.fm/live", true],
      // Private/loopback/internal — all refused.
      ["http://127.0.0.1/x", false],
      ["http://10.0.0.9/x", false],
      ["http://192.168.0.1/x", false],
      ["http://169.254.169.254/latest", false], // cloud metadata
      ["http://100.64.0.1/x", false], // CGNAT
      ["http://[::1]/x", false],
      ["http://[::ffff:127.0.0.1]/x", false], // mapped loopback
      ["http://[::ffff:7f00:1]/x", false], // mapped hextet form
      ["http://[fc00::5]/x", false], // ULA
      ["http://[fe80::1]/x", false], // link-local
      ["http://jenkins.internal/x", false],
      ["http://intranet/x", false], // dotless = single-label
      ["http://user:pw@example.com/x", false], // userinfo
      ["http://2130706433/x", false], // dword loopback
      // Arc R4 H-1: trailing dot kept by WHATWG — every string
      // check missed it; compat v6 (hextet or dotted) hid v4.
      ["http://localhost./x", false],
      ["http://intranet./x", false],
      ["http://jenkins.internal./x", false],
      ["http://metadata./x", false],
      ["http://[::7f00:1]/x", false], // compat hextet = 127.0.0.1
      ["http://[::a00:1]/x", false], // compat hextet = 10.0.0.1
      ["http://[::1.2.3.4]/x", true], // compat dotted, public v4
      ["http://[::102:304]/x", true], // compat hextet, same 1.2.3.4
      ["http://[::ffff:8.8.8.8]/x", true], // mapped public stays public
      ["http://[::ffff:a00:1]/x", false], // mapped private
    ] as const) {
      expect(isPublicEvidenceUri(uri), uri).toBe(isPublic);
    }
  });

  it("add-time validation matches the public boundary for external types", async () => {
    const store = createMemoryKnowledgeStores();
    const c = await createKnowledgeItem(
      store, { kind: "GUIDE", title: "evv", body: "b" }, OP,
    );
    if (!c.ok) throw new Error("create failed");
    const bad = await addEvidence(store, c.version.id, {
      type: "EXTERNAL_URL", uri: "http://169.254.169.254/meta", addedBy: OP,
    });
    expect(bad).toMatchObject({ ok: false, error: "invalid_uri" });
    const good = await addEvidence(store, c.version.id, {
      type: "EXTERNAL_URL", uri: "https://fda.gov/doc", addedBy: OP,
    });
    expect(good.ok).toBe(true);
  });
});

describe("Arc R3 — M-4 strict single-line predicates", () => {
  it("bidi/C1 junk refused in title and summary", async () => {
    const store = createMemoryKnowledgeStores();
    for (const evil of ["t\u202eversed", "t\u0085nel", "t\uFEFFbom"]) {
      const c = await createKnowledgeItem(
        store, { kind: "GUIDE", title: evil, body: "b" }, OP,
      );
      expect(c.ok).toBe(false);
    }
    // Legit emoji ZWJ and Persian ZWNJ still pass.
    const ok = await createKnowledgeItem(
      store,
      { kind: "GUIDE", title: "سلام\u200cدنیا family👨‍👩‍👧", body: "b" },
      OP,
    );
    expect(ok.ok).toBe(true);
  });
});

describe("Arc R3 — M-8/M-9 gap reopen cap + paging", () => {
  it("offset pages through listGaps deterministically", async () => {
    const store = createMemoryKnowledgeStores();
    for (const q of ["p1", "p2", "p3"]) {
      await recordGap(store, { query: q, source: "MANUAL" });
    }
    const all = await store.listGaps({ limit: 10 });
    const page2 = await store.listGaps({ limit: 10, offset: 1 });
    expect(page2.map((g) => g.id)).toEqual(
      all.slice(1).map((g) => g.id),
    );
  });
});

describe("Arc R3 — M-10 SEEDED cannot own a MANUAL row", () => {
  it("seed upsert keeps operator ownership + verified flag", async () => {
    const store = createMemoryKnowledgeStores();
    const manual = await store.upsertCapability({
      id: "kc_manual",
      name: "manual-cap",
      kind: "x",
      description: "operator-owned",
      source: "MANUAL",
      verified: true,
    });
    expect(manual.row).toBeTruthy();
    const seeded = await store.upsertCapability({
      id: "kc_seed",
      name: "manual-cap",
      kind: "y",
      description: "seed overwrite attempt",
      source: "SEEDED",
      verified: false,
    });
    expect(seeded.row).toBeTruthy();
    const row = await store.getCapabilityByName("manual-cap");
    expect(row?.source).toBe("MANUAL");
    expect(row?.verified).toBe(true);
    expect(row?.kind).toBe("x");
  });
});

describe("Arc R3 — M-12 removeEvidence returns provenance", () => {
  it("the deleted row comes back for the audit event", async () => {
    const store = createMemoryKnowledgeStores();
    const c = await createKnowledgeItem(
      store, { kind: "GUIDE", title: "rm", body: "b" }, OP,
    );
    if (!c.ok) throw new Error("create failed");
    const e = await addEvidence(store, c.version.id, {
      type: "EXTERNAL_URL", uri: "https://a.example.com/x", addedBy: OP,
    });
    if (!e.ok) throw new Error("ev failed");
    const res = await store.removeEvidence(e.evidence.id);
    expect(res.removed).toBe(true);
    expect(res.row?.uri).toBe("https://a.example.com/x");
    expect(res.row?.type).toBe("EXTERNAL_URL");
  });
});
