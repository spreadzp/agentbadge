/**
 * 209-6 stray-demand probe: ask sasame (plan_only — never mutates) what
 * management actions exist for demand:f775142c140a725c5ef3bdc88fe4d845.
 * Usage: bun run scripts/gec-209-probe.mts [goal-variant]
 */
import { writeFileSync } from "node:fs";
import {
  Transcript, buyerSession, sasameRun, buildSasameRunArgs, redact, mcpCall,
} from "./gec-interop.mts";

const DEMAND = "demand:f775142c140a725c5ef3bdc88fe4d845";
const PROJECT = "project:b05860d6503d9a496f97d5cb3e5aca06";

const t = new Transcript();
const auth = await buyerSession(t);

// Probe 1: what buyer actions exist on a published demand (withdraw? edit?)
const probe1 = await sasameRun(t, auth, buildSasameRunArgs({
  goal: `I am the buyer who published demand ${DEMAND}. I need to either withdraw/cancel it or edit its objective text. Report which buyer actions are actually available on this published demand and how to invoke them. Read-only — do not mutate anything.`,
  action: "status", demandId: DEMAND, projectId: PROJECT,
  executionMode: "plan_only",
}), "probe-manage-actions");
console.log("=== probe1 (manage actions):", JSON.stringify(redact(probe1)).slice(0, 2500));

// Probe 2: plan_only draft targeting the same demand — does "draft" mean edit?
const probe2 = await sasameRun(t, auth, buildSasameRunArgs({
  goal: `Update the objective of published demand ${DEMAND} to read the listed AgentBadge blog posts and publish one synthesis article. Plan only.`,
  action: "draft", demandId: DEMAND, projectId: PROJECT,
  executionMode: "plan_only",
}), "probe-edit-draft");
console.log("=== probe2 (edit draft):", JSON.stringify(redact(probe2)).slice(0, 2500));

// Probe 3: plan_only withdraw attempt — does sasame interpret a cancel goal?
const probe3 = await sasameRun(t, auth, buildSasameRunArgs({
  goal: `Withdraw and cancel published demand ${DEMAND} — it was published with the wrong objective text. No provider should be able to bid on it. Plan only.`,
  action: "publish", demandId: DEMAND, projectId: PROJECT,
  executionMode: "plan_only",
}), "probe-withdraw");
console.log("=== probe3 (withdraw):", JSON.stringify(redact(probe3)).slice(0, 2500));

// Probe 4: session-grant prepare — what does sasame want signed, and how?
const probe4 = await sasameRun(t, auth, buildSasameRunArgs({
  goal: "Prepare a session grant (agent_session_grant_prepare) so this buyer " +
    "wallet can publish one demand with cap 3500000 microUSDC. Tell me the " +
    "exact grant fields to supply in context.authority and what the root " +
    "wallet must sign (message format + where the signature goes). Plan only.",
  action: "status", executionMode: "plan_only",
}), "probe-session-grant");
console.log("=== probe4 (session grant):", JSON.stringify(redact(probe4)).slice(0, 3000));

// Probe 5: supply context.authority fully — does sasame return a signature
// payload, or tell us which values are wrong?
const probe5 = await sasameRun(t, auth, {
  goal: "Prepare a session grant so the buyer can publish one paid demand.",
  execution_mode: "plan_only",
  context: {
    authority: {
      session_signer_address: "0x3bf7bf14c839ac615f87cdede344df01b9cfb89f",
      adapter_kind: "eip191",
      permitted_actions: ["demand.publish", "demand.draft", "demand.status"],
      series_ids: ["gec"],
      max_per_action_minor: "3500000",
      max_total_minor: "3500000",
      max_actions: "10",
      expires_at_unix: String(Math.floor(Date.now() / 1000) + 3600),
      nonce: "0x" + "ab".repeat(32), // 32-byte hex per live validation
    },
  },
}, "probe-authority-filled");
console.log("=== probe5 (authority filled):", JSON.stringify(redact(probe5)).slice(0, 3000));

// Probe 6: draft→commit for the REAL demand in ONE session — mirrors the
// project-commit path that worked without a session grant.
import { readFileSync } from "node:fs";
const brief = readFileSync(
  "../../docs/EPICS/209-gec-buyer-route/assets/provider-prompt-FINAL.md", "utf8");
const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const OBJ =
  "Commissioned article task (paid via a GEC marketplace — disclose this in " +
  "the post): write and publish ONE original 600-1200-word technical article " +
  "for developers showing how AgentBadge's pieces compose into a working " +
  "agent economy: agents prove identity -> readiness scan -> task board -> " +
  "budgeted work -> USDC payment -> on-chain verdicts. Directly link at least " +
  "3 of these AgentBadge posts in the body: agentbadge.xyz/blog/" +
  "what-is-agent-readiness, arc-c29-task-board, arc-c30-agent-economy, " +
  "arc-c31-agent-allowance, arc-c32-payment-forensics, " +
  "gec-interop-field-report, usdc-rescue-base-to-arc, " +
  "supply-chain-participant-roles. Include an AI-content disclosure per the " +
  "venue's policy; publish on Hashnode/X/dev.to/Medium/LinkedIn/personal blog " +
  "(never Reddit); submit the public post URL + full article text.";
const CONS = [
  "verification_policy EXTERNAL_OUTCOME",
  "verification_assurance DECLARED_POLICY_ONLY",
  "criteria: 1 public article URL (live, publicly accessible)",
  "criteria: >=3 direct links to the listed AgentBadge URLs in body",
  "criteria: submission = post URL + full article text",
  "criteria: commissioned/sponsored disclosure present",
  "criteria: publishing account is not AgentBadge-owned",
  "criteria: venue AI-content policy respected; Reddit forbidden",
  "style: original synthesis 'wow' moment — guidance not gate",
];
// Probe 6: demand_create — llms.txt names it the canonical funded-demand rail
// (low-level tool, not in default tools/list). Empty args → validation error
// reveals the schema.
// gec_demand_create wants: objective, acceptance_criteria, max_budget_minor,
// deadline, required_capabilities (+ project_id). Feed the real spec — this is
// the intended funded-demand write.
const REAL_OBJ =
  "Commissioned article task (paid via a GEC marketplace — disclose this in " +
  "the post): write and publish ONE original 600-1200-word technical article " +
  "for developers showing how AgentBadge's pieces compose into a working " +
  "agent economy: agents prove identity -> readiness scan -> task board -> " +
  "budgeted work -> USDC payment -> on-chain verdicts. Directly link at least " +
  "3 of these AgentBadge posts in the body: agentbadge.xyz/blog/" +
  "what-is-agent-readiness, arc-c29-task-board, arc-c30-agent-economy, " +
  "arc-c31-agent-allowance, arc-c32-payment-forensics, " +
  "gec-interop-field-report, usdc-rescue-base-to-arc, " +
  "supply-chain-participant-roles. Include an AI-content disclosure per the " +
  "venue's policy; publish on Hashnode/X/dev.to/Medium/LinkedIn/personal blog " +
  "(never Reddit); submit the public post URL + full article text.";
const REAL_CRITERIA = [
  "1 public article URL that is live and publicly accessible",
  ">=3 direct links to the listed AgentBadge URLs inside the article body",
  "submission = public post URL + full article text",
  "commissioned/sponsored disclosure present in the post",
  "publishing account is not owned or operated by AgentBadge",
  "venue AI-content policy respected; Reddit is forbidden",
  "verifier must be an independent participant, not the buyer and not the provider",
];
const REAL_ARGS = {
  project_id: PROJECT,
  idempotency_key: "agentbadge-209-6-paid-synthesis-v1",
  objective: REAL_OBJ,
  acceptance_criteria: REAL_CRITERIA,
  max_budget_minor: "3500000",
  deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  required_capabilities: ["technical-writing", "article-writing"],
};
const r = await mcpCall(
  "https://live-sasame.sasame.online/mcp", "tools/call",
  { name: "gec_demand_create", arguments: REAL_ARGS }, { ...auth, allowRetry: true });
console.log("=== gec_demand_create:", JSON.stringify(redact(r.result ?? r.error)).slice(0, 4000));

// Status read-back on the created demand — learn its state + next actions.
const NEW_DEMAND = "demand:0f9572451f00aefe8933aff747ca3bae";
const st = await sasameRun(t, auth, buildSasameRunArgs({
  goal: `Read-only: report the current lifecycle state and eligible actions for demand ${NEW_DEMAND}.`,
  action: "status", demandId: NEW_DEMAND, projectId: PROJECT,
  executionMode: "plan_only",
}), "probe-newdemand-status");
console.log("=== new demand status:", JSON.stringify(redact(st)).slice(0, 3000));

// The demand is OPEN but public_recruitment=false — find the listing rail.
const MORE_TOOLS = [
  "gec_demand_publish", "gec_demand_open", "gec_demand_update",
  "gec_demand_recruit", "gec_demand_list", "demand_recruit",
  "gec_demand_enable_recruitment", "gec_demand_set_visibility",
];
for (const name of MORE_TOOLS) {
  try {
    const r2 = await mcpCall(
      "https://live-sasame.sasame.online/mcp", "tools/call",
      { name, arguments: {} }, { ...auth, allowRetry: true });
    const txt = JSON.stringify(r2.result ?? r2.error);
    const exists = !/tool.*not.*found/i.test(txt);
    console.log(`tool=${name}: ${exists ? "EXISTS" : "missing"} — ${txt.slice(0, 220)}`);
  } catch (e) {
    console.log(`tool=${name}: threw ${String(e).slice(0, 150)}`);
  }
}

// Does gec_demand_create accept a public_recruitment flag? Same idempotency
// key — replay-safe (either updates or duplicates:false).
const r3 = await mcpCall(
  "https://live-sasame.sasame.online/mcp", "tools/call",
  {
    name: "gec_demand_create", arguments: {
      ...REAL_ARGS, public_recruitment: true
    }
  },
  { ...auth, allowRetry: true });
console.log("=== create+recruit flag:", JSON.stringify(redact(r3.result ?? r3.error)).slice(0, 2500));

// gec_demand_idempotency_conflict confirmed (same key + different args) —
// no public_recruitment flag on create. Try the concierge publish action on
// the existing demand — likely the public-recruitment step.
const r4 = await sasameRun(t, auth, buildSasameRunArgs({
  goal: "Publish the drafted Demand so external providers can bid on it. Deadline is T+7d from now.",
  action: "publish", demandId: NEW_DEMAND, projectId: PROJECT,
  deadline, confirmed: true, acquisitionChannel: "OTHER_AGENT",
  executionMode: "auto",
}), "probe-publish-existing");
console.log("=== publish existing:", JSON.stringify(redact(r4)).slice(0, 3000));

// gec_demand_publication_set {demand_id, public_recruitment} — enable public
// listing on the new demand.
const pub = await mcpCall(
  "https://live-sasame.sasame.online/mcp", "tools/call",
  {
    name: "gec_demand_publication_set", arguments: {
      demand_id: NEW_DEMAND, public_recruitment: true
    }
  },
  { ...auth, allowRetry: true });
console.log("=== publication_set:", JSON.stringify(redact(pub.result ?? pub.error)).slice(0, 2000));

// Schema strictness probe: bogus field with the same key — "unrecognized key"
// means strict validation (public_recruitment was a real field); conflict
// means loose hashing of unknown fields.
const r5 = await mcpCall(
  "https://live-sasame.sasame.online/mcp", "tools/call",
  {
    name: "gec_demand_create", arguments: {
      ...REAL_ARGS, zz_probe_field: 1
    }
  },
  { ...auth, allowRetry: true });
console.log("=== strictness probe:", JSON.stringify(redact(r5.result ?? r5.error)).slice(0, 1200));

const outIdx = process.argv.indexOf("--out");
writeFileSync(outIdx >= 0 ? process.argv[outIdx + 1] : "/tmp/209-6-probe.json", t.toJSON());
