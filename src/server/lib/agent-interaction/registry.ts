/**
 * EPIC-233 (SLICE-233-1, D-233-1/2/3): AGENT_INTERACTION_TOOLS — the
 * single registry for the keyless agent-protocol surface.
 *
 * ONE module is the source of truth for:
 *   - tools/list on POST /mcp/agent-interaction (routes/mcp-agent-interaction.ts)
 *   - /.well-known/agent-interaction.json (manifest.ts → routes/well-known)
 *   - parity tests (233-8) — manifest ≡ registry ≡ HEAVY_OPS by construction
 *
 * Isolation decision (landmine, mcp-public precedent): this is a
 * SEPARATE whitelist object — never a `public` flag on internal tools
 * from packages/mcp. A write tool cannot appear here by configuration
 * error; it can only be added by editing this file.
 *
 * Thin-adapter rule (D-233-1): handlers validate input then call the
 * SAME route-level services REST uses — business rules (fingerprint,
 * submit-limit, idempotency, spam-flag) are inherited, never copied.
 * Handlers in this slice are NOT_IMPLEMENTED stubs; real wiring lands
 * in 233-2 (read tools), 233-3 (create_task_request), 233-5 (seams).
 */

import type { Context } from "hono";
import z from "zod";

import { resolveActor, type ResolvedActor } from "./actor";
import {
  handleAsk,
  handleDiscover,
  handleGetRequestStatus,
} from "./tools/read";
import { REQUEST_ID_RE } from "../request-inbox/types";

export const AGENT_INTERACTION_PROTOCOL_VERSION = "2025-03-26";
export const AGENT_INTERACTION_MCP_PATH = "/mcp/agent-interaction";
export const AGENT_INTERACTION_MANIFEST_PATH =
  "/.well-known/agent-interaction.json";

export type AgentToolStatus = "live" | "planned";
export type AgentToolAuth = "none" | "agb_optional";
export type AgentToolRateClass = "base" | "heavy";
export type AgentToolChannel = "mcp" | "webmcp";

/** Identity + request context handed to every tool handler.
 *  agentKeyAuth already resolved `agb_` → c.agentId (401 on bad keys);
 *  anonymous callers carry no credential — 252 fingerprint identity is
 *  computed inside the domain services the handler delegates to. */
export interface AgentToolContext {
  c: Context;
  actor: ResolvedActor;
}

export type AgentToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string; data?: unknown } };

export interface AgentInteractionTool {
  name: string;
  description: string;
  /** live = wired to a shipped backend; planned = NOT_AVAILABLE seam
   *  (D-233-2) until its blocking epic ships. */
  status: AgentToolStatus;
  /** Mirror of the REST auth contract (D-233-6): none = fully keyless;
   *  agb_optional = anonymous allowed, Bearer agb_ elevates to keyed lane. */
  auth: AgentToolAuth;
  /** base = lane bucket only; heavy = +HEAVY_OPS bucket (D-233-7). */
  rateClass: AgentToolRateClass;
  /** REST endpoint this tool is a thin adapter over. */
  rest_equivalent: string;
  /** Surfaces the tool is exposed on (D-233-8: agb_ never reaches
   *  page-context WebMCP — all webmcp tools are keyless by design). */
  channel: readonly AgentToolChannel[];
  /** Zod schema — validated at dispatch; serialized to JSON Schema for
   *  tools/list via z.toJSONSchema. */
  inputSchema: z.ZodType;
  handler: (args: unknown, ctx: AgentToolContext) => Promise<AgentToolResult>;
}

/** 233-1 stub — real adapters land per-slice (233-2/3/5). Tool-level
 *  error (isError result), not a JSON-RPC protocol error: the tool IS
 *  registered, it is honestly unwired yet. */
const notImplemented =
  (name: string, slice: string): AgentInteractionTool["handler"] =>
  async () => ({
    ok: false,
    error: {
      code: "NOT_IMPLEMENTED",
      message: `${name} is registered but not wired yet — lands in ${slice}`,
      data: { planned_slice: slice },
    },
  });

const str = (max: number) => z.string().min(1).max(max);
const strList = (maxItems: number, maxLen: number) =>
  z.array(str(maxLen)).max(maxItems).optional();
const IDEMPOTENCY_KEY_RE = /^[\x20-\x7E]{8,255}$/;
const idempotencyKey = () =>
  z.string().regex(IDEMPOTENCY_KEY_RE).optional();

/** Roster §12.3 → D-233-2. Statuses describe the tool-adapter wiring,
 *  not the backend epic state. */
export const AGENT_INTERACTION_TOOLS: AgentInteractionTool[] = [
  {
    name: "agentbadge_discover",
    description:
      "Capability discovery: what AgentBadge can do for an agent, " +
      "endpoints, auth model and rate classes — this manifest.",
    status: "live",
    auth: "none",
    rateClass: "base",
    rest_equivalent: "GET /.well-known/agent-interaction.json",
    channel: ["mcp", "webmcp"],
    inputSchema: z.object({}).strict(),
    handler: handleDiscover,
  },
  {
    name: "agentbadge_ask",
    description:
      "Ask a question — searches the public QA corpus of previously " +
      "answered agent requests (252 QA fast-path).",
    status: "live",
    auth: "none",
    rateClass: "base",
    rest_equivalent: "GET /api/requests/qa?q={question}",
    channel: ["mcp", "webmcp"],
    inputSchema: z.object({ question: str(2000) }).strict(),
    handler: handleAsk,
  },
  {
    name: "agentbadge_get_request_status",
    description:
      "Poll an async request by id (id = capability — no enumeration). " +
      "submitted|working → poll_after_seconds; completed|failed → " +
      "response; expired → gone.",
    status: "live",
    auth: "none",
    rateClass: "base",
    rest_equivalent: "GET /api/requests/:id",
    channel: ["mcp", "webmcp"],
    inputSchema: z
      .object({ request_id: z.string().regex(REQUEST_ID_RE) })
      .strict(),
    handler: handleGetRequestStatus,
  },
  {
    name: "agentbadge_create_task_request",
    description:
      "Submit an async task/question for human-or-ops processing. " +
      "Returns request_id + poll_url (202 semantics). Idempotent via " +
      "idempotency_key; optional callback_url gets a signed webhook " +
      "on terminal state (D-233-5).",
    status: "live",
    auth: "agb_optional",
    rateClass: "heavy",
    rest_equivalent: "POST /api/requests",
    channel: ["mcp", "webmcp"],
    inputSchema: z
      .object({
        payload: z.unknown(),
        kind: str(64).optional(),
        publish_to_qa: z.boolean().optional(),
        idempotency_key: idempotencyKey(),
        callback_url: str(2048).optional(),
      })
      .strict(),
    handler: notImplemented("agentbadge_create_task_request", "SLICE-233-3"),
  },
  {
    name: "agentbadge_search_knowledge",
    description:
      "Search the public knowledge base (published entries only) — " +
      "229 public search backend.",
    status: "planned",
    auth: "none",
    rateClass: "heavy",
    rest_equivalent: "GET /api/v1/agent/knowledge/search?q={query}",
    channel: ["mcp", "webmcp"],
    inputSchema: z
      .object({
        query: str(500),
        limit: z.number().int().min(1).max(25).optional(),
        kind: str(64).optional(),
        capability: str(128).optional(),
      })
      .strict(),
    handler: notImplemented("agentbadge_search_knowledge", "SLICE-233-5"),
  },
  {
    name: "agentbadge_submit_feedback",
    description:
      "Submit structured feedback/suggestion for human triage " +
      "(230 feedback channel; advisory, no SLA).",
    status: "planned",
    auth: "agb_optional",
    rateClass: "heavy",
    rest_equivalent: "POST /api/v1/agent/feedback",
    channel: ["mcp"],
    inputSchema: z
      .object({
        subject: str(200),
        message: str(4000),
        target: str(128).optional(),
        kind: str(64).optional(),
        idempotency_key: idempotencyKey(),
      })
      .strict(),
    handler: notImplemented("agentbadge_submit_feedback", "SLICE-233-5"),
  },
  {
    name: "agentbadge_request_review",
    description:
      "Request an advisory human review of referenced work (230 review " +
      "channel — NOT an EaaS verdict, attestation or trust artifact).",
    status: "planned",
    auth: "agb_optional",
    rateClass: "heavy",
    rest_equivalent: "POST /api/v1/agent/reviews",
    channel: ["mcp"],
    inputSchema: z
      .object({
        review_type: str(64),
        work_ref: str(500),
        agent_criteria: strList(10, 500),
        evidence: strList(10, 2048),
        idempotency_key: idempotencyKey(),
      })
      .strict(),
    handler: notImplemented("agentbadge_request_review", "SLICE-233-5"),
  },
  {
    name: "agentbadge_report_problem",
    description:
      "Report a bug/problem for human triage (230 feedback channel, " +
      "kind=PROBLEM projection).",
    status: "planned",
    auth: "agb_optional",
    rateClass: "heavy",
    rest_equivalent: "POST /api/v1/agent/feedback",
    channel: ["mcp"],
    inputSchema: z
      .object({
        subject: str(200),
        message: str(4000),
        severity: z.enum(["low", "medium", "high"]).optional(),
        target: str(128).optional(),
        idempotency_key: idempotencyKey(),
      })
      .strict(),
    handler: notImplemented("agentbadge_report_problem", "SLICE-233-5"),
  },
];

const BY_NAME = new Map(AGENT_INTERACTION_TOOLS.map((t) => [t.name, t]));

export function getAgentTool(name: string): AgentInteractionTool | undefined {
  return BY_NAME.get(name);
}

/** tools/list payload — JSON Schema per tool (MCP contract). */
export function agentToolList() {
  return AGENT_INTERACTION_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: z.toJSONSchema(t.inputSchema),
  }));
}

export function resolveAgentToolContext(c: Context): AgentToolContext {
  return { c, actor: resolveActor(c) };
}

export async function callAgentTool(
  name: string,
  args: unknown,
  ctx: AgentToolContext,
): Promise<AgentToolResult> {
  const tool = BY_NAME.get(name);
  if (!tool) {
    return {
      ok: false,
      error: { code: "UNKNOWN_TOOL", message: `unknown tool: ${name}` },
    };
  }
  const parsed = tool.inputSchema.safeParse(args ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "INVALID_PARAMS",
        message: `invalid arguments: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`,
        data: { issues: parsed.error.issues.slice(0, 5) },
      },
    };
  }
  return tool.handler(parsed.data, ctx);
}
