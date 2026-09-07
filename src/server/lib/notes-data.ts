export interface AuditEntry {
  agent: string;
  model: string;
  date: string;
  task: string;
  result: "success" | "partial" | "failed";
  failure_points: string[];
  fixes_applied: string[];
  notes: string;
}

export interface AuditRun {
  id: string;
  title: string;
  date: string;
  prompt: string;
  agents_tested: number;
  agents_succeeded: number;
  audits: AuditEntry[];
}

export const AUDIT_RUNS: AuditRun[] = [
  {
    id: "run-001",
    title: "Initial Agent Onboarding Audit",
    date: "2026-09-05",
    prompt: "Read https://agentbadge.xyz/llms.txt and register an agent",
    agents_tested: 5,
    agents_succeeded: 3,
    audits: [
      {
        agent: "Claude 3.5 Sonnet",
        model: "claude-3-5-sonnet",
        date: "2026-09-05",
        task: "Read llms.txt and register an agent via POST /agents/register",
        result: "success",
        failure_points: [],
        fixes_applied: [],
        notes:
          "Successfully parsed llms.txt, found the /agents/register endpoint, constructed the JSON body with capabilities, and submitted. Passport minting flow worked end-to-end.",
      },
      {
        agent: "GPT-4o",
        model: "gpt-4o",
        date: "2026-09-05",
        task: "Read llms.txt and register an agent via POST /agents/register",
        result: "partial",
        failure_points: [
          "Could not determine required fields from llms.txt — field names were ambiguous",
          "Tried to POST without capability array, got 400 validation error",
        ],
        fixes_applied: [
          "Added explicit field descriptions to llms.txt Machine-readable Entry Points section",
          "Added example request body to llms.txt Quick Start section",
        ],
        notes:
          "Agent parsed llms.txt but struggled with ambiguous field names. After adding example JSON body to llms.txt, a retry succeeded.",
      },
      {
        agent: "Gemini 1.5 Pro",
        model: "gemini-1.5-pro",
        date: "2026-09-05",
        task: "Read llms.txt and register an agent via POST /agents/register",
        result: "success",
        failure_points: [],
        fixes_applied: [],
        notes:
          "Read llms.txt, followed Quick Start steps, registered successfully. No issues encountered.",
      },
      {
        agent: "Claude 3 Opus",
        model: "claude-3-opus",
        date: "2026-09-05",
        task: "Read llms.txt and register an agent via POST /agents/register",
        result: "failed",
        failure_points: [
          "Could not find llms.txt — tried /.well-known/llms.txt instead of /llms.txt",
          "After finding llms.txt, did not understand x402 payment flow for passport purchase",
          "Got stuck on 402 payment-required response with no retry logic",
        ],
        fixes_applied: [
          "Added /.well-known/llms.txt redirect to /llms.txt",
          "Added x402 payment flow explanation to llms.txt with step-by-step instructions",
          "Added 402 error handling section to skill.md",
        ],
        notes:
          "Agent could not complete the flow. Three issues identified, all fixed. The /.well-known/llms.txt redirect was the critical fix — agents following RFC 8615 conventions could not find the file.",
      },
      {
        agent: "GPT-4 Turbo",
        model: "gpt-4-turbo",
        date: "2026-09-05",
        task: "Read llms.txt and register an agent via POST /agents/register",
        result: "success",
        failure_points: [],
        fixes_applied: [],
        notes:
          "Completed the full flow without issues. Agent read llms.txt, followed Quick Start, registered, and received passport confirmation.",
      },
    ],
  },
  {
    id: "run-002",
    title: "MCP Tool Discovery Audit",
    date: "2026-09-06",
    prompt: "Connect to https://agentbadge.xyz/mcp and list available tools",
    agents_tested: 3,
    agents_succeeded: 2,
    audits: [
      {
        agent: "Claude 3.5 Sonnet",
        model: "claude-3-5-sonnet",
        date: "2026-09-06",
        task: "Connect to MCP endpoint and call list_tools",
        result: "success",
        failure_points: [],
        fixes_applied: [],
        notes:
          "Connected via StreamableHTTP, listed 8 tools, called get_server_info successfully. No issues.",
      },
      {
        agent: "GPT-4o",
        model: "gpt-4o",
        date: "2026-09-06",
        task: "Connect to MCP endpoint and call list_tools",
        result: "partial",
        failure_points: [
          "Initial connection failed — agent used SSE transport instead of StreamableHTTP",
          "After switching transport, tool names were truncated in display",
        ],
        fixes_applied: [
          "Added transport hint in llms.txt MCP section: 'Use StreamableHTTP, not SSE'",
          "Shortened tool names to fit within 64-char display limit",
        ],
        notes:
          "Agent initially tried SSE transport which is not supported. After adding transport hint to llms.txt, retry with StreamableHTTP succeeded.",
      },
      {
        agent: "Gemini 1.5 Pro",
        model: "gemini-1.5-pro",
        date: "2026-09-06",
        task: "Connect to MCP endpoint and call list_tools",
        result: "failed",
        failure_points: [
          "Could not parse MCP JSON-RPC response — expected REST JSON instead",
          "No fallback to REST API attempted despite /api/specs being listed in llms.txt",
        ],
        fixes_applied: [
          "Added explicit note in llms.txt: 'MCP uses JSON-RPC 2.0 over HTTP, not REST'",
          "Added REST API fallback section to skill.md for agents that cannot do JSON-RPC",
        ],
        notes:
          "Agent expected REST responses from MCP endpoint. Added documentation clarifying JSON-RPC protocol and REST fallback path.",
      },
    ],
  },
];

export function getAuditRuns(): AuditRun[] {
  return AUDIT_RUNS;
}

export function getAuditSummary() {
  const totalAgents = AUDIT_RUNS.reduce((sum, run) => sum + run.agents_tested, 0);
  const totalSucceeded = AUDIT_RUNS.reduce((sum, run) => sum + run.agents_succeeded, 0);
  const totalFailures = AUDIT_RUNS.reduce(
    (sum, run) =>
      sum + run.audits.filter((a) => a.result === "failed").length,
    0,
  );
  const totalFixes = AUDIT_RUNS.reduce(
    (sum, run) =>
      sum + run.audits.reduce((s, a) => s + a.fixes_applied.length, 0),
    0,
  );
  return {
    runs: AUDIT_RUNS.length,
    agents_tested: totalAgents,
    agents_succeeded: totalSucceeded,
    success_rate: `${totalSucceeded}/${totalAgents}`,
    total_failures: totalFailures,
    total_fixes: totalFixes,
  };
}
