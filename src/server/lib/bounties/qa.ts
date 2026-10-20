/**
 * SLICE-197-09: bounty QA — deterministic verdict (Q10).
 *
 * verify sha ∈ PR (GitHub API) → isolated pipeline (checkout sha →
 * install → build → test → lint, see qa-run.ts) → verdict-fact →
 * bounty_outcome (pass|fail + reason_codes) + bounty
 * submitted→passed|failed.
 *
 * Isolation (spec): all repo work runs in a scratch dir under
 * runnerEnv() — whitelist env, no server secrets, no git/npm host
 * config, execFile without shell, hard timeout per step.
 * GITHUB token (if configured) is used ONLY for the PR-membership
 * API call — it never reaches runnerEnv.
 *
 * Onchain anchoring is 197-10; payout release is 197-12.
 */
import { logger } from "@agentbadge/passport/logger";

import {
  appendTransition,
  bountyStoreReady,
  getClaim,
  getOutcome,
  listBounties,
  putOutcome,
  upsertBounty,
  type BountyRecord,
} from "./store";
import { assertBountyTransition } from "./lifecycle";
import type { SubmitPayload } from "./submit";
import {
  cleanupScratchDir,
  makeScratchDir,
  repoFromPrUrl,
  runIsolatedChecks,
  type CheckCtx,
  type QaCheck,
} from "./qa-run";

export type { QaCheck } from "./qa-run";

// ─── Config ────────────────────────────────────────────────────

export const QA_CMD_TIMEOUT_MS = () =>
  Number(process.env.BOUNTY_QA_CMD_TIMEOUT_MS ?? 10 * 60 * 1000);

// ─── Types ─────────────────────────────────────────────────────

export interface QaVerdict {
  verdict: "pass" | "fail";
  reasonCodes: string[];
  checks: QaCheck[];
  durationMs: number;
  commitSha: string;
  prUrl: string;
}

export interface QaDeps {
  now?: () => number;
  /** List commit shas on the PR (sha ∈ PR check). */
  fetchPrCommits?: (pr: {
    owner: string;
    repo: string;
    pull: number;
  }) => Promise<string[] | null>;
  /** Override the whole checkout+checks pipeline (tests). */
  runChecks?: (
    ctx: CheckCtx,
  ) => Promise<{ checks: QaCheck[]; reasonCodes: string[] }>;
  workdirRoot?: () => string;
  timeoutMs?: number;
}

// ─── sha ∈ PR (GitHub API) ─────────────────────────────────────

async function defaultFetchPrCommits(pr: {
  owner: string;
  repo: string;
  pull: number;
}): Promise<string[] | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "agentbadge-qa-runner",
  };
  const token =
    process.env.BOUNTY_QA_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${pr.owner}/${pr.repo}` +
        `/pulls/${pr.pull}/commits?per_page=100`,
      { headers, signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { sha?: string }[];
    return rows.map((r) => String(r.sha ?? ""));
  } catch {
    return null;
  }
}

// ─── Verdict ───────────────────────────────────────────────────

function finish(deps: QaDeps, started: number, v: QaVerdict): QaVerdict {
  return { ...v, durationMs: v.durationMs ||
    Math.max(0, (deps.now ?? Date.now)() - started) };
}

export async function evaluateBountyQa(
  bounty: BountyRecord,
  deps: QaDeps = {},
): Promise<QaVerdict | null> {
  const now = deps.now ?? Date.now;
  const started = now();
  const claim = getClaim(bounty.bountyId, bounty.jobAttempt);
  const sub = claim?.payload?.submission as SubmitPayload | undefined;
  if (!claim || !sub) {
    logger.warn("qa: submitted bounty without submission payload", {
      bountyId: bounty.bountyId,
    });
    return null;
  }
  const pr = repoFromPrUrl(sub.prUrl);

  // 1) sha ∈ PR (GitHub API — credentials never reach runner env).
  const fetchCommits = deps.fetchPrCommits ?? defaultFetchPrCommits;
  const prCommits = pr ? await fetchCommits(pr) : null;
  if (!pr || prCommits === null) {
    return finish(deps, started, {
      verdict: "fail",
      reasonCodes: ["pr_unreadable"],
      checks: [{ name: "pr_api", ok: false, result: "fail" }],
      durationMs: 0,
      commitSha: sub.commitSha,
      prUrl: sub.prUrl,
    });
  }
  const sha = sub.commitSha.toLowerCase().replace(/^0x/, "");
  const inPr = prCommits.some(
    (c) => c.toLowerCase().startsWith(sha) ||
      sha.startsWith(c.toLowerCase()),
  );
  if (!inPr) {
    return finish(deps, started, {
      verdict: "fail",
      reasonCodes: ["sha_not_in_pr"],
      checks: [{ name: "sha_in_pr", ok: false, result: "fail" }],
      durationMs: 0,
      commitSha: sub.commitSha,
      prUrl: sub.prUrl,
    });
  }

  // 2) Isolated pipeline.
  const workdir = deps.workdirRoot?.() ??
    makeScratchDir(`bounty-qa-${bounty.bountyId}-`);
  const runChecks = deps.runChecks ??
    ((ctx: CheckCtx) =>
      runIsolatedChecks(ctx, deps.timeoutMs ?? QA_CMD_TIMEOUT_MS()));
  let outcome: { checks: QaCheck[]; reasonCodes: string[] };
  try {
    outcome = await runChecks({
      prUrl: sub.prUrl,
      commitSha: sub.commitSha,
      workdir,
    });
  } catch (err) {
    outcome = {
      checks: [{ name: "pipeline", ok: false, result: "fail",
        detail: String(err).slice(0, 200) }],
      reasonCodes: ["qa_error"],
    };
  } finally {
    if (!deps.workdirRoot) cleanupScratchDir(workdir);
  }
  return finish(deps, started, {
    verdict: outcome.reasonCodes.length === 0 ? "pass" : "fail",
    reasonCodes: outcome.reasonCodes,
    checks: [{ name: "sha_in_pr", ok: true, result: "pass" },
      ...outcome.checks],
    durationMs: Math.max(0, now() - started),
    commitSha: sub.commitSha,
    prUrl: sub.prUrl,
  });
}

/** Record verdict-fact: outcome + submitted→passed|failed (idempotent). */
export function recordQaVerdict(
  bounty: BountyRecord,
  v: QaVerdict,
  now: number,
): void {
  const claim = getClaim(bounty.bountyId, bounty.jobAttempt);
  if (getOutcome(bounty.bountyId, bounty.jobAttempt)) return;
  putOutcome({
    id: `${bounty.bountyId}:${bounty.jobAttempt}`,
    bountyId: bounty.bountyId,
    jobAttempt: bounty.jobAttempt,
    passportId: claim?.passportId,
    verdict: v.verdict,
    reasonCodes: v.reasonCodes,
    commitSha: v.commitSha,
    payload: {
      checks: v.checks as unknown as Record<string, unknown>[],
      durationMs: v.durationMs,
      prUrl: v.prUrl,
      source: "qa-runner",
    },
  });
  const action = v.verdict === "pass" ? "pass" : "fail";
  if (assertBountyTransition(bounty.status, action).ok) {
    upsertBounty({
      ...bounty,
      status: v.verdict === "pass" ? "passed" : "failed",
    });
    appendTransition({
      id: `${bounty.bountyId}:${bounty.jobAttempt}:${action}:${now}`,
      bountyId: bounty.bountyId,
      actor: "evaluator",
      from: "submitted",
      to: v.verdict === "pass" ? "passed" : "failed",
      reason: v.reasonCodes.join(",") || undefined,
      atMs: now,
      payload: { reasonCodes: v.reasonCodes, durationMs: v.durationMs },
    });
  }
}

// ─── Sweep ─────────────────────────────────────────────────────

export interface QaSweepResult {
  evaluated: number;
  passed: number;
  failed: number;
  skipped?: boolean;
  errors: string[];
}

export async function qaSweep(
  deps: QaDeps & { enabled?: boolean } = {},
): Promise<QaSweepResult> {
  const enabled =
    deps.enabled ?? process.env.BOUNTY_QA_RUNNER_ENABLED === "true";
  if (!enabled) {
    return { evaluated: 0, passed: 0, failed: 0,
      skipped: true, errors: [] };
  }
  await bountyStoreReady();
  const now = deps.now ?? Date.now;
  const res: QaSweepResult = {
    evaluated: 0, passed: 0, failed: 0, errors: [],
  };
  for (const b of listBounties({ status: "submitted" })) {
    if (getOutcome(b.bountyId, b.jobAttempt)) continue;
    try {
      const verdict = await evaluateBountyQa(b, deps);
      if (!verdict) continue;
      recordQaVerdict(b, verdict, now());
      res.evaluated++;
      if (verdict.verdict === "pass") res.passed++;
      else res.failed++;
    } catch (err) {
      res.errors.push(`${b.bountyId}: ${String(err).slice(0, 120)}`);
    }
  }
  return res;
}
