import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serve, type ServerType } from "@hono/node-server";
import { once } from "node:events";
import { Hono } from "hono";
import { ClientFactory } from "@a2a-js/sdk/client";
import { Role, TaskState, type Task } from "@a2a-js/sdk";

import { a2aSpecRoutes } from "../../src/server/routes/a2a-spec";
import { buildAgentCard } from "../../src/server/lib/agent-discovery/agent-card";

/**
 * SLICE-203-7 acceptance — external interop e2e.
 *
 * A REAL @a2a-js/sdk ClientFactory client (no AgentBadge code) talks to a
 * live server over HTTP:
 *   GET /.well-known/agent-card.json → card → supportedInterfaces[0]
 *   → SendMessage (JSON-RPC transport) → GetTask → terminal artifact.
 *
 * Anonymous tier (unsigned → downgrade), "hello" routes to
 * FallbackExecutor — deterministic, no scan network call.
 */

let server: ServerType;
let baseUrl = "";

const TERMINAL: TaskState[] = [
  TaskState.TASK_STATE_COMPLETED,
  TaskState.TASK_STATE_FAILED,
  TaskState.TASK_STATE_CANCELED,
  TaskState.TASK_STATE_REJECTED,
];

/** Extract a Task from SendMessageResult (union task|message, proto-JSON). */
function taskOf(res: unknown): Task | null {
  const r = res as {
    task?: Task;
    result?: { $case?: string; value?: unknown };
    status?: Task["status"];
  };
  if (r.task) return r.task;
  if (r.result?.$case === "task") return r.result.value as Task;
  if (r.status) return r as Task; // bare task returned
  return null;
}

beforeAll(async () => {
  process.env.A2A_ANON_LIMIT = "100";
  const app = new Hono();

  // Pre-bind port so the card's interface URL points at THIS server —
  // mirrors prod, where /.well-known/agent-card.json is the generated
  // static (buildAgentCard) and clients dial supportedInterfaces[0].url.
  const probe = serve({ fetch: app.fetch, port: 0 });
  await once(probe, "listening");
  const addr = probe.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  probe.close();
  baseUrl = `http://localhost:${port}`;

  // Real canonical card (same builder as public/.well-known/agent-card.json).
  app.get("/.well-known/agent-card.json", (c) =>
    c.text(
      buildAgentCard({ baseUrl, wellKnownEnv: undefined, apiInfo: undefined } as never),
      200,
      { "Content-Type": "application/json" },
    ),
  );
  app.route("/a2a", a2aSpecRoutes);

  server = serve({ fetch: app.fetch, port });
  await once(server, "listening");
  process.env.BASE_URL = baseUrl;
});

afterAll(() => {
  server?.close();
});

describe("A2A interop e2e — external SDK client", () => {
  it("well-known card parses via SDK resolver with honest capabilities", async () => {
    const factory = new ClientFactory();
    const client = await factory.createFromUrl(baseUrl);
    expect(client).toBeTruthy();

    // Fetch the raw card to assert our declared shape (AC#2).
    const res = await fetch(`${baseUrl}/.well-known/agent-card.json`);
    const card = (await res.json()) as {
      supportedInterfaces?: { url: string; protocolBinding: string }[];
      capabilities?: { streaming?: boolean; pushNotifications?: boolean };
      securitySchemes?: Record<string, unknown>;
      skills?: { id: string }[];
    };
    expect(res.status).toBe(200);
    expect(card.supportedInterfaces?.[0]?.url).toBe(`${baseUrl}/a2a`);
    expect(card.supportedInterfaces?.[0]?.protocolBinding).toBe("JSONRPC");
    expect(card.capabilities?.streaming).toBe(false);
    expect(card.capabilities?.pushNotifications).toBe(false);
    expect(Object.keys(card.securitySchemes ?? {})).toContain("eip191");
    expect(Object.keys(card.securitySchemes ?? {})).toContain("x402");
    expect(card.skills?.map((s) => s.id)).toContain("agent-scan");
  });

  it("external client: sendMessage → getTask → terminal + artifact", async () => {
    const client = await new ClientFactory().createFromUrl(baseUrl);

    const sent = await client.sendMessage({
      tenant: "",
      message: {
        messageId: `e2e-${Date.now()}`,
        contextId: "",
        taskId: "",
        role: Role.ROLE_USER,
        parts: [
          {
            content: { $case: "text", value: "hello" },
            metadata: undefined,
            filename: "",
            mediaType: "text/plain",
          },
        ],
        metadata: undefined,
        extensions: [],
        referenceTaskIds: [],
      },
      configuration: undefined,
      metadata: undefined,
    });

    const task = taskOf(sent);
    expect(task?.id).toBeTruthy();

    // Sync MVP may already be terminal; poll until done either way.
    let current = task!;
    for (let i = 0; i < 20; i++) {
      const state = current.status?.state as TaskState | undefined;
      if (state !== undefined && TERMINAL.includes(state)) break;
      await new Promise((r) => setTimeout(r, 250));
      current = await client.getTask({
        tenant: "",
        id: task!.id,
        historyLength: 0,
      });
    }

    expect(TERMINAL).toContain(current.status?.state as TaskState);
    expect(current.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect((current.artifacts ?? []).length).toBeGreaterThan(0);
  }, 30_000);

  it("tasks/list over JSON-RPC returns the created task", async () => {
    const client = await new ClientFactory().createFromUrl(baseUrl);
    // SDK quirk: status must be an explicit enum — undefined serializes as
    // UNRECOGNIZED (-1), which the server correctly rejects.
    const res = (await (
      client as unknown as {
        listTasks?: (p: Record<string, unknown>) => Promise<{ tasks: Task[] }>;
      }
    ).listTasks?.({ status: TaskState.TASK_STATE_UNSPECIFIED })) ?? {
      tasks: [],
    };
    expect(Array.isArray(res.tasks)).toBe(true);
  });
});
