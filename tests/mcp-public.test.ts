/**
 * SLICE-206-4: keyless public MCP facade /mcp/public — whitelist
 * read-only tools over the 206-3 read layer, plain JSON-RPC, no auth.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { marketClear, marketUpsert } from "@agentbadge/passport";
import type { CachedMarketTask } from "@agentbadge/hedera-core";
import { mcpPublicRoutes } from "../src/server/routes/mcp-public";

const app = new Hono().route("/", mcpPublicRoutes);

function rpc(method: string, params?: Record<string, unknown>, id = 1) {
  return app.request("/mcp/public", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

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

describe("POST /mcp/public JSON-RPC", () => {
  it("tools/list → read-only whitelist, zero write tools", async () => {
    const res = await rpc("tools/list");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { tools: { name: string }[] };
    };
    const names = body.result.tools.map((t) => t.name);
    expect(names).toEqual(["open_tasks", "get_task", "task_status", "start_here"]);
    // no write verbs anywhere in the whitelist
    expect(names.some((n) => /post|create|claim|deliver|complete|pay|write/.test(n))).toBe(false);
  });

  it("tools/call open_tasks → tasks from store, keyless", async () => {
    marketUpsert(task({ taskId: "m1" }));
    marketUpsert(task({ taskId: "m2", status: "claimed" }));
    const res = await rpc("tools/call", {
      name: "open_tasks",
      arguments: {},
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: {
        structuredContent: {
          tasks: { task_id: string; budget_status: string }[];
          count: number;
        };
      };
    };
    const data = body.result.structuredContent;
    expect(data.count).toBe(1);
    expect(data.tasks[0].task_id).toBe("m1");
    expect(data.tasks[0].budget_status).toBe("DECLARED_NOT_RESERVED");
  });

  it("get_task returns machine_entry; unknown task → JSON-RPC error", async () => {
    marketUpsert(task({ taskId: "d1" }));
    const ok = await rpc("tools/call", {
      name: "get_task",
      arguments: { task_id: "d1" },
    });
    const okBody = (await ok.json()) as {
      result: { structuredContent: { machine_entry: { task_id: string } } };
    };
    expect(okBody.result.structuredContent.machine_entry.task_id).toBe("d1");

    const miss = await rpc("tools/call", {
      name: "get_task",
      arguments: { task_id: "nope" },
    });
    const missBody = (await miss.json()) as { error?: { code: number } };
    expect(missBody.error?.code).toBe(-32601);
  });

  it("start_here + initialize + unknown method + plain-JSON responses", async () => {
    marketUpsert(task({ taskId: "x1" }));
    const start = await rpc("tools/call", { name: "start_here" });
    const startBody = (await start.json()) as {
      result: { structuredContent: { open_tasks: number; protocol_doc: string } };
    };
    expect(startBody.result.structuredContent.open_tasks).toBe(1);
    expect(startBody.result.structuredContent.protocol_doc).toBe(
      "/.well-known/agentbadge-machine.json",
    );

    const init = await rpc("initialize");
    const initBody = (await init.json()) as {
      result: { serverInfo: { name: string } };
    };
    expect(initBody.result.serverInfo.name).toBe("agentbadge-market-public");

    const unknown = await rpc("post_task");
    const unknownBody = (await unknown.json()) as { error?: { code: number } };
    expect(unknownBody.error?.code).toBe(-32601);

    // plain JSON everywhere — client needs no SSE parser
    for (const res of [start, init, unknown]) {
      expect(res.headers.get("content-type")).toContain("application/json");
    }
  });

  it("auth headers are ignored (keyless contract)", async () => {
    const res = await app.request("/mcp/public", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-wallet": "0x" + "a".repeat(40),
        "x-sig": "0x" + "b".repeat(130),
        "x-timestamp": "1",
        "mcp-session-id": "bogus",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: unknown; error?: unknown };
    expect(body.result).toBeDefined();
    expect(body.error).toBeUndefined();
  });
});

describe("GET /mcp/public", () => {
  it("returns facade descriptor as plain JSON", async () => {
    const res = await app.request("/mcp/public");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tools: string[]; auth: string };
    expect(body.tools).toContain("open_tasks");
    expect(body.auth).toContain("none");
  });
});
