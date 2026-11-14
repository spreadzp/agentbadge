import { describe, expect, it } from "vitest";

import {
  createMemoryRequestStore,
  type RequestStore,
  type SubmitInput,
} from "../src/server/lib/request-inbox/store";
import { createMemorySurveyStore } from "../src/server/lib/request-inbox/survey-store";
import { pickRequestInboxStores } from "../src/server/lib/request-inbox/db-stores";

/**
 * EPIC-252 (SLICE-252-1): request store contract — exercised against
 * the in-memory implementation (the Postgres repo has its own gated
 * suite in packages/database; the adapter is a thin mapper). The
 * picker chooses memory when repos are null — the dual-mode seam.
 */

const mkSubmit = (over: Partial<SubmitInput> = {}): SubmitInput => ({
  id: `rq_${Math.random().toString(16).slice(2)}`,
  state: "submitted",
  kind: "work-intent",
  payload: { prompt: "do the thing" },
  fingerprint: { ua: "a/1", referer: null, src: null, headers: {} },
  fpHash: `fp_${Math.random().toString(16).slice(2)}`,
  expiresAtMs: Date.now() + 60_000,
  ...over,
});

const contract = (name: string, make: () => RequestStore) => {
  describe(name, () => {
    it("submit creates a new record; without key every submit is new", async () => {
      const s = make();
      const a = await s.submit(mkSubmit({ id: "r1" }));
      const b = await s.submit(mkSubmit({ id: "r2", fpHash: "same" }));
      expect(a.duplicate).toBe(false);
      expect(b.duplicate).toBe(false);
      expect(b.record.id).toBe("r2");
    });

    it("idempotency: same (key, fpHash) returns existing row", async () => {
      const s = make();
      const a = await s.submit(
        mkSubmit({ id: "r1", idempotencyKey: "k", fpHash: "fp1" }),
      );
      const b = await s.submit(
        mkSubmit({ id: "r2", idempotencyKey: "k", fpHash: "fp1" }),
      );
      expect(b.duplicate).toBe(true);
      expect(b.record.id).toBe(a.record.id);
      // different fingerprint under same key → new row
      const c = await s.submit(
        mkSubmit({ id: "r3", idempotencyKey: "k", fpHash: "fp2" }),
      );
      expect(c.duplicate).toBe(false);
      expect(c.record.id).toBe("r3");
    });

    it("get returns record + expired flag by expiresAtMs", async () => {
      const s = make();
      await s.submit(mkSubmit({ id: "live", expiresAtMs: Date.now() + 60_000 }));
      await s.submit(mkSubmit({ id: "dead", expiresAtMs: Date.now() - 1 }));
      expect((await s.get("live")).expired).toBe(false);
      expect((await s.get("dead")).expired).toBe(true);
      expect((await s.get("missing")).record).toBeNull();
    });

    it("transition is conditional on the expected state", async () => {
      const s = make();
      await s.submit(mkSubmit({ id: "r" }));
      expect(
        await s.transition("r", "working", "completed"),
      ).toBeNull(); // wrong from
      const w = await s.transition("r", "submitted", "working");
      expect(w!.state).toBe("working");
      const done = await s.transition("r", "working", "completed", {
        response: { text: "ok" },
        respondedAtMs: 123,
      });
      expect(done!.state).toBe("completed");
      expect((done!.response as { text: string }).text).toBe("ok");
      expect(done!.respondedAtMs).toBe(123);
    });

    it("listByState filters state + sinceMs, newest first", async () => {
      const s = make();
      await s.submit(mkSubmit({ id: "a", createdAtMs: Date.now() - 1000 }));
      await s.submit(mkSubmit({ id: "b", createdAtMs: Date.now() }));
      await s.submit(mkSubmit({ id: "c", state: "completed" }));
      const submitted = await s.listByState({ state: "submitted" });
      expect(submitted.map((r) => r.id)).toEqual(["b", "a"]);
      const recent = await s.listByState({
        state: "submitted",
        sinceMs: Date.now() - 500,
      });
      expect(recent.map((r) => r.id)).toEqual(["b"]);
    });

    it("setSpamFlag toggles and returns existence", async () => {
      const s = make();
      await s.submit(mkSubmit({ id: "r" }));
      expect(await s.setSpamFlag("r", true)).toBe(true);
      expect((await s.get("r")).record!.spamFlag).toBe(true);
      expect(await s.setSpamFlag("missing", true)).toBe(false);
    });

    it("QA corpus: same questionHash bumps uses, not a duplicate row", async () => {
      const s = make();
      const first = await s.upsertQaPair({
        id: "qa1",
        questionHash: "qh",
        question: "what is x?",
        response: { t: "a" },
        sourceRequestId: "r1",
        createdAtMs: 1,
      });
      expect(first.uses).toBe(0);
      const again = await s.upsertQaPair({
        id: "qa2",
        questionHash: "qh",
        question: "what is x?",
        response: { t: "a" },
        sourceRequestId: "r2",
        createdAtMs: 2,
      });
      expect(again.id).toBe("qa1");
      expect(again.uses).toBe(1);
      expect((await s.getQaByHash("qh"))!.id).toBe("qa1");
      expect(await s.searchQa("what is")).toHaveLength(1);
    });

    it("janitor legs: listExpired/listPurgeable/purge/delete", async () => {
      const s = make();
      await s.submit(
        mkSubmit({ id: "exp", expiresAtMs: Date.now() - 1 }),
      );
      await s.submit(
        mkSubmit({
          id: "old-done",
          state: "completed",
          createdAtMs: Date.now() - 100_000,
        }),
      );
      await s.submit(
        mkSubmit({
          id: "fresh-done",
          state: "completed",
          createdAtMs: Date.now(),
        }),
      );
      expect((await s.listExpired(Date.now())).map((r) => r.id)).toEqual([
        "exp",
      ]);
      const purg = await s.listPurgeable(Date.now() - 50_000);
      expect(purg.map((r) => r.id)).toEqual(["old-done"]);
      expect(await s.purgePayload("old-done")).toBe(true);
      expect((await s.get("old-done")).record!.payload).toBeNull();
      expect(await s.delete("exp")).toBe(true);
      expect((await s.get("exp")).record).toBeNull();
    });
  });
};

contract("RequestStore (in-memory)", createMemoryRequestStore);

describe("pickRequestInboxStores dual-mode", () => {
  it("falls back to memory when repos are null", () => {
    const stores = pickRequestInboxStores({
      agentRequests: null,
      agentSurveys: null,
    });
    expect(stores.backend).toBe("memory");
  });
});

describe("survey store (in-memory)", () => {
  it("open listing excludes inactive/past-close; dedupe by agentId and fpHash", async () => {
    const s = createMemorySurveyStore();
    await s.putSurvey({
      id: "sv1",
      title: "t",
      questions: [],
      active: true,
      closesAtMs: null,
      createdAtMs: 1,
    });
    await s.putSurvey({
      id: "sv2",
      title: "t2",
      questions: [],
      active: false,
      closesAtMs: null,
      createdAtMs: 2,
    });
    await s.putSurvey({
      id: "sv3",
      title: "t3",
      questions: [],
      active: true,
      closesAtMs: Date.now() - 1,
      createdAtMs: 3,
    });
    const open = await s.listOpenSurveys(Date.now());
    expect(open.map((x) => x.id)).toEqual(["sv1"]);

    await s.putAnswer({
      id: "a1",
      surveyId: "sv1",
      agentId: "ag",
      fpHash: "fp",
      answers: {},
      rated: false,
      createdAtMs: 1,
    });
    expect((await s.findAnswerByAgent("sv1", "ag"))!.id).toBe("a1");
    expect(await s.findAnswerByFp("sv1", "fp")).toBeNull(); // agentId set → not anon
    await s.putAnswer({
      id: "a2",
      surveyId: "sv1",
      agentId: null,
      fpHash: "fp",
      answers: {},
      rated: false,
      createdAtMs: 2,
    });
    expect((await s.findAnswerByFp("sv1", "fp"))!.id).toBe("a2");
    expect(await s.markRated("a1")).toBe(true);
    expect(await s.markRated("a1")).toBe(false);
  });
});
