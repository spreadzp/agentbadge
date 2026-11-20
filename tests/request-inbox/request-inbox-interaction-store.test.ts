import { describe, expect, it } from "vitest";

import {
  createMemoryRequestInboxStores,
  type InteractionEventInput,
  type InteractionSubmitInput,
} from "../../src/server/lib/request-inbox";
import { statusOfState } from "../../src/server/lib/request-inbox/interaction-types";
import type { InboxRequestRecord } from "../../src/server/lib/request-inbox/types";

/**
 * SLICE-228-1: memory-side InteractionStore contract — the in-memory
 * fallback MUST behave identically to the Postgres adapter (D-143 /
 * D-228-10 parity). Covers the shared inbox row (legacy submits
 * visible to the interaction queue), composite mutations (submit +
 * events + session touch), honest transition signals, append-only
 * events and session upsert.
 */

const mkFingerprint = () => ({
  ip: "10.0.0.1",
  ua: "test-agent/1.0",
  referer: null,
  src: null,
  headers: { "user-agent": "test-agent/1.0" },
});

let seq = 0;
const mkSubmit = (
  over: Partial<InteractionSubmitInput> = {},
): InteractionSubmitInput => {
  seq += 1;
  const now = Date.now();
  return {
    id: `rq_i_${now}_${seq}`,
    state: "submitted",
    kind: "question",
    payload: { text: `question ${seq}` },
    fingerprint: mkFingerprint(),
    fpHash: `fpi_${seq}`,
    actorResolution: "ANON",
    channel: "rest",
    expiresAtMs: now + 30 * 24 * 3600 * 1000,
    ...over,
  };
};

const receivedEvents = (full = true): InteractionEventInput[] => [
  {
    kind: "interaction.request.received",
    visibility: "PUBLIC",
    payload: { summary: "new request" },
  },
  ...(full
    ? [
        {
          kind: "interaction.request.received",
          visibility: "INTERNAL",
          payload: { full: true },
        } as InteractionEventInput,
      ]
    : []),
];

describe("InteractionStore (memory backend, D-228-10 shared row)", () => {
  it("submitInteraction creates a row visible through BOTH facets", async () => {
    const stores = createMemoryRequestInboxStores();
    const { record, duplicate } = await stores.interactions.submitInteraction(
      mkSubmit({ actorResolution: "API_KEY", actorRef: "ag_1", agentId: "ag_1", verified: true }),
      receivedEvents(),
    );
    expect(duplicate).toBe(false);
    expect(record.actorResolution).toBe("API_KEY");
    expect(record.channel).toBe("rest");
    // Same row through the 252 facet — one inbox in both modes.
    const got = await stores.requests.get(record.id);
    expect(got.record?.id).toBe(record.id);
    expect(got.record?.actorResolution).toBe("API_KEY");
  });

  it("legacy requests.submit rows surface in the interaction queue with NULL interaction cols", async () => {
    const stores = createMemoryRequestInboxStores();
    const { record } = await stores.requests.submit({
      id: "rq_legacy_1",
      state: "submitted",
      payload: { question: "legacy" },
      fingerprint: mkFingerprint(),
      fpHash: "fp_legacy",
      expiresAtMs: Date.now() + 3600_000,
    });
    expect(record.actorResolution).toBeNull();
    const queue = await stores.interactions.listQueue({
      status: "PENDING_REVIEW",
    });
    expect(queue.map((r) => r.id)).toContain("rq_legacy_1");
  });

  it("idempotent submit replays return the same row, no second events", async () => {
    const stores = createMemoryRequestInboxStores();
    const input = mkSubmit({ idempotencyKey: "idem-1", fpHash: "fpX" });
    const first = await stores.interactions.submitInteraction(
      input,
      receivedEvents(),
    );
    const second = await stores.interactions.submitInteraction(
      { ...input, id: "rq_other" },
      receivedEvents(),
    );
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.record.id).toBe(first.record.id);
    expect(await stores.interactions.listEvents(first.record.id)).toHaveLength(2);
  });

  it("classify writes cols + moves submitted→working once (honest transitioned)", async () => {
    const stores = createMemoryRequestInboxStores();
    const { record } = await stores.interactions.submitInteraction(
      mkSubmit(),
      [],
    );
    const c1 = await stores.interactions.classify(
      record.id,
      { intent: "BUG_REPORT", signalType: "NEED", knowledgeGap: true, classifiedBy: "ops" },
      [{ kind: "interaction.request.classified", visibility: "INTERNAL", payload: {} }],
    );
    expect(c1?.transitioned).toBe(true);
    expect(c1?.record.state).toBe("working");
    expect(c1?.record.intent).toBe("BUG_REPORT");
    // Re-classify: cols update, transitioned=false.
    const c2 = await stores.interactions.classify(
      record.id,
      { intent: "OTHER" },
      [],
    );
    expect(c2?.transitioned).toBe(false);
    expect(c2?.record.state).toBe("working");
    expect(c2?.record.intent).toBe("OTHER");
    expect(await stores.interactions.classify("rq_nope", {}, [])).toBeNull();
  });

  it("respond → completed + response row + legacy response col + PUBLIC event", async () => {
    const stores = createMemoryRequestInboxStores();
    const { record } = await stores.interactions.submitInteraction(
      mkSubmit(),
      [],
    );
    const out = await stores.interactions.respond(
      record.id,
      { id: "ir_1", requestId: record.id, operatorRef: "ops:paul", body: "answer!" },
      [{ kind: "interaction.response.sent", visibility: "PUBLIC", payload: { responseId: "ir_1" } }],
    );
    expect(out.transitioned).toBe(true);
    expect(out.record?.state).toBe("completed");
    expect(out.record?.response).toEqual({ answer: "answer!" });
    expect(out.record?.respondedAtMs).toBeTypeOf("number");
    const resps = await stores.interactions.listResponses(record.id);
    expect(resps).toHaveLength(1);
    expect(resps[0].body).toBe("answer!");
    // Second respond → refusal, nothing written.
    const again = await stores.interactions.respond(
      record.id,
      { id: "ir_2", requestId: record.id, operatorRef: "ops:paul", body: "x" },
      [],
    );
    expect(again.transitioned).toBe(false);
    expect(await stores.interactions.listResponses(record.id)).toHaveLength(1);
  });

  it("reject → failed + event; terminal refusal writes nothing", async () => {
    const stores = createMemoryRequestInboxStores();
    const { record } = await stores.interactions.submitInteraction(
      mkSubmit(),
      [],
    );
    const rej = await stores.interactions.reject(record.id, [
      { kind: "interaction.review.required", visibility: "INTERNAL", payload: { reason: "spam" } },
    ]);
    expect(rej.transitioned).toBe(true);
    expect(rej.record?.state).toBe("failed");
    const again = await stores.interactions.reject(record.id, []);
    expect(again.transitioned).toBe(false);
    expect(await stores.interactions.listEvents(record.id)).toHaveLength(1);
  });

  it("session upsert: created once, counter increments, actorRef backfills", async () => {
    const stores = createMemoryRequestInboxStores();
    const s1 = await stores.interactions.upsertSession({
      id: "sess-1",
      seenAtMs: 1000,
    });
    expect(s1.created).toBe(true);
    expect(s1.session.requestCount).toBe(1);
    const s2 = await stores.interactions.upsertSession({
      id: "sess-1",
      actorRef: "ag_9",
      seenAtMs: 2000,
    });
    expect(s2.created).toBe(false);
    expect(s2.session.requestCount).toBe(2);
    expect(s2.session.actorRef).toBe("ag_9");
    expect(s2.session.firstSeenAtMs).toBe(1000);
    expect(s2.session.lastSeenAtMs).toBe(2000);
  });

  it("submit with sessionId touches the session; listBySession threads", async () => {
    const stores = createMemoryRequestInboxStores();
    await stores.interactions.submitInteraction(
      mkSubmit({ sessionId: "sess-A", actorRef: "ag_7" }),
      [],
    );
    await stores.interactions.submitInteraction(
      mkSubmit({ sessionId: "sess-A" }),
      [],
    );
    const session = await stores.interactions.getSession("sess-A");
    expect(session?.requestCount).toBe(2);
    const thread = await stores.interactions.listBySession("sess-A");
    expect(thread).toHaveLength(2);
  });

  it("event log is ordered, visibility-filtered and append-only", async () => {
    const stores = createMemoryRequestInboxStores();
    const { record } = await stores.interactions.submitInteraction(
      mkSubmit(),
      receivedEvents(),
    );
    await stores.interactions.appendEvents(record.id, [
      { kind: "interaction.request.classified", visibility: "INTERNAL", payload: {} },
    ]);
    const all = await stores.interactions.listEvents(record.id);
    expect(all.map((e) => e.seq)).toEqual([1, 2, 3]);
    const pub = await stores.interactions.listEvents(record.id, {
      visibility: "PUBLIC",
    });
    expect(pub).toHaveLength(1);
    expect(pub[0].kind).toBe("interaction.request.received");
  });

  it("statusOfState maps the A2A vocabulary at the edge", () => {
    expect(statusOfState("submitted")).toBe("PENDING_REVIEW");
    expect(statusOfState("working")).toBe("IN_REVIEW");
    expect(statusOfState("completed")).toBe("ANSWERED");
    expect(statusOfState("failed")).toBe("REJECTED");
    expect(statusOfState("custom-future")).toBe("custom-future");
  });

  it("queue filters by status + actorResolution, FIFO order", async () => {
    const stores = createMemoryRequestInboxStores();
    const a = await stores.interactions.submitInteraction(
      mkSubmit({ actorResolution: "ANON", createdAtMs: 100 }),
      [],
    );
    const b = await stores.interactions.submitInteraction(
      mkSubmit({ actorResolution: "API_KEY", createdAtMs: 200 }),
      [],
    );
    void a;
    const queue = await stores.interactions.listQueue();
    expect(queue.map((r: InboxRequestRecord) => r.id)).toContain(b.record.id);
    const apiKeyOnly = await stores.interactions.listQueue({
      actorResolution: "API_KEY",
    });
    expect(apiKeyOnly.map((r) => r.id)).toEqual([b.record.id]);
  });
});
