// agentbadge/scan-action — entry point. Reads INPUT_* env (GitHub
// Actions convention), calls the pure core, emits outputs + SARIF +
// annotations. No @actions/core dependency — the toolkit protocol is
// just env + files + stdout commands.
import { appendFileSync, writeFileSync } from "node:fs";
import { runAction } from "./core.mjs";

const input = {
  apiBase: process.env.INPUT_API_BASE || "https://agentbadge.xyz",
  siteKey: process.env.INPUT_SITE_KEY || "",
  siteId: process.env.INPUT_SITE_ID || undefined,
  scan: (process.env.INPUT_SCAN || "true") !== "false",
  failOn: process.env.INPUT_FAIL_ON || "new_finding",
  minScore: Number(process.env.INPUT_MIN_SCORE || "0"),
};

if (!input.siteKey) {
  console.log("::error::site_key input is required");
  process.exit(2);
}

const result = await runAction({ input });

const sarifFile = `${process.env.RUNNER_TEMP ?? "."}/agentbadge-intel.sarif`;
if (result.sarif) {
  writeFileSync(sarifFile, JSON.stringify(result.sarif, null, 2));
  console.log(`SARIF written to ${sarifFile} — upload with github/codeql-action/upload-sarif`);
}

for (const a of result.annotations ?? []) {
  console.log(`::${a.level}::${a.message}`);
}
console.log(result.summary);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    [
      `diff=${JSON.stringify(result.diff)}`,
      `sarif_file=${sarifFile}`,
      `mode=${result.diff?.mode ?? "error"}`,
      "",
    ].join("\n"),
  );
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`\`\`\n${result.summary}\n\`\`\`\n`);
}

process.exit(result.exitCode);
