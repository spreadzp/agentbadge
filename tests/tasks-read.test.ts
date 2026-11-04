/**
 * SLICE-206-3: keyless public read layer — /api/tasks/open, /:id,
 * /:id/status, /api/start-here. budget_status derived (D-206-6),
 * zero-budget reputation-only, public projection (no owner metadata).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { marketClear, marketUpsert } from "@agentbadge/passport";
import type { CachedMarketTask } from "@agentbadge/hedera-core";
import { tasksReadRoutes } from "../src/server/routes/tasks-read";

const app = new Hono().route("/", tasksReadRoutes);

function task(over: Partial<CachedMarketTask>): CachedMarketTask {
  return {
    taskId: `t_${Math.random().toString(36).slice(2, 8)}`,
    posterDid: "did:example:poster1",
    title: "task",
    description: "desc",
    priceHbar: 5,
    capabilities: ["code-review"],
    status: "posted",
    txId: "0.0.1@1",
    consensusTimestamp: "1.0",
    createdAt: Date.now(),
    ...over,
  };
}

beforeEach(() => marketClear());

describe("GET /api/tasks/open", () => {
  it("200 keyless, budget_status per task, no owner metadata", async () => {
    marketUpsert(task({ taskId: "t1" }));
    marketUpsert(task({ taskId: "t2", status: "claimed" })); // not open
    const res = await app.request("/api/tasks/open");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tasks: { task_id: string; budget_status: string }[];
      count: number;
    };
    expect(body.count).toBe(1);
    expect(body.tasks[0].task_id).toBe("t1");
    expect(body.tasks[0].budget_status).toBe("DECLARED_NOT_RESERVED");
    expect(JSON.stringify(body)).not.toContain("posterDid");
  });
});

describe("budget_status derivation", () => {
  it("escrowStatus pending → ESCROWED, released → PAID", async () => {
    marketUpsert(task({ taskId: "esc", escrowStatus: "pending" }));
    marketUpsert(task({ taskId: "paid", escrowStatus: "released" }));
    const res = await app.request("/api/tasks/open");
    const { tasks } = (await res.json()) as {
      tasks: { task_id: string; budget_status: string }[];
    };
    expect(tasks.find((t) => t.task_id === "esc")?.budget_status).toBe("ESCROWED");
    expect(tasks.find((t) => t.task_id === "paid")?.budget_status).toBe("PAID");
  });

  it("budget:0 → DECLARED_NOT_RESERVED even with pending escrow", async () => {
    marketUpsert(task({ taskId: "zero", priceHbar: 0, escrowStatus: "pending" }));
    const res = await app.request("/api/tasks/zero");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { budget: number; budget_status: string };
    expect(body.budget).toBe(0);
    expect(body.budget_status).toBe("DECLARED_NOT_RESERVED");
  });
});

describe("GET /api/tasks/:id + /status", () => {
  it("detail has machine_entry with concrete task_id + evidence spec", async () => {
    marketUpsert(task({ taskId: "d1", deadline: 1762732800000 }));
    const res = await app.request("/api/tasks/d1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      description: string;
      deadline: string;
      machine_entry: {
        task_id: string;
        budget: number;
        currency: string;
        calls: { path: string; phase: string; args: string[] }[];
      };
    };
    expect(body.machine_entry.task_id).toBe("d1");
    expect(body.machine_entry.currency).toBe("HBAR");
    expect(body.machine_entry.calls.map((c) => c.phase)).toEqual([
      "read", "bid", "deliver", "verify-status",
    ]);
    const bid = body.machine_entry.calls.find((c) => c.phase === "bid");
    expect(bid?.path).toBe("/api/tasks/d1/bids");
    expect(bid?.args).toContain("idempotency_key");
    expect(body.deadline).toBe(new Date(1762732800000).toISOString());
  });

  it("status endpoint → verify-status phase projection; 404 unknown", async () => {
    marketUpsert(task({ taskId: "s1", status: "delivered" }));
    const res = await app.request("/api/tasks/s1/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; budget_status: string };
    expect(body.status).toBe("delivered");
    const miss = await app.request("/api/tasks/nope/status");
    expect(miss.status).toBe(404);
    const miss2 = await app.request("/api/tasks/nope");
    expect(miss2.status).toBe(404);
  });
});

describe("GET /api/start-here", () => {
  it("entry point: protocol doc + open count + next call", async () => {
    marketUpsert(task({ taskId: "o1" }));
    marketUpsert(task({ taskId: "o2" }));
    const res = await app.request("/api/start-here");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      protocol_doc: string;
      open_tasks: number;
      next_call: { method: string; path: string };
    };
    expect(body.protocol_doc).toBe("/.well-known/agentbadge-machine.json");
    expect(body.open_tasks).toBe(2);
    expect(body.next_call.path).toBe("/api/tasks/open");
  });
});
