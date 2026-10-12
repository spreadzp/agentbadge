/**
 * SLICE-197-09: isolated subprocess layer for the QA runner.
 *
 * Untrusted code (agent-submitted sha) runs in a scrubbed env:
 * whitelist-only variables, HOME/TMPDIR pointed at the scratch dir,
 * git prompts and host config disabled, NO server secrets. Every
 * command is execFile'd (no shell) with a hard timeout + SIGKILL.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  error?: string;
}

const MAX_BUFFER = 8 * 1024 * 1024;
const DEFAULT_CMD_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Whitelist env for runner subprocesses. Anything not listed is gone
 * — API keys, tokens, SSH agent, git credentials, npm auth.
 */
export function runnerEnv(scratchDir: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/local/bin",
    HOME: scratchDir,
    TMPDIR: scratchDir,
    CI: "true",
    LANG: "C.UTF-8",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    NPM_CONFIG_CACHE: join(scratchDir, ".npm"),
    npm_config_loglevel: "error",
    PIP_NO_INPUT: "1",
  };
}

/** Run one command; timeout → SIGKILL, marked `timedOut`. */
export function execCmd(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string>; timeoutMs?: number },
): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        env: opts.env,
        timeout: opts.timeoutMs ?? DEFAULT_CMD_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        const timedOut =
          Boolean(error) && (error as { killed?: boolean }).killed === true;
        resolve({
          code: typeof error?.code === "number" ? error.code
            : error ? null : 0,
          stdout: String(stdout).slice(-32_000),
          stderr: String(stderr).slice(-16_000),
          timedOut,
          error: error ? String(error.message ?? error).slice(0, 300)
            : undefined,
        });
      },
    );
  });
}

export function makeScratchDir(prefix = "bounty-qa-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function cleanupScratchDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

/** Repo URL from a github PR url (https://github.com/o/r/pull/N). */
export function repoFromPrUrl(
  prUrl: string,
): { owner: string; repo: string; pull: number; gitUrl: string } | null {
  const m = prUrl.match(
    /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/,
  );
  if (!m) return null;
  const repo = m[2].replace(/\.git$/, "");
  return {
    owner: m[1],
    repo,
    pull: Number(m[3]),
    gitUrl: `https://github.com/${m[1]}/${repo}.git`,
  };
}

/** Shallow-fetch exactly `sha` and check it out (init→fetch→checkout). */
export async function checkoutSha(
  repoUrl: string,
  sha: string,
  workdir: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<RunResult> {
  const steps: [string, string[]][] = [
    ["git", ["init", "-q"]],
    ["git", ["remote", "add", "origin", repoUrl]],
    ["git", ["fetch", "--depth", "1", "origin", sha]],
    ["git", ["checkout", "-q", "FETCH_HEAD"]],
  ];
  let last: RunResult = { code: 0, stdout: "", stderr: "" };
  for (const [cmd, args] of steps) {
    last = await execCmd(cmd, args, { cwd: workdir, env, timeoutMs });
    if (last.timedOut || (last.code ?? 1) !== 0) return last;
  }
  return last;
}

/** Pick package manager by lockfile (pnpm > yarn > bun > npm). */
export function detectPm(dir: string): "pnpm" | "yarn" | "bun" | "npm" {
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(dir, "yarn.lock"))) return "yarn";
  if (existsSync(join(dir, "bun.lockb")) || existsSync(join(dir, "bun.lock")))
    return "bun";
  return "npm";
}

export function pmInstallCmd(pm: string): [string, string[]] {
  switch (pm) {
    case "pnpm":
      return ["pnpm", ["install", "--frozen-lockfile"]];
    case "yarn":
      return ["yarn", ["install", "--frozen-lockfile"]];
    case "bun":
      return ["bun", ["install"]];
    default:
      return ["npm", ["ci", "--ignore-scripts"]];
  }
}

export function pmRunCmd(pm: string, script: string): [string, string[]] {
  return pm === "npm" ? ["npm", ["run", script]] : [pm, ["run", script]];
}

// ─── Full isolated check pipeline ──────────────────────────────

export interface QaCheck {
  name: string;
  ok: boolean;
  /** "pass" | "fail" | "skipped" (script absent) | "timeout". */
  result: "pass" | "fail" | "skipped" | "timeout";
  detail?: string;
}

export interface CheckCtx {
  prUrl: string;
  commitSha: string;
  workdir: string;
}

const QA_SCRIPTS: readonly string[] = ["build", "test", "lint"];

/**
 * checkout sha → install → run {build,test,lint} scripts present in
 * package.json. First failure short-circuits with a reason code;
 * timeout on any step → `qa_timeout`. Everything runs under
 * runnerEnv — no server secrets, no host git/npm config.
 */
export async function runIsolatedChecks(
  ctx: CheckCtx,
  timeoutMs: number,
): Promise<{ checks: QaCheck[]; reasonCodes: string[] }> {
  const env = runnerEnv(ctx.workdir);
  const checks: QaCheck[] = [];
  const reasonCodes: string[] = [];
  const repo = repoFromPrUrl(ctx.prUrl);
  if (!repo) {
    return {
      checks: [{ name: "pr_url", ok: false, result: "fail" }],
      reasonCodes: ["bad_pr_url"],
    };
  }

  const fail = (name: string, code: string, r?: RunResult): void => {
    reasonCodes.push(code);
    checks.push({
      name,
      ok: false,
      result: r?.timedOut ? "timeout" : "fail",
      detail: r?.error ?? r?.stderr.slice(0, 200),
    });
  };

  const co = await checkoutSha(repo.gitUrl, ctx.commitSha, ctx.workdir,
    env, timeoutMs);
  if (co.timedOut || (co.code ?? 1) !== 0) {
    fail("checkout", co.timedOut ? "qa_timeout" : "qa_checkout_failed",
      co);
    return { checks, reasonCodes };
  }
  checks.push({ name: "checkout", ok: true, result: "pass" });

  let scripts: Record<string, string> = {};
  try {
    const pkg = JSON.parse(
      readFileSync(join(ctx.workdir, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    scripts = pkg.scripts ?? {};
  } catch {
    fail("package.json", "qa_no_package");
    return { checks, reasonCodes };
  }

  const pm = detectPm(ctx.workdir);
  const [iCmd, iArgs] = pmInstallCmd(pm);
  const inst = await execCmd(iCmd, iArgs, {
    cwd: ctx.workdir, env, timeoutMs,
  });
  if (inst.timedOut || (inst.code ?? 1) !== 0) {
    fail("install", inst.timedOut ? "qa_timeout" : "qa_install_failed",
      inst);
    return { checks, reasonCodes };
  }
  checks.push({ name: "install", ok: true, result: "pass" });

  for (const script of QA_SCRIPTS) {
    if (!scripts[script]) {
      checks.push({
        name: script, ok: true, result: "skipped",
        detail: "script absent",
      });
      continue;
    }
    const [cmd, args] = pmRunCmd(pm, script);
    const r = await execCmd(cmd, args, { cwd: ctx.workdir, env, timeoutMs });
    if (r.timedOut || (r.code ?? 1) !== 0) {
      fail(script, r.timedOut ? "qa_timeout" : `qa_${script}_failed`, r);
      return { checks, reasonCodes };
    }
    checks.push({ name: script, ok: true, result: "pass" });
  }
  return { checks, reasonCodes };
}
