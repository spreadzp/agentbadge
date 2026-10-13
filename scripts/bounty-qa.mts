/**
 * SLICE-197-18: standalone QA agent over the PUBLIC API only — no
 * imports from src/**. Two modes:
 *
 *   POLL (default): GET /api/bounties?status=submitted → print the
 *     bountyIds awaiting review.
 *   RUN: BOUNTY_ID + PR_URL + COMMIT_SHA provided → clone the repo
 *     at the pinned SHA in a scratch dir with a scrubbed env, install
 *     with --ignore-scripts, run the declared check commands, and
 *     print a verdict JSON compatible with the 197-09 runner:
 *       {bountyId, verdict:"pass"|"fail", reasonCodes[], commitSha,
 *        checks:[{name,ok,log}…]}
 *
 * Verdict rules (mirrors qa-run):
 *   - checkout fails            → fail, ["checkout_failed"]
 *   - install fails             → fail, ["install_failed"]
 *   - every check ok            → pass, []
 *   - any check fails           → fail, ["check_failed:<name>"]
 *
 * Env:
 *   ENDPOINT=http://localhost:4021
 *   AGENT_API_KEY=agb_...           — required (passport ctx)
 *   BOUNTY_ID / PR_URL / COMMIT_SHA — RUN mode inputs
 *   QA_CHECKS="test,lint"           — package.json scripts to run
 *                                     (default: "test")
 *   KEEP_SCRATCH=1                  — keep the clone for inspection
 *
 * Usage:
 *   bun run scripts/bounty-qa.mts                      # poll mode
 *   BOUNTY_ID=bty_x PR_URL=https://github.com/o/r/pull/1 \
 *     COMMIT_SHA=<40-hex> bun run scripts/bounty-qa.mts
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENDPOINT = process.env.ENDPOINT ?? "http://localhost:4021";
const API_KEY = process.env.AGENT_API_KEY;
const BOUNTY_ID = process.env.BOUNTY_ID;
const PR_URL = process.env.PR_URL;
const COMMIT_SHA = process.env.COMMIT_SHA;
const QA_CHECKS = (process.env.QA_CHECKS ?? "test").split(",");
const TIMEOUT_MS = 120_000;

if (!API_KEY) {
  console.error("Missing AGENT_API_KEY (agb_...)");
  process.exit(1);
}

type Verdict = {
  bountyId: string;
  verdict: "pass" | "fail";
  reasonCodes: string[];
  commitSha?: string;
  checks: { name: string; ok: boolean; log: string }[];
};

function emit(v: Verdict): never {
  console.log(JSON.stringify(v, null, 2));
  process.exit(v.verdict === "pass" ? 0 : 2);
}

/** Scrubbed env for the untrusted workspace — mirrors runnerEnv. */
function scrubbedEnv(dir: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: dir,
    CI: "1",
    NODE_ENV: "test",
    npm_config_ignore_scripts: "true",
  };
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
): { ok: boolean; log: string } {
  try {
    const out = execFileSync(cmd, args, {
      cwd,
      env: scrubbedEnv(cwd),
      timeout: TIMEOUT_MS,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, log: out.slice(-2000) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return {
      ok: false,
      log: `${err.stdout ?? ""}\n${err.stderr ?? ""}`.slice(-2000),
    };
  }
}

function repoUrlFromPr(prUrl: string): string | null {
  const m = /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/.exec(
    prUrl,
  );
  return m ? `https://github.com/${m[1]}.git` : null;
}

function detectPm(dir: string): string {
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(dir, "yarn.lock"))) return "yarn";
  if (existsSync(join(dir, "bun.lockb"))) return "bun";
  return "npm";
}

function installCmd(pm: string): [string, string[]] {
  // 197-16 H-4 parity: lifecycle scripts never run in QA.
  switch (pm) {
    case "pnpm":
      return ["pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"]];
    case "yarn":
      return ["yarn", ["install", "--frozen-lockfile", "--ignore-scripts"]];
    case "bun":
      return ["bun", ["install", "--ignore-scripts"]];
    default:
      return ["npm", ["ci", "--ignore-scripts"]];
  }
}

function pmRun(pm: string, script: string): [string, string[]] {
  return [pm, ["run", script]];
}

// ─── POLL mode ───────────────────────────────────────────────────
if (!BOUNTY_ID || !PR_URL || !COMMIT_SHA) {
  const res = await fetch(
    `${ENDPOINT}/api/bounties?status=submitted`,
    { headers: { authorization: `Bearer ${API_KEY}` } },
  );
  const body = (await res.json()) as { bounties?: { bountyId: string }[] };
  const ids = (body.bounties ?? []).map((b) => b.bountyId);
  console.log(
    ids.length
      ? `awaiting QA: ${ids.join(", ")}`
      : "no submitted bounties",
  );
  process.exit(0);
}

// ─── RUN mode ────────────────────────────────────────────────────
const repo = repoUrlFromPr(PR_URL);
if (!repo) {
  emit({
    bountyId: BOUNTY_ID,
    verdict: "fail",
    reasonCodes: ["bad_pr_url"],
    commitSha: COMMIT_SHA,
    checks: [],
  });
}

const dir = mkdtempSync(join(tmpdir(), "bounty-qa-"));
const checks: Verdict["checks"] = [];
const reasonCodes: string[] = [];
try {
  const clone = run("git", ["clone", "--depth", "50", repo, dir],
    tmpdir());
  if (!clone.ok) {
    checks.push({ name: "clone", ok: false, log: clone.log });
    emit({ bountyId: BOUNTY_ID, verdict: "fail",
      reasonCodes: ["checkout_failed"], commitSha: COMMIT_SHA, checks });
  }

  const co = run("git", ["checkout", COMMIT_SHA], dir);
  if (!co.ok) {
    checks.push({ name: "checkout", ok: false, log: co.log });
    emit({ bountyId: BOUNTY_ID, verdict: "fail",
      reasonCodes: ["checkout_failed"], commitSha: COMMIT_SHA, checks });
  }

  const pm = detectPm(dir);
  const [ic, ia] = installCmd(pm);
  const inst = run(ic, ia, dir);
  if (!inst.ok) {
    checks.push({ name: `install:${pm}`, ok: false, log: inst.log });
    emit({ bountyId: BOUNTY_ID, verdict: "fail",
      reasonCodes: ["install_failed"], commitSha: COMMIT_SHA, checks });
  }
  checks.push({ name: `install:${pm}`, ok: true, log: inst.log });

  const pkg = JSON.parse(
    readFileSync(join(dir, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  for (const name of QA_CHECKS) {
    if (!pkg.scripts?.[name]) {
      checks.push({ name, ok: false, log: "script missing" });
      reasonCodes.push(`check_failed:${name}`);
      continue;
    }
    const [rc, ra] = pmRun(pm, name);
    const r = run(rc, ra, dir);
    checks.push({ name, ok: r.ok, log: r.log });
    if (!r.ok) reasonCodes.push(`check_failed:${name}`);
  }
} finally {
  if (!process.env.KEEP_SCRATCH) {
    rmSync(dir, { recursive: true, force: true });
  } else {
    console.error(`scratch kept: ${dir}`);
  }
}

emit({
  bountyId: BOUNTY_ID,
  verdict: reasonCodes.length ? "fail" : "pass",
  reasonCodes,
  commitSha: COMMIT_SHA,
  checks,
});
