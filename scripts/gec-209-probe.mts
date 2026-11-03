/**
 * 209-6 stray-demand probe: ask sasame (plan_only — never mutates) what
 * management actions exist for demand:f775142c140a725c5ef3bdc88fe4d845.
 * Usage: bun run scripts/gec-209-probe.mts [goal-variant]
 */
import { writeFileSync } from "node:fs";
import {
  Transcript, buyerSession, sasameRun, buildSasameRunArgs, redact,
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

const outIdx = process.argv.indexOf("--out");
writeFileSync(outIdx >= 0 ? process.argv[outIdx + 1] : "/tmp/209-6-probe.json", t.toJSON());
