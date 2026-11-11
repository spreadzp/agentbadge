/**
 * 209-7 step 2: award SmallProof bid on the article demand.
 * Same protocol as cancel: plan_only+confirmed=false eligibility probe,
 * then auto+confirmed=true for the real award. Read-back after.
 * Usage: bun run scripts/gec-209-award.mts
 */
import { writeFileSync } from "node:fs";
import {
  Transcript, buyerSession, sasameRun, redact, mcpCall,
} from "./gec-interop.mts";

const KEEP = "demand:0f9572451f00aefe8933aff747ca3bae";
const BID = "bid:0f017bde832e5963d35f73bccd81563d";
const PROJECT = "project:b05860d6503d9a496f97d5cb3e5aca06";
const EP = "https://live-sasame.sasame.online/mcp";

const t = new Transcript();
const auth = await buyerSession(t);

// 0) Discover award rail: action enum + award-ish tools in new schema.
const tools = await mcpCall(EP, "tools/list", {}, { ...auth, allowRetry: false });
const list = (tools.result as { tools?: Array<{ name: string; inputSchema?: unknown }> }).tools ?? [];
const names = list.map((x) => x.name);
console.log("=== bid/award/select tools:", names.filter((n) => /bid|award|select|offer/i.test(n)));
const run = list.find((x) => x.name === "sasame_run");
const schema = JSON.stringify(run?.inputSchema ?? {});
const enumM = schema.match(/"action"[^}]*?enum[^[]*\[([^\]]+)\]/s);
console.log("=== sasame_run action enum:", enumM?.[1]?.replace(/\s+/g, "") ?? "not found");

// 1) plan_only eligibility probe — no mutation.
const probe = await mcpCall(EP, "tools/call", {
  name: "sasame_run",
  arguments: {
    goal: `Buyer awards demand ${KEEP} to bid ${BID} (SmallProof).`,
    execution_mode: "plan_only",
    context: { gec: { role: "buyer", action: "award", demand_id: KEEP, bid_id: BID, confirmed: false } },
  },
}, { ...auth, allowRetry: false });
const probeTxt = JSON.stringify(probe.result ?? probe.error);
console.log("=== plan_only award probe:", probeTxt.slice(0, 2500));

const blocked = /error|invalid|reject|not.?found/i.test(probeTxt);
if (blocked) {
  console.log("=== STOP: probe blocked — not running auto award");
} else {
  // 2) Real award.
  const r = await mcpCall(EP, "tools/call", {
    name: "sasame_run",
    arguments: {
      goal: `Buyer confirms award of demand ${KEEP} to bid ${BID} (SmallProof).`,
      execution_mode: "auto",
      context: { gec: { role: "buyer", action: "award", demand_id: KEEP, bid_id: BID, confirmed: true } },
    },
  }, { ...auth, allowRetry: false });
  console.log("=== auto award result:", JSON.stringify(r.result ?? r.error).slice(0, 3000));
}

// 3) Read-back demand status.
const st = await sasameRun(t, auth, {
  goal: `Read-only: report lifecycle, award and settlement state for demand ${KEEP}.`,
  execution_mode: "plan_only",
  context: { gec: { role: "buyer", action: "status", demand_id: KEEP, project_id: PROJECT } },
}, "status-article-after-award");
console.log("=== status article:", JSON.stringify(redact(st)).slice(0, 2500));

writeFileSync("/tmp/209-7-award.json", t.toJSON());
console.log("=== transcript saved: /tmp/209-7-award.json");
