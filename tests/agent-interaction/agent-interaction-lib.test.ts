import { describe, expect, it } from "vitest";
import type { Context } from "hono";

import {
  createMemoryRequestInboxStores,
} from "../../src/server/lib/request-inbox";
import {
  classify,
  createRequest,
  internalHistory,
  mintSessionId,
  onInteractionEvent,
  publicProjection,
  recordEvent,
  reject,
  resolveActor,
  respond,
  sanitizeChannel,
  sanitizeSessionId,
  upsertSession,
  type ResolvedActor,
} from "../../src/server/lib/agent-interaction";

/**
 * SLICE-228-2: domain lib over the memory InteractionStore —
 * actor resolution, session upsert, create-request pipeline,
 * classify/respond/reject and the D-228-8 projection boundary
 * (public surface must never leak internal fields).
 */

const fp = () => ({
  ip: "10.0.0.9",
  ua: "agent/1.0",
  referer: null,
  src: null,
  headers: { "user-agent": "agent/1.0" },
});

const anon: ResolvedActor = { resolution: "ANON", actorRef: null, verified: false };
const apiKey: ResolvedActor = {
  resolution: "API_KEY",
  actorRef: "agent_42",
  agentId: "agent_42",
  verified: true,
};

const mkInput = (over: Record<string, unknown> = {}) => ({
  payload: { text: "how do I settle an invoice?" },
  kind: "question",
  actor: anon,
  channel: "rest",
  fingerprint: fp(),
  fpHash: `fp_${Math.random()}`,
  expiresAtMs: Date.now() + 86400_000,
  ...over,
});

const mkCtx = (vars: Record<string, unknown>) =>
  ({ get: (k: string) => vars[k] }) as unknown as Context;

describe("resolveActor", () => {
  it("defaults to ANON when no identity is set", () => {
    expect(resolveActor(mkCtx({}))).toEqual({
      resolution: "ANON",
      actorRef: null,
      verified: false,
    });
  });
  it("resolves API_KEY from agentId", () => {
    expect(resolveActor(mkCtx({ agentId: "agent_42" }))).toEqual(apiKey);
  });
  it("verified DID outranks API_KEY", () => {
    const a = resolveActor(
      mkCtx({ agentId: "agent_42", verifiedDid: "did:hcs:0.0.1:2" }),
    );
    expect(a.resolution).toBe("DID");
    expect(a.actorRef).toBe("did:hcs:0.0.1:2");
  });
});

describe("upsertSession", () => {
  it("accepts a well-formed client sessionId", async () => {
    const stores = createMemoryRequestInboxStores();
    const r = await upsertSession(stores, { sessionId: "sess-abc.123" });
    expect(r.sessionId).toBe("sess-abc.123");
    expect(r.created).toBe(true);
    expect(r.sanitized).toBe(false);
  });
  it("mints a fresh id for malformed/absent sessionId", async () => {
    const stores = createMemoryRequestInboxStores();
    const bad = await upsertSession(stores, { sessionId: "!!!bad id!!!" });
    expect(bad.sanitized).toBe(true);
    expect(bad.sessionId).toMatch(/^isess_/);
    const none = await upsertSession(stores, {});
    expect(none.sessionId).toMatch(/^isess_/);
    expect(sanitizeSessionId("x".repeat(200)).ok).toBe(false);
    expect(mintSessionId()).toMatch(/^isess_/);
  });
  it("increments requestCount on repeat touches", async () => {
    const stores = createMemoryRequestInboxStores();
    const a = await upsertSession(stores, { sessionId: "s1" });
    const b = await upsertSession(stores, { sessionId: "s1" });
    expect(b.created).toBe(false);
    expect(b.session.requestCount).toBe(a.session.requestCount + 1);
  });
  it("arc M5: a claimed id owned by another actor mints fresh, no join", async () => {
    const stores = createMemoryRequestInboxStores();
    await upsertSession(stores, { sessionId: "owned", actorRef: "ag_A" });
    const thief = await upsertSession(stores, {
      sessionId: "owned",
      actorRef: "ag_B",
    });
    expect(thief.sanitized).toBe(true);
    expect(thief.sessionId).toMatch(/^isess_/);
    // the owner's session is untouched — no count inflation
    expect(
      (await stores.interactions.getSession("owned"))!.requestCount,
    ).toBe(1);
  });
  it("arc M5: isess_ squat refused, echo of an existing minted id allowed", async () => {
    const stores = createMemoryRequestInboxStores();
    const squatter = await upsertSession(stores, {
      sessionId: "isess_forged-123",
    });
    expect(squatter.sanitized).toBe(true);
    expect(squatter.sessionId).not.toBe("isess_forged-123");
    // a real minted id stays usable (server returns it to the caller)
    const minted = await upsertSession(stores, { actorRef: "ag_C" });
    const echo = await upsertSession(stores, {
      sessionId: minted.sessionId,
      actorRef: "ag_C",
    });
    expect(echo.sessionId).toBe(minted.sessionId);
    expect(echo.sanitized).toBe(false);
  });
});

describe("createRequest", () => {
  it("writes request + received events + session atomically", async () => {
    const stores = createMemoryRequestInboxStores();
    const r = await createRequest(
      stores,
      mkInput({ actor: apiKey, sessionId: "s1" }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.record.actorResolution).toBe("API_KEY");
    expect(r.record.state).toBe("submitted");
    expect(r.record.channel).toBe("rest");
    expect(r.session?.requestCount).toBe(1);
    const events = await stores.interactions.listEvents(r.record.id);
    expect(events.map((e) => e.visibility).sort()).toEqual([
      "INTERNAL",
      "PUBLIC",
    ]);
    // INTERNAL carries the full payload, PUBLIC only the summary.
    const pub = events.find((e) => e.visibility === "PUBLIC")!;
    expect(JSON.stringify(pub.payload)).not.toContain("fp_");
    const internal = events.find((e) => e.visibility === "INTERNAL")!;
    expect(internal.payload).toMatchObject({ payload: { text: expect.any(String) } });
  });
  it("rejects oversized payloads and bad kinds without writes", async () => {
    const stores = createMemoryRequestInboxStores();
    const big = await createRequest(
      stores,
      mkInput({ payload: { text: "x".repeat(70 * 1024) } }),
    );
    expect(big).toEqual({ ok: false, error: "payload_too_large" });
    const bad = await createRequest(stores, mkInput({ kind: "nonsense" }));
    expect(bad).toEqual({ ok: false, error: "invalid_kind" });
    expect(await stores.interactions.listEvents("any")).toEqual([]);
  });
  it("idempotent replay returns the stored row with duplicate:true", async () => {
    const stores = createMemoryRequestInboxStores();
    const input = mkInput({ idempotencyKey: "k1" });
    const a = await createRequest(stores, input);
    const b = await createRequest(stores, input);
    if (!a.ok || !b.ok) throw new Error("unreachable");
    expect(b.duplicate).toBe(true);
    expect(b.record.id).toBe(a.record.id);
    expect(await stores.interactions.listEvents(a.record.id)).toHaveLength(2);
  });
  it("fires post-commit hooks exactly once per new request", async () => {
    const stores = createMemoryRequestInboxStores();
    const seen: string[] = [];
    const off = onInteractionEvent((_rid, ev) => void seen.push(ev.kind));
    const input = mkInput({ idempotencyKey: "k2" });
    await createRequest(stores, input);
    await createRequest(stores, input); // duplicate → no hook
    off();
    await createRequest(stores, mkInput());
    expect(seen).toEqual([
      "interaction.request.received",
      "interaction.request.received",
    ]);
  });
});

describe("classify / respond / reject", () => {
  const seed = async (stores: ReturnType<typeof createMemoryRequestInboxStores>) => {
    const r = await createRequest(stores, mkInput());
    if (!r.ok) throw new Error("seed failed");
    return r.record.id;
  };

  it("classifies with validated vocab and moves submitted→working once", async () => {
    const stores = createMemoryRequestInboxStores();
    const id = await seed(stores);
    const r = await classify(
      stores,
      id,
      { intent: "BUG_REPORT", topics: ["x402", " custom "] },
      "op_1",
    );
    expect(r).toMatchObject({ ok: true, transitioned: true });
    if (!r.ok) return;
    expect(r.record.state).toBe("working");
    expect(r.record.intent).toBe("BUG_REPORT");
    expect(r.record.topics).toEqual(["x402", "custom"]);
    expect(r.record.classifiedBy).toBe("op_1");
    // re-classify keeps state, applied keys win
    const r2 = await classify(stores, id, { outcome: "confirmed" }, "op_2");
    expect(r2).toMatchObject({ ok: true, transitioned: false });
    const events = await stores.interactions.listEvents(id, {
      visibility: "INTERNAL",
    });
    expect(events.map((e) => e.kind)).toContain(
      "interaction.request.classified",
    );
  });
  it("refuses unknown intent/signalType with a field error", async () => {
    const stores = createMemoryRequestInboxStores();
    const id = await seed(stores);
    expect(await classify(stores, id, { intent: "NOPE" }, "op")).toMatchObject({
      ok: false,
      field: "intent",
    });
    expect(await classify(stores, id, {}, "op")).toMatchObject({
      ok: false,
      error: "empty classification",
    });
  });
  it("respond → completed + response row + dual-writes legacy response", async () => {
    const stores = createMemoryRequestInboxStores();
    const id = await seed(stores);
    const r = await respond(stores, id, "op_1", "here is the answer");
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.record.state).toBe("completed");
    expect(r.record.response).toEqual({ answer: "here is the answer" });
    const rsps = await stores.interactions.listResponses(id);
    expect(rsps).toHaveLength(1);
    expect(rsps[0].operatorRef).toBe("op_1");
  });
  it("second respond is a typed terminal refusal with zero writes", async () => {
    const stores = createMemoryRequestInboxStores();
    const id = await seed(stores);
    await respond(stores, id, "op_1", "first");
    const dup = await respond(stores, id, "op_2", "second");
    expect(dup).toEqual({ ok: false, reason: "terminal" });
    expect(await stores.interactions.listResponses(id)).toHaveLength(1);
    const events = await stores.interactions.listEvents(id, {
      visibility: "PUBLIC",
    });
    expect(
      events.filter((e) => e.kind === "interaction.response.sent"),
    ).toHaveLength(1);
  });
  it("respond/reject on missing rows refuse without writes", async () => {
    const stores = createMemoryRequestInboxStores();
    expect(await respond(stores, "nope", "op", "x")).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(await reject(stores, "nope", "op")).toEqual({
      ok: false,
      reason: "missing",
    });
  });
  it("reject → failed + INTERNAL event, response stays absent", async () => {
    const stores = createMemoryRequestInboxStores();
    const id = await seed(stores);
    const r = await reject(stores, id, "op_1", "spam");
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.record.state).toBe("failed");
    const internal = await stores.interactions.listEvents(id, {
      visibility: "INTERNAL",
    });
    expect(internal.map((e) => e.kind)).toContain(
      "interaction.request.rejected",
    );
    // respond after reject refuses (already terminal)
    expect(await respond(stores, id, "op", "late")).toEqual({
      ok: false,
      reason: "terminal",
    });
  });
  it("rejects empty/oversized bodies before touching the store", async () => {
    const stores = createMemoryRequestInboxStores();
    const id = await seed(stores);
    expect(await respond(stores, id, "op", "  ")).toEqual({
      ok: false,
      error: "empty_body",
    });
    expect(await respond(stores, id, "op", "x".repeat(17 * 1024))).toEqual({
      ok: false,
      error: "body_too_large",
    });
    expect(await reject(stores, id, "op", "r".repeat(600))).toEqual({
      ok: false,
      error: "reason_too_large",
    });
  });
  it("arc M4: respond/reject/classify on an expired row refuse — zero writes", async () => {
    const stores = createMemoryRequestInboxStores();
    const r = await createRequest(
      stores,
      mkInput({ expiresAtMs: Date.now() - 1 }),
    );
    if (!r.ok) throw new Error("seed failed");
    const id = r.record.id;
    expect(await respond(stores, id, "op", "too late")).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(await reject(stores, id, "op")).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(await classify(stores, id, { intent: "BUG_REPORT" }, "op")).toEqual(
      { ok: false, error: "request expired" },
    );
    // nothing was written: state stays submitted, no response rows
    expect(
      (await stores.requests.get(id)).record!.state,
    ).toBe("submitted");
    expect(await stores.interactions.listResponses(id)).toHaveLength(0);
  });
  it("arc M6: operatorRef stays out of the PUBLIC response event", async () => {
    const stores = createMemoryRequestInboxStores();
    const id = await seed(stores);
    const r = await respond(stores, id, "op_secret_handle", "ans");
    expect(r.ok).toBe(true);
    const pub = await stores.interactions.listEvents(id, {
      visibility: "PUBLIC",
    });
    const sent = pub.find((e) => e.kind === "interaction.response.sent");
    expect(sent).toBeDefined();
    expect(JSON.stringify(sent!.payload)).not.toContain("op_secret_handle");
    // attribution lives on the INTERNAL event + the response row
    const internal = await stores.interactions.listEvents(id, {
      visibility: "INTERNAL",
    });
    expect(
      internal.find((e) => e.kind === "interaction.response.attributed")
        ?.payload,
    ).toMatchObject({ operatorRef: "op_secret_handle" });
  });
});

describe("publicProjection (D-228-8 leak regression)", () => {
  it("exposes only id/status/response?/timestamps — nothing internal", async () => {
    const stores = createMemoryRequestInboxStores();
    const r = await createRequest(
      stores,
      mkInput({ actor: apiKey, sessionId: "s1" }),
    );
    if (!r.ok) throw new Error("unreachable");
    await classify(stores, r.record.id, { intent: "BUG_REPORT", topics: ["x"] }, "op_1");
    const proj = publicProjection(
      (await stores.requests.get(r.record.id)).record!,
    );
    expect(proj.status).toBe("IN_REVIEW");
    const raw = JSON.stringify(proj);
    for (const forbidden of [
      "intent",
      "topics",
      "knowledgeGap",
      "actorResolution",
      "actorRef",
      "fingerprint",
      "fpHash",
      "classifiedBy",
      "idempotencyKey",
      "agent_42",
      "payload",
    ]) {
      expect(raw).not.toContain(forbidden);
    }
    // answered → response surfaces; rejected/others → no response key
    await respond(stores, r.record.id, "op_1", "final answer");
    const after = (await stores.requests.get(r.record.id)).record!;
    const proj2 = publicProjection(after);
    expect(proj2.status).toBe("ANSWERED");
    expect(proj2.response).toBe("final answer");
  });
});

describe("internalHistory", () => {
  it("returns full event log + classification + responses", async () => {
    const stores = createMemoryRequestInboxStores();
    const r = await createRequest(stores, mkInput());
    if (!r.ok) throw new Error("unreachable");
    await classify(stores, r.record.id, { intent: "FEATURE_REQUEST" }, "op_1");
    await respond(stores, r.record.id, "op_1", "done");
    await recordEvent(
      stores,
      r.record.id,
      { kind: "interaction.review.required", visibility: "INTERNAL", payload: {} },
    );
    const h = await internalHistory(stores, r.record.id);
    expect(h).not.toBeNull();
    expect(h!.classification.intent).toBe("FEATURE_REQUEST");
    expect(h!.events.length).toBeGreaterThanOrEqual(4);
    expect(h!.responses).toHaveLength(1);
    expect(await internalHistory(stores, "missing")).toBeNull();
  });
});

describe("sanitizeChannel", () => {
  it("keeps valid channels, defaults invalid/missing to rest", () => {
    expect(sanitizeChannel("a2a")).toBe("a2a");
    expect(sanitizeChannel("mcp:stdio")).toBe("mcp:stdio");
    expect(sanitizeChannel("UPPER")).toBe("upper");
    expect(sanitizeChannel("!!bad")).toBe("rest");
    expect(sanitizeChannel(undefined)).toBe("rest");
    expect(sanitizeChannel("x".repeat(100))).toBe("rest");
  });
});
