import { toJsonSchema } from "@standard-community/standard-json";
import { agentReadinessReportSchema } from "../agent-readiness/report.schema";
import { agentReadinessRuleSchema } from "../agent-readiness/rule.schema";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const outputDir = join(
  dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "docs",
  "EPICS",
  "32-agent-readiness-spec",
  "spec",
  "schemas",
);

mkdirSync(outputDir, { recursive: true });

const reportJsonSchema = await toJsonSchema(agentReadinessReportSchema);
writeFileSync(
  join(outputDir, "agentbadge-report.schema.json"),
  JSON.stringify(reportJsonSchema, null, 2) + "\n",
);

const ruleJsonSchema = await toJsonSchema(agentReadinessRuleSchema);
writeFileSync(
  join(outputDir, "agentbadge-rule.schema.json"),
  JSON.stringify(ruleJsonSchema, null, 2) + "\n",
);

console.log("Generated JSON schemas:");
console.log(`  ${join(outputDir, "agentbadge-report.schema.json")}`);
console.log(`  ${join(outputDir, "agentbadge-rule.schema.json")}`);
