/**
 * 209-7 step 1: read-only bid review for the article demand.
 * Finds the right rail (gec_bid_list or sasame_run browse) and dumps bids.
 * Usage: bun run scripts/gec-209-bids.mts
 */
import { writeFileSync } from "node:fs";
import {
  Transcript, buyerSession, sasameRun, redact, mcpCall,
} from "./gec-interop.mts";

const KEEP = "demand:0f9572451f00aefe8933aff747ca3bae";
const PROJECT = "project:b05860d6503d9a496f97d5cb3e5aca06";
const EP = "https://live-sasame.sasame.online/mcp";

const t = new Transcript();
const auth = await buyerSession(t);

// Discover bid-related tools in the new schema.
const tools = await mcpCall(EP, "tools/list", {}, { ...auth, allowRetry: false });
const names = ((tools.result as { tools?: Array<{ name: string }> }).tools ?? [])
  .map((x) => x.name);
console.log("=== bid/award tools:", names.filter((n) => /bid|award/i.test(n)));

for (const name of ["gec_bid_list", "gec_bid_list_for_demand", "gec_demand_bids"]) {
  if (!names.includes(name)) continue;
  const r = await mcpCall(EP, "tools/call",
    { name, arguments: { demand_id: KEEP } }, { ...auth, allowRetry: true });
  console.log(`=== ${name}:`, JSON.stringify(r.result ?? r.error).slice(0, 4000));
}

// Fallback/primary: sasame_run browse on the demand.
const st = await sasameRun(t, auth, {
  goal: `Read-only: list all bids on demand ${KEEP} — provider identity, price, terms, ETA.`,
  execution_mode: "plan_only",
  context: { gec: { role: "buyer", action: "browse", demand_id: KEEP, project_id: PROJECT } },
}, "bid-list-browse");
console.log("=== browse bids:", JSON.stringify(redact(st)).slice(0, 5000));

writeFileSync("/tmp/209-7-bid-list.json", t.toJSON());
console.log("=== transcript saved: /tmp/209-7-bid-list.json");
