/**
 * SLICE-206-5: verdict_submit — independence invariant (verifier ≠
 * owner/worker/platform), PASS/REVISE/FAIL transitions, idempotent.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { getTaskById, marketClear, marketUpsert } from "@agentbadge/passport";
import type { TaskWithVerifier } from "../src/server/lib/tasks/verdict";
import { tasksWriteRoutes } from "../src/server/routes/tasks-write";
import { resetIdempotencyStore } from "../src/server/lib/contract-guards";
import { setPlatformSignersForTesting } from "../src/server/lib/tasks/verdict";
import {
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
} from "../src/server/middleware/agent-auth";

const app = new Hono().route("/", tasksWriteRoutes);

const OWNER = "0x" + "1".repeat(40);
const WORKER = "0x" + "2".repeat(40);
const VERIFIER = "0x" + "3".repeat(40);
const PLATFORM = "0x" + "4".repeat(40);
const IDEM = { "idempotency-key": "test-idem-verdict" };

function sig(wallet: string) {
  // current epoch — verifyWalletSigRequest rejects stale timestamps
  return {
    "x-wallet": wallet,
    "x-sig": "0xdeadbeef",
    "x-timestamp": String(Math.floor(Date.now() / 1000)),
  };
}

function task(over: Partial<TaskWithVerifier>): TaskWithVerifier {
  return {
    taskId: `t_${Math.random().toString(36).slice(2, 8)}`,
    posterDid: "did:example:poster1",
    title: "task",
    description: "desc",
    priceHbar: 5,
    capabilities: [],
    status: "delivered",
    resultBody: "first delivery",
    txId: "0.0.1@1",
    consensusTimestamp: "1.0",
    createdAt: Date.now(),
    // SLICE-206-18 (audit C-1): positive binding — only the designated
    // verifier may verdict. Negative checks (owner/worker/platform)
    // still fire first for their dedicated codes.
    verifierDid: VERIFIER,
    ...over,
  };
}

function post(
  id: string,
  wallet: string,
  body: unknown,
  idem: Record<string, string> = IDEM,
) {
  return app.request(`/api/tasks/${id}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json", ...sig(wallet), ...idem },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  marketClear();
  resetIdempotencyStore();
  // sig-auth verifier stubbed: any wallet+sig is "valid" — the test's
  // focus is the invariant, not crypto.
  configureAgentAuthForTesting({ verifier: async () => true });
  setPlatformSignersForTesting([PLATFORM]);
});
afterEach(() => {
  resetAgentAuthForTesting();
  setPlatformSignersForTesting(null);
});

describe("independence invariant (D-206-4)", () => {
  it("verifier = owner wallet → 403 VERIFIER_IS_OWNER", async () => {
    marketUpsert(task({ taskId: "o1", posterDid: OWNER }));
    const res = await post("o1", OWNER, { verdict: "PASS" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("VERIFIER_IS_OWNER");
  });

  it("verifier = worker wallet → 403 VERIFIER_IS_WORKER", async () => {
    marketUpsert(task({ taskId: "w1", claimerDid: WORKER }));
    const res = await post("w1", WORKER, { verdict: "PASS" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("VERIFIER_IS_WORKER");
  });

  it("verifier = platform signer → 403 VERIFIER_IS_PLATFORM", async () => {
    marketUpsert(task({ taskId: "p1" }));
    const res = await post("p1", PLATFORM, { verdict: "PASS" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("VERIFIER_IS_PLATFORM");
  });
});

describe("designated verifier (audit C-1, 206-18)", () => {
  it("stranger wallet (not designated) → 403 VERIFIER_NOT_DESIGNATED", async () => {
    marketUpsert(task({ taskId: "d1" }));
    const res = await post("d1", "0x" + "9".repeat(40), { verdict: "FAIL" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe(
      "VERIFIER_NOT_DESIGNATED",
    );
  });

  it("worker's second wallet cannot self-PASS → 403", async () => {
    marketUpsert(task({ taskId: "d2", claimerDid: WORKER }));
    // a fresh wallet is NOT the worker identity — before the fix this
    // passed the negative-only check and self-PASSed the delivery.
    const secondWallet = "0x" + "a".repeat(40);
    const res = await post("d2", secondWallet, { verdict: "PASS" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe(
      "VERIFIER_NOT_DESIGNATED",
    );
  });

  it("task without verifierDid → verdict route closed (403)", async () => {
    marketUpsert(task({ taskId: "d3", verifierDid: undefined }));
    const res = await post("d3", VERIFIER, { verdict: "PASS" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe(
      "VERIFIER_NOT_DESIGNATED",
    );
  });

  it("designated verifier DID resolves via identitySet (did + accountId)", async () => {
    marketUpsert(task({ taskId: "d4", verifierDid: "did:example:verifier1" }));
    // wallet that is neither the DID nor its resolved accountId → reject
    const res = await post("d4", "0x" + "b".repeat(40), { verdict: "PASS" });
    expect(res.status).toBe(403);
  });
});

describe("transitions", () => {
  it("PASS → completing (payment-path open), attempts++, external type", async () => {
    marketUpsert(task({ taskId: "a1" }));
    const res = await post("a1", VERIFIER, { verdict: "PASS" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; verification_attempts: number };
    expect(body.status).toBe("completing");
    const t = getTaskById("a1")!;
    expect(t.status).toBe("completing");
    expect(t.verificationAttempts).toBe(1);
    expect(t.verifierType).toBe("external");
  });

  it("REVISE → claimed, prior deliverable preserved in report log", async () => {
    marketUpsert(task({ taskId: "r1", resultBody: "first delivery" }));
    const res = await post("r1", VERIFIER, {
      verdict: "REVISE",
      note: "needs citations",
    });
    expect(res.status).toBe(200);
    const t = getTaskById("r1")!;
    expect(t.status).toBe("claimed");
    expect(t.verificationReport).toContain("first delivery"); // history kept
    expect(t.verificationReport).toContain("needs citations");
    expect(t.verificationReport).toContain(VERIFIER);
  });

  it("FAIL → cancelled with reason", async () => {
    marketUpsert(task({ taskId: "f1" }));
    const res = await post("f1", VERIFIER, { verdict: "FAIL", note: "spam" });
    expect(res.status).toBe(200);
    const t = getTaskById("f1")!;
    expect(t.status).toBe("cancelled");
    expect(t.lastError).toBe("spam");
  });
});

describe("guards (206-2)", () => {
  it("missing idempotency-key → 400 IDEMPOTENCY_KEY_REQUIRED", async () => {
    marketUpsert(task({ taskId: "i1" }));
    const res = await post("i1", VERIFIER, { verdict: "PASS" }, {});
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("same key replay → identical first response + duplicate:true", async () => {
    marketUpsert(task({ taskId: "i2" }));
    const first = await post("i2", VERIFIER, { verdict: "PASS" });
    expect(((await first.json()) as { status: string }).status).toBe("completing");
    // after PASS the task is 'completing' — a naive gate would 400 the
    // retry; dedupe replays the stored first response instead (the whole
    // point of idempotency).
    const replay = await post("i2", VERIFIER, { verdict: "PASS" });
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as {
      duplicate?: boolean;
      status?: string;
      verdict?: string;
    };
    expect(replayBody.duplicate).toBe(true);
    expect(replayBody.status).toBe("completing");
    expect(replayBody.verdict).toBe("PASS");
  });

  it("oversized evidence_refs / note → 400", async () => {
    marketUpsert(task({ taskId: "e1" }));
    const res = await post("e1", VERIFIER, {
      verdict: "PASS",
      evidence_refs: Array(51).fill("r"),
    });
    expect(res.status).toBe(400);
    const res2 = await post("e1", VERIFIER, {
      verdict: "PASS",
      note: "x".repeat(4001),
    });
    expect(res2.status).toBe(400);
  });

  it("no sig-auth headers → 401; non-delivered → 400; unknown task → 404", async () => {
    marketUpsert(task({ taskId: "g1" }));
    const noSig = await app.request("/api/tasks/g1/verdict", {
      method: "POST",
      headers: { "content-type": "application/json", ...IDEM },
      body: JSON.stringify({ verdict: "PASS" }),
    });
    expect(noSig.status).toBe(401);

    marketUpsert(task({ taskId: "g2", status: "posted" }));
    const wrongState = await post("g2", VERIFIER, { verdict: "PASS" });
    expect(wrongState.status).toBe(400);

    const miss = await post("nope", VERIFIER, { verdict: "PASS" });
    expect(miss.status).toBe(404);
  });
});
