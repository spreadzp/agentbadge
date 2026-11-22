import { describe, expect, it } from "vitest";

import {
  createMemoryFeedbackData,
  createMemoryFeedbackStore,
} from "../../src/server/lib/feedback/store-memory";
import {
  submitFeedback,
  getFeedbackStatus,
  publicFeedbackProjection,
  FEEDBACK_DEDUPE_SCOPE,
} from "../../src/server/lib/feedback/service";
import {
  triageFeedback,
  resolveFeedback,
  closeFeedback,
} from "../../src/server/lib/feedback/workflow";
import { normalizeFeedbackKey } from "../../src/server/lib/feedback/normalize";
import { submitFeedbackSchema } from "../../src/server/lib/feedback/validate";
import type { ResolvedActor } from "../../src/server/lib/agent-interaction/actor";

const actor = (over?: Partial<ResolvedActor>): ResolvedActor => ({
  resolution: "DID",
  actorRef: "did:web:agent.example",
  verified: true,
  ...over,
});

const mkStore = () =>
  createMemoryFeedbackStore(createMemoryFeedbackData());

describe("submitFeedbackSchema", () => {
  it("accepts a minimal body", () => {
    expect(submitFeedbackSchema.safeParse({ text: "hi" }).success).toBe(true);
  });
  it("refuses empty/blank text", () => {
    expect(submitFeedbackSchema.safeParse({ text: "" }).success).toBe(false);
    expect(submitFeedbackSchema.safeParse({ text: "   " }).success).toBe(false);
  });
  it("refuses control characters incl NUL", () => {
    expect(
      submitFeedbackSchema.safeParse({ text: "a\u0000b" }).success,
    ).toBe(false);
    expect(
      submitFeedbackSchema.safeParse({ text: "ok\nnewline ok" }).success,
    ).toBe(true);
  });
  it("refuses unknown keys (strict)", () => {
    expect(
      submitFeedbackSchema.safeParse({ text: "x", sneaky: 1 }).success,
    ).toBe(false);
  });
  it("refuses unknown kind/target/severity", () => {
    expect(
      submitFeedbackSchema.safeParse({ text: "x", kind: "WHATEVER" }).success,
    ).toBe(false);
    expect(
      submitFeedbackSchema.safeParse({ text: "x", target: "moon" }).success,
    ).toBe(false);
    expect(
      submitFeedbackSchema.safeParse({ text: "x", severity: "APOCALYPTIC" })
        .success,
    ).toBe(false);
  });
});

describe("normalizeFeedbackKey", () => {
  it("threads case/whitespace variants under one key", () => {
    const a = normalizeFeedbackKey("The  DOCS   are WRONG", "docs");
    const b = normalizeFeedbackKey("the docs are wrong", "docs");
    expect(a).toBe(b);
  });
  it("target participates in the key", () => {
    const a = normalizeFeedbackKey("same text", "docs");
    const b = normalizeFeedbackKey("same text", "api");
    expect(a).not.toBe(b);
  });
});

describe("submitFeedback", () => {
  it("rejects invalid bodies with a field tag", async () => {
    const res = await submitFeedback(mkStore(), { text: "" }, actor());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.field).toBe("text");
  });

  it("stores kind/target/severity and emits received events", async () => {
    const store = mkStore();
    const res = await submitFeedback(
      store,
      { text: "docs broken", kind: "DOCS", target: "docs", severity: "HIGH" },
      actor(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.status).toBe("RECEIVED");
    expect(res.record.kind).toBe("DOCS");
    const evts = await store.listEvents(res.record.id);
    expect(evts.map((e) => e.visibility)).toEqual(["PUBLIC", "INTERNAL"]);
    const internal = evts[1]!.payload as Record<string, unknown>;
    expect(internal.actor).toEqual({
      resolution: "DID",
      ref: "did:web:agent.example",
    });
  });

  it("auto-threads same normalized key under the earliest open canonical", async () => {
    const store = mkStore();
    const a = await submitFeedback(store, { text: "Same Bug!" }, actor());
    const b = await submitFeedback(store, { text: "same   bug!" }, actor());
    const c = await submitFeedback(store, { text: "SAME BUG!" }, actor());
    if (!a.ok || !b.ok || !c.ok) throw new Error("submit failed");
    expect(b.relatedTo).toBe(a.record.id);
    expect(c.relatedTo).toBe(a.record.id);
    const canon = await store.getFeedback(a.record.id);
    expect(canon?.relatedCount).toBe(3);
  });

  it("idempotent replay returns the first row, writes nothing", async () => {
    const store = mkStore();
    const opts = { idempotencyKey: "key-1", dedupeScope: FEEDBACK_DEDUPE_SCOPE };
    const a = await submitFeedback(store, { text: "x" }, actor(), opts);
    const b = await submitFeedback(store, { text: "x" }, actor(), opts);
    if (!a.ok || !b.ok) throw new Error("submit failed");
    expect(b.duplicate).toBe(true);
    expect(b.record.id).toBe(a.record.id);
    expect((await store.listFeedback())).toHaveLength(1);
    expect((await store.listEvents(a.record.id)).length).toBe(2);
  });

  it("replay under a different actor → actor_mismatch", async () => {
    const store = mkStore();
    const opts = { idempotencyKey: "key-2", dedupeScope: FEEDBACK_DEDUPE_SCOPE };
    await submitFeedback(store, { text: "x" }, actor(), opts);
    const res = await submitFeedback(
      store,
      { text: "x" },
      actor({ actorRef: "did:web:other.example" }),
      opts,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("actor_mismatch");
  });

  it("replay with a different body → payload_mismatch", async () => {
    const store = mkStore();
    const opts = { idempotencyKey: "key-3", dedupeScope: FEEDBACK_DEDUPE_SCOPE };
    await submitFeedback(store, { text: "x" }, actor(), opts);
    const res = await submitFeedback(store, { text: "y" }, actor(), opts);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("payload_mismatch");
  });
});

describe("feedback workflow", () => {
  const seed = async (store = mkStore()) => {
    const r = await submitFeedback(store, { text: "t" }, actor());
    if (!r.ok) throw new Error("seed failed");
    return { store, id: r.record.id };
  };

  it("RECEIVED→TRIAGED applies the operator patch", async () => {
    const { store, id } = await seed();
    const res = await triageFeedback(
      store,
      id,
      { kind: "BUG", severity: "LOW", suggestion: "thanks!" },
      "ops:alice",
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.status).toBe("TRIAGED");
    expect(res.record.kind).toBe("BUG");
    expect(res.record.suggestion).toBe("thanks!");
    expect(res.record.triagedAt).not.toBeNull();
  });

  it("triage refuses invalid patch fields", async () => {
    const { store, id } = await seed();
    const res = await triageFeedback(store, id, { kind: "NOPE" }, "ops:alice");
    expect(res.ok).toBe(false);
  });

  it("illegal direct jumps refuse (status_mismatch | illegal)", async () => {
    const { store, id } = await seed();
    // resolve before triage → status_mismatch (from=TRIAGED ≠ RECEIVED)
    const res = await resolveFeedback(store, id, "ACCEPTED", "ops:alice");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("status_mismatch");
    // close from RECEIVED → illegal transition
    const c = await closeFeedback(store, id, "ops:alice");
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error).toBe("illegal_transition");
  });

  it("full lifecycle RECEIVED→TRIAGED→ACCEPTED→CLOSED", async () => {
    const { store, id } = await seed();
    await triageFeedback(store, id, {}, "ops:alice");
    const r = await resolveFeedback(store, id, "ACCEPTED", "ops:alice", {
      suggestion: "will fix",
    });
    expect(r.ok).toBe(true);
    const c = await closeFeedback(store, id, "ops:alice");
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.record.status).toBe("CLOSED");
    expect(c.record.closedAt).not.toBeNull();
    const evts = await store.listEvents(id);
    expect(evts.filter((e) => e.kind === "feedback.status_changed").length)
      .toBe(2);
  });

  it("a second triage on TRIAGED refuses (no self-loop)", async () => {
    const { store, id } = await seed();
    await triageFeedback(store, id, {}, "ops:alice");
    const res = await triageFeedback(store, id, {}, "ops:bob");
    expect(res.ok).toBe(false);
  });

  it("transition events carry the operator ref (INTERNAL)", async () => {
    const { store, id } = await seed();
    await triageFeedback(store, id, { kind: "DX" }, "ops:carol");
    const evts = await store.listEvents(id, { visibility: "INTERNAL" });
    const triaged = evts.find((e) => e.kind === "feedback.triaged");
    const payload = triaged?.payload as Record<string, unknown>;
    expect(payload.actor).toBe("ops:carol");
  });
});

describe("public projection", () => {
  it("exposes only the D-230-9 shape", async () => {
    const store = mkStore();
    const r = await submitFeedback(
      store,
      { text: "secret internals", kind: "BUG" },
      actor(),
    );
    if (!r.ok) throw new Error("submit failed");
    const p = publicFeedbackProjection(r.record);
    expect(p.id).toBe(r.record.id);
    expect(p.status).toBe("RECEIVED");
    expect(Object.keys(p).sort()).toEqual(
      ["createdAt", "id", "status", "updatedAt"].sort(),
    );
    // suggestion appears once the operator writes it
    const withSuggestion = { ...r.record, suggestion: "fixed in v2" };
    expect(publicFeedbackProjection(withSuggestion).suggestion).toBe(
      "fixed in v2",
    );
  });

  it("getFeedbackStatus returns null for unknown ids", async () => {
    expect(await getFeedbackStatus(mkStore(), "fb_none")).toBeNull();
  });
});
