/**
 * 209-7 read-only: lifecycle/award/settlement state for the article demand.
 * Usage: bun run scripts/gec-209-award-status.mts
 */
import { writeFileSync } from "node:fs";
import { Transcript, buyerSession, sasameRun, redact } from "./gec-interop.mts";

const KEEP = "demand:0f9572451f00aefe8933aff747ca3bae";

const t = new Transcript();
const auth = await buyerSession(t);
const st = await sasameRun(t, auth, {
  goal: `Read-only: report lifecycle, award and settlement state for demand ${KEEP}.`,
  execution_mode: "plan_only",
  context: { gec: { role: "buyer", action: "status", demand_id: KEEP } },
}, "award-status");
console.log("=== status:", JSON.stringify(redact(st)));

writeFileSync("/tmp/209-7-award-status.json", t.toJSON());
