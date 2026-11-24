import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@modelcontextprotocol/sdk/server/stdio", () => ({
  StdioServerTransport: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { registerTool, type ToolResult } from "@agentbadge/mcp";
import { Hono, type Context, type Next } from "hono";
import { mcpRoutes } from "../../src/server/routes/mcp/mcp";
import { createMcpOpsRoutes } from "../../src/server/routes/mcp/mcp-ops";
import { registerPassportTools } from "@agentbadge/mcp";
import { registerCircleWalletBalanceTools } from "@agentbadge/mcp";

// SLICE-259-8: negative-test matrix — caller × transport × tool.
// The epic-A DoD in executable form: no unauthorized call reaches a
// protected handler, on ANY transport. Every denied case additionally
// asserts the handler spy was NOT invoked (denial happens pre-dispatch).

// ─── Stub tools (spy-verified; one per exposure/publicTier cell) ──

const spies = new Map<string, ReturnType<typeof vi.fn>>();
function spyFor(name: string) {
  const s = vi.fn(async (): Promise<ToolResult> => ({
    content: [{ type: "text", text: "executed" }],
  }));
  spies.set(name, s);
  return s;
}

const T_CUR = "mtx_cur_pub";
const T_EXT = "mtx_ext_pub";
const T_AUTH = "mtx_auth";
const T_ADMIN = "mtx_admin";
const T_NOEXP = "mtx_noexp"; // no options → deny-by-default admin
const T_UNKNOWN = "mtx_unknown_zzz"; // never registered

registerTool(T_CUR, "curated public", {}, spyFor(T_CUR), {
  exposure: "public",
  publicTier: "curated",
});
registerTool(T_EXT, "extended public", {}, spyFor(T_EXT), {
  exposure: "public",
});
registerTool(T_AUTH, "authenticated", {}, spyFor(T_AUTH), {
  exposure: "authenticated",
});
registerTool(T_ADMIN, "admin", {}, spyFor(T_ADMIN), { exposure: "admin" });
registerTool(T_NOEXP, "unclassified", {}, spyFor(T_NOEXP));

// Real registrations — used only in deny cells (transport denies
// before the handler, so no network is ever touched).
registerPassportTools();
registerCircleWalletBalanceTools();

const ADMIN_KEY = "test-admin-key";

// ─── Fixture app ─────────────────────────────────────────────────

function makeApp(setAgent?: (c: Context) => void): Hono {
  const app = new Hono();
  if (setAgent) {
    app.use("*", async (c: Context, next: Next) => {
      setAgent(c);
      await next();
    });
  }
  app.route("/", mcpRoutes);
  app.route("/mcp/ops", createMcpOpsRoutes());
  return app;
}

const anonApp = makeApp();
const agentApp = makeApp((c) => c.set("agentId", "agent-1"));

// ─── Matrix definition ───────────────────────────────────────────

type Expected = "allow" | "deny";

interface ToolCell {
  name: string;
  spy: boolean; // real tools can't be spied — deny asserts response only
  anon: Expected;
  agent: Expected;
  admin: Expected;
}

const MATRIX: ToolCell[] = [
  { name: T_CUR, spy: true, anon: "allow", agent: "allow", admin: "allow" },
  { name: T_EXT, spy: true, anon: "allow", agent: "allow", admin: "allow" },
  { name: T_AUTH, spy: true, anon: "deny", agent: "allow", admin: "allow" },
  { name: T_ADMIN, spy: true, anon: "deny", agent: "deny", admin: "allow" },
  { name: T_NOEXP, spy: true, anon: "deny", agent: "deny", admin: "allow" },
  { name: T_UNKNOWN, spy: false, anon: "deny", agent: "deny", admin: "deny" },
  // Special real tools — deny cells only (never called as admin here,
  // so their real handlers never run).
  {
    name: "revoke_passport",
    spy: false,
    anon: "deny",
    agent: "deny",
    admin: "deny",
  },
  {
    name: "circle_wallet_balance",
    spy: false,
    anon: "deny",
    agent: "deny",
    admin: "deny",
  },
  {
    name: "upgrade_tier",
    spy: false,
    anon: "deny",
    agent: "deny",
    admin: "deny",
  },
];

// upgrade_tier as admin → would reach the real handler (arg validation
// runs inside) — the cell is "deny" only for anon/agent; for admin we
// skip the call to avoid a chain lookup. Marked via skipAdminCall.
const SKIP_ADMIN_CALL = new Set([
  "revoke_passport",
  "circle_wallet_balance",
  "upgrade_tier",
]);

// ─── Transport callers ───────────────────────────────────────────

type Transport = "rpc" | "batch" | "rest" | "ops-rpc" | "ops-rest";

interface CallResult {
  denied: boolean;
  detail: string;
}

const rpcBody = (name: string, id = 1) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: {} },
  });

async function callTool(
  app: Hono,
  transport: Transport,
  name: string,
  headers: Record<string, string>,
): Promise<CallResult> {
  if (transport === "rpc") {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: rpcBody(name),
    });
    const data = (await res.json()) as {
      error?: { message: string };
      result?: { isError?: boolean; content?: { text: string }[] };
    };
    if (data.error) return { denied: true, detail: `rpc-error ${data.error.message}` };
    const isErr = data.result?.isError === true;
    return { denied: isErr, detail: isErr ? "result.isError" : "ok" };
  }

  if (transport === "batch") {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } },
      ]),
    });
    const data = (await res.json()) as Array<{
      error?: { message: string };
      result?: { isError?: boolean };
    }>;
    const item = data[0] ?? {};
    if (item.error) return { denied: true, detail: `batch-error ${item.error.message}` };
    return item.result?.isError
      ? { denied: true, detail: "batch result.isError" }
      : { denied: false, detail: "ok" };
  }

  if (transport === "rest") {
    const res = await app.request(`/mcp/tools/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: "{}",
    });
    if (res.status === 403 || res.status === 404)
      return { denied: true, detail: `http ${res.status}` };
    const data = (await res.json()) as { isError?: boolean };
    return data.isError
      ? { denied: true, detail: "rest isError" }
      : { denied: false, detail: "ok" };
  }

  const path =
    transport === "ops-rest" ? `/mcp/ops/tools/${name}` : "/mcp/ops";
  const res = await app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: transport === "ops-rest" ? "{}" : rpcBody(name),
  });
  if (res.status === 401) return { denied: true, detail: "ops 401" };
  if (res.status === 403 || res.status === 404)
    return { denied: true, detail: `ops ${res.status}` };
  const data = (await res.json()) as {
    error?: { message: string };
    result?: { isError?: boolean };
    isError?: boolean;
  };
  if (data.error) return { denied: true, detail: "ops rpc-error" };
  const isErr = data.isError === true || data.result?.isError === true;
  return { denied: isErr, detail: isErr ? "ops isError" : "ok" };
}

// ─── Report fixture ──────────────────────────────────────────────

const reportRows: string[] = [];
function record(row: string) {
  reportRows.push(row);
}

// ─── Matrix ──────────────────────────────────────────────────────

const MAIN_TRANSPORTS: Transport[] = ["rpc", "batch", "rest"];
const OPS_TRANSPORTS: Transport[] = ["ops-rpc", "ops-rest"];

describe("negative matrix — caller × transport × tool (SLICE-259-8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    // 264-8: /mcp/ops is operatorAuth now — the shared key rides the
    // dual-auth window as break_glass legacy_admin (read+workflow).
    process.env.ADMIN_LEGACY_KEY_UNTIL = "2999-01-01T00:00:00Z";
  });

  afterAll(() => {
    const header =
      "# Negative-test matrix report (SLICE-259-8)\n\n" +
      "Generated by tests/mcp/negative-matrix.test.ts — do not edit.\n\n" +
      "| caller | transport | tool | expected | observed | spy-called |\n" +
      "|---|---|---|---|---|---|\n";
    writeFileSync(
      join(__dirname, "negative-matrix.report.md"),
      header + reportRows.join("\n") + "\n",
    );
  });

  const callers = [
    { label: "anon", app: anonApp, headers: {} as Record<string, string>, key: "anon" as const },
    { label: "agb_", app: agentApp, headers: {} as Record<string, string>, key: "agent" as const },
    {
      label: "admin",
      app: anonApp,
      headers: { "X-Admin-Key": ADMIN_KEY } as Record<string, string>,
      key: "admin" as const,
    },
  ];

  for (const caller of callers) {
    describe(`caller=${caller.label}`, () => {
      for (const cell of MATRIX) {
        if (caller.key === "admin" && SKIP_ADMIN_CALL.has(cell.name)) continue;
        it(`${cell.name} → ${cell[caller.key]} on /mcp transports`, async () => {
          for (const t of MAIN_TRANSPORTS) {
            const res = await callTool(caller.app, t, cell.name, caller.headers);
            const expected = cell[caller.key];
            const spyCalled = cell.spy
              ? spies.get(cell.name)!.mock.calls.length > 0
              : false;
            record(
              `| ${caller.label} | ${t} | ${cell.name} | ${expected} | ${res.denied ? "deny" : "allow"} (${res.detail}) | ${cell.spy ? spyCalled : "n/a"} |`,
            );
            if (expected === "deny") {
              expect(res.denied, `${t}: ${cell.name} should be denied (${res.detail})`).toBe(true);
              if (cell.spy) {
                expect(
                  spies.get(cell.name)!,
                  `${t}: handler must not run on deny`,
                ).not.toHaveBeenCalled();
              }
            } else {
              expect(res.denied, `${t}: ${cell.name} should be allowed (${res.detail})`).toBe(false);
            }
            spies.get(cell.name)?.mockClear();
          }
        });
      }

      it("ops transports behave per adminAuth gate", async () => {
        for (const t of OPS_TRANSPORTS) {
          // Admin tool call on the ops surface
          const res = await callTool(caller.app, t, T_ADMIN, caller.headers);
          const expected: Expected = caller.key === "admin" ? "allow" : "deny";
          record(
            `| ${caller.label} | ${t} | ${T_ADMIN} | ${expected} | ${res.denied ? "deny" : "allow"} (${res.detail}) | n/a |`,
          );
          if (expected === "deny") {
            expect(res.denied, `${t}: ops must be denied for ${caller.label} (${res.detail})`).toBe(true);
            expect(spies.get(T_ADMIN)!, "ops deny must not reach handler").not.toHaveBeenCalled();
          } else {
            expect(res.denied, `${t}: admin should reach ops (${res.detail})`).toBe(false);
            spies.get(T_ADMIN)?.mockClear();
          }
        }
      });
    });
  }

  it("admin caller reaches all stub tools on ops (happy path)", async () => {
    const res = await callTool(
      anonApp,
      "ops-rest",
      T_ADMIN,
      { "X-Admin-Key": ADMIN_KEY },
    );
    expect(res.denied).toBe(false);
    expect(spies.get(T_ADMIN)!).toHaveBeenCalled();
    record(`| admin | ops-rest | ${T_ADMIN} | allow | allow (${res.detail}) | true |`);
    spies.get(T_ADMIN)?.mockClear();
  });
});
