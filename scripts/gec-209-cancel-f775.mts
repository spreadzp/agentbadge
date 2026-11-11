/**
 * 209-6 stray-demand cleanup, round 3: Kevin redeployed Client MCP to
 * release 7089612a — cancel is now in the live schema.
 * Protocol per Kevin: (1) plan_only + confirmed=false = eligibility check;
 * (2) auto + confirmed=true = real buyer-owned cancel of the stray demand.
 * Then read-back both demands.
 * Usage: bun run scripts/gec-209-cancel-f775.mts
 */
import { writeFileSync } from "node:fs";
import {
  Transcript, buyerSession, sasameRun, redact, mcpCall,
} from "./gec-interop.mts";

const STRAY = "demand:f775142c140a725c5ef3bdc88fe4d845";
const KEEP = "demand:0f9572451f00aefe8933aff747ca3bae";
const PROJECT = "project:b05860d6503d9a496f97d5cb3e5aca06";
const EP = "https://live-sasame.sasame.online/mcp";

const t = new Transcript();
const auth = await buyerSession(t);

// 0) Schema check: does sasame_run input schema now list "cancel"?
const tools = await mcpCall(EP, "tools/list", {}, { ...auth, allowRetry: false });
const list = (tools.result as { tools?: Array<{ name: string; inputSchema?: unknown }> }).tools ?? [];
const run = list.find((x) => x.name === "sasame_run");
const schema = JSON.stringify(run?.inputSchema ?? {});
const m = schema.match(/"action"[^}]*?enum[^[]*\[([^\]]+)\]/s);
console.log("=== sasame_run action enum:", m?.[1]?.replace(/\s+/g, "") ?? "enum not found in schema");
console.log("=== schema mentions 'cancel':", schema.includes('"cancel"'));

// 1) Kevin's step 1 — plan_only eligibility probe (no mutation expected).
const probe = await mcpCall(EP, "tools/call", {
  name: "sasame_run",
  arguments: {
    goal: `Buyer requests cancellation of stray demand ${STRAY}. No funds involved.`,
    execution_mode: "plan_only",
    context: { gec: { role: "buyer", action: "cancel", demand_id: STRAY, confirmed: false } },
  },
}, { ...auth, allowRetry: false });
console.log("=== plan_only cancel probe:", JSON.stringify(probe.result ?? probe.error).slice(0, 2000));

const probeTxt = JSON.stringify(probe.result ?? probe.error);
const eligible = !/error|invalid|not_found|reject/i.test(probeTxt) ||
                 /eligib|can.?cancel|allowed|ok/i.test(probeTxt);

// 2) Kevin's step 2 — real cancel (auto + confirmed=true), only if probe ok.
if (eligible) {
  const r = await mcpCall(EP, "tools/call", {
    name: "sasame_run",
    arguments: {
      goal: `Buyer confirms cancellation of stray demand ${STRAY}.`,
      execution_mode: "auto",
      context: { gec: { role: "buyer", action: "cancel", demand_id: STRAY, confirmed: true } },
    },
  }, { ...auth, allowRetry: false });
  console.log("=== auto cancel result:", JSON.stringify(r.result ?? r.error).slice(0, 2000));
} else {
  console.log("=== SKIPPED auto cancel — probe did not confirm eligibility");
}

// 3) Status read-back on both demands.
for (const [label, id] of [["stray", STRAY], ["article", KEEP]] as const) {
  const st = await sasameRun(t, auth, {
    goal: `Read-only: report lifecycle state and eligible actions for demand ${id}.`,
    execution_mode: "plan_only",
    context: { gec: { role: "buyer", action: "status", demand_id: id, project_id: PROJECT } },
  }, `status-${label}`);
  console.log(`=== status ${label}:`, JSON.stringify(redact(st)).slice(0, 2000));
}

writeFileSync("/tmp/209-6-cancel-f775-r3.json", t.toJSON());
console.log("=== transcript saved: /tmp/209-6-cancel-f775-r3.json");
