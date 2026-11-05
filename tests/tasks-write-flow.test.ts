/**
 * SLICE-206-6 e2e: external burner bids → owner awards → worker
 * delivers → independent verifier PASS → payment-ready (completing).
 * All under sig-auth + idempotency; no registration required.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { getTaskById, marketClear, marketUpsert } from "@agentbadge/passport";
import type { TaskWithVerifier } from "../src/server/lib/tasks/verdict";
import { tasksWriteRoutes } from "../src/server/routes/tasks-write";
import { tasksWriteFlowRoutes } from "../src/server/routes/tasks-write-flow";
import { tasksReadRoutes } from "../src/server/routes/tasks-read";
import { resetBidStoresForTesting } from "../src/server/lib/tasks/bids";
import { resetIdempotencyStore } from "../src/server/lib/contract-guards";
import { setPlatformSignersForTesting } from "../src/server/lib/tasks/verdict";
import {
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
} from "../src/server/middleware/agent-auth";

const app = new Hono()
  .route("/", tasksWriteRoutes)
  .route("/", tasksWriteFlowRoutes)
  .route("/", tasksReadRoutes);

const OWNER = "0x" + "1".repeat(40);
const BIDDER = "0x" + "2".repeat(40);
const BIDDER2 = "0x" + "5".repeat(40);
const VERIFIER = "0x" + "3".repeat(40);
const PLATFORM = "0x" + "4".repeat(40);

function sig(wallet: string) {
  return {
    "x-wallet": wallet,
    "x-sig": "0xdeadbeef",
    "x-timestamp": String(Math.floor(Date.now() / 1000)),
  };
}

function task(over: Partial<TaskWithVerifier>): TaskWithVerifier {
  return {
    taskId: `t_${Math.random().toString(36).slice(2, 8)}`,
    posterDid: OWNER, // wallet-shaped owner identity (agent contour)
    title: "review task",
    description: "write a review",
    priceHbar: 5,
    capabilities: [],
    status: "posted",
    txId: "0.0.1@1",
    consensusTimestamp: "1.0",
    createdAt: Date.now(),
    ...over,
  };
}

function post(
  path: string,
  wallet: string,
  body: unknown,
  key = `test-idem-${Math.random().toString(36).slice(2)}`,
) {
  return app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
      ...sig(wallet),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  marketClear();
  resetBidStoresForTesting();
  resetIdempotencyStore();
  configureAgentAuthForTesting({ verifier: async () => true });
  setPlatformSignersForTesting([PLATFORM]);
});
afterEach(() => {
  resetAgentAuthForTesting();
  setPlatformSignersForTesting(null);
});

describe("e2e: bid → award → deliver → verdict PASS", () => {
  it("full path: external burner completes to payment-ready", async () => {
    marketUpsert(task({ taskId: "e2e1", verifierDid: VERIFIER }));

    // 1. bid — no registration, sig-auth only
    const bid = await post("/api/tasks/e2e1/bids", BIDDER, {
      price: 4.5,
      eta_seconds: 3600,
      note: "can do today",
    });
    expect(bid.status).toBe(200);
    const bidBody = (await bid.json()) as { bid_id: string; status: string };
    expect(bidBody.bid_id).toMatch(/^bid_/);
    expect(bidBody.status).toBe("submitted");

    // 2. award — owner only (non-owner would 403)
    const stranger = await post("/api/tasks/e2e1/awards", BIDDER2, {
      bid_id: bidBody.bid_id,
    });
    expect(stranger.status).toBe(403);
    const award = await post("/api/tasks/e2e1/awards", OWNER, {
      bid_id: bidBody.bid_id,
    });
    expect(award.status).toBe(200);
    expect((await award.json()) as { status: string }).toMatchObject({
      status: "claimed",
    });
    expect(getTaskById("e2e1")!.claimerDid).toBe(BIDDER.toLowerCase());

    // 3. deliver — only the awarded worker
    const notWorker = await post("/api/tasks/e2e1/deliverables", OWNER, {
      summary: "attempted by owner",
    });
    expect(notWorker.status).toBe(403);
    const dlv = await post("/api/tasks/e2e1/deliverables", BIDDER, {
      summary: "review done",
      evidence_refs: ["ipfs://evidence1"],
    });
    expect(dlv.status).toBe(200);
    expect(getTaskById("e2e1")!.status).toBe("delivered");

    // 4. independent verdict → payment-ready (completing)
    const verdict = await post("/api/tasks/e2e1/verdict", VERIFIER, {
      verdict: "PASS",
    });
    expect(verdict.status).toBe(200);
    const t = getTaskById("e2e1")!;
    expect(t.status).toBe("completing"); // payment-path open
    expect(t.verificationAttempts).toBe(1);
  });

  it("bid/deliver dedupe: replayed key → duplicate:true", async () => {
    marketUpsert(task({ taskId: "e2e2" }));
    const key = "test-idem-bid-dup";
    const first = await post("/api/tasks/e2e2/bids", BIDDER, {}, key);
    expect(first.status).toBe(200);
    const replay = await post("/api/tasks/e2e2/bids", BIDDER, {}, key);
    expect(replay.status).toBe(200);
    const body = (await replay.json()) as { duplicate?: boolean };
    expect(body.duplicate).toBe(true);
    // second bid from same wallet, different key → 409
    const second = await post("/api/tasks/e2e2/bids", BIDDER, {});
    expect(second.status).toBe(409);
  });

  it("machine_entry advertises exactly the live agent-contour paths", async () => {
    marketUpsert(task({ taskId: "e2e3" }));
    const res = await app.request("/api/tasks/e2e3");
    const body = (await res.json()) as {
      machine_entry: { calls: { phase: string; method: string; path: string }[] };
    };
    const paths = body.machine_entry.calls.map((c) => `${c.method} ${c.path}`);
    for (const expected of [
      "GET /api/tasks/e2e3",
      "POST /api/tasks/e2e3/bids",
      "POST /api/tasks/e2e3/awards",
      "POST /api/tasks/e2e3/deliverables",
      "POST /api/tasks/e2e3/verdict",
      "GET /api/tasks/e2e3/status",
    ]) {
      expect(paths).toContain(expected);
      // reachable = route mounted (any non-404 status proves it)
      const probe = await app.request(expected.split(" ")[1], {
        method: expected.split(" ")[0],
        headers: { "content-type": "application/json" },
      });
      expect(probe.status).not.toBe(404);
    }
  });
});
