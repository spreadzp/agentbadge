/**
 * SLICE-206-5: verifier independence invariant + verdict transitions
 * (D-206-4 — nobody grades themselves, INDEPENDENT_AGENT pattern).
 *
 * Invariant on verdict_submit:
 *   verifier_wallet ≠ task owner identity   → 403 VERIFIER_IS_OWNER
 *   verifier_wallet ≠ task worker identity  → 403 VERIFIER_IS_WORKER
 *   verifier_wallet ≠ platform signer(s)    → 403 VERIFIER_IS_PLATFORM
 *     (a verdict signed by our own EaaS-signer would be decorative
 *     "independence" — rejected).
 *
 * Identity resolution: owner/worker come from task.posterDid /
 * task.claimerDid plus their directory-resolved Hedera accountIds.
 * On legacy HBAR tasks a DID can never equal an EVM wallet — the check
 * is then vacuous-but-correct (a foreign EVM agent literally cannot BE
 * the Hedera-DID owner). On wallet-shaped identities the check fires.
 *
 * Transitions (commit-semantics: transitional→final):
 *   PASS   → completing  (payment-path open; settle → completed + PAID)
 *   REVISE → claimed     (deliver-phase again; prior deliverable is
 *                         snapshotted into verificationReport history —
 *                         landmine: REVISE must not lose the submission)
 *   FAIL   → cancelled   (closed, no payout, reason recorded)
 *
 * This is the agent-level external-verifier gate, NOT a replacement of
 * EaaS verdicts — EaaS can be A verifier, just not the only one.
 */
import type { CachedMarketTask } from "@agentbadge/hedera-core";
import { get as getDirectoryEntry } from "@agentbadge/passport";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { opsKey, settleKey } from "../eaas/keys";
import { ErrorCodes, type ErrorCode } from "../error-codes";
import { evidenceRefsSchema, summarySchema } from "../contract-guards";

export const VERDICTS = ["PASS", "REVISE", "FAIL"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const verdictBodySchema = z.object({
  verdict: z.enum(VERDICTS),
  evidence_refs: evidenceRefsSchema.optional(),
  note: summarySchema.optional(),
});
export type VerdictBody = z.infer<typeof verdictBodySchema>;

// ─── Platform signer set ─────────────────────────────────────────

let _platformForTesting: string[] | null = null;
let _platformCache: string[] | null = null;

/** EOA addresses of our signing authorities (settle + ops). Null-safe. */
export function platformSignerAddresses(): string[] {
  if (_platformForTesting) return _platformForTesting;
  if (_platformCache) return _platformCache;
  const addrs: string[] = [];
  for (const key of [settleKey(), opsKey()]) {
    if (!key) continue;
    try {
      addrs.push(privateKeyToAccount(key).address.toLowerCase());
    } catch {
      /* malformed env key — skip, never crash a request path */
    }
  }
  _platformCache = addrs;
  return addrs;
}

/** Test seam — inject/reset the platform signer set. */
export function setPlatformSignersForTesting(addrs: string[] | null): void {
  _platformForTesting = addrs;
}

// ─── Independence check ──────────────────────────────────────────

/** Identity strings a task side resolves to (case-insensitive): the
 *  stored identity itself plus the directory's Hedera accountId.
 *  Exported for the award owner-check (206-6). */
export function identitySet(did: string | undefined): Set<string> {
  const s = new Set<string>();
  if (did) {
    s.add(did.toLowerCase());
    const accountId = getDirectoryEntry(did)?.accountId;
    if (accountId) s.add(accountId.toLowerCase());
  }
  return s;
}

export type VerifierViolation =
  | "VERIFIER_IS_OWNER"
  | "VERIFIER_IS_WORKER"
  | "VERIFIER_IS_PLATFORM";

export function checkVerifierIndependence(
  verifierWallet: string,
  task: CachedMarketTask,
  platformAddrs: readonly string[] = platformSignerAddresses(),
): VerifierViolation | null {
  const v = verifierWallet.toLowerCase();
  if (identitySet(task.posterDid).has(v)) return "VERIFIER_IS_OWNER";
  if (identitySet(task.claimerDid).has(v)) return "VERIFIER_IS_WORKER";
  if (platformAddrs.some((a) => a.toLowerCase() === v)) {
    return "VERIFIER_IS_PLATFORM";
  }
  return null;
}

// ─── Verdict application ─────────────────────────────────────────

interface VerdictLogEntry {
  verdict: Verdict;
  verifier: string;
  note?: string;
  evidence_refs?: string[];
  /** Snapshot of the deliverable under review — REVISE keeps history. */
  previous_result?: { resultBody?: string; resultIpfs?: string };
  at: string;
}

/** Append-only verdict log inside verificationReport (JSON lines). */
function appendVerdictLog(task: CachedMarketTask, entry: VerdictLogEntry): string {
  const prior = task.verificationReport?.trim();
  return prior ? `${prior}\n${JSON.stringify(entry)}` : JSON.stringify(entry);
}

export interface AppliedVerdict {
  status: CachedMarketTask["status"];
  extra: Partial<CachedMarketTask>;
}

export function applyVerdict(
  task: CachedMarketTask,
  body: VerdictBody,
  verifierWallet: string,
): AppliedVerdict {
  const log = appendVerdictLog(task, {
    verdict: body.verdict,
    verifier: verifierWallet.toLowerCase(),
    note: body.note,
    evidence_refs: body.evidence_refs,
    previous_result: {
      resultBody: task.resultBody,
      resultIpfs: task.resultIpfs,
    },
    at: new Date().toISOString(),
  });
  const attempts = (task.verificationAttempts ?? 0) + 1;

  switch (body.verdict) {
    case "PASS":
      // payment-path open — settle moves completing → completed (+PAID)
      return {
        status: "completing",
        extra: { verifierType: "external", verificationAttempts: attempts, verificationReport: log },
      };
    case "REVISE":
      // back to deliver-phase; worker keeps the task + sees the note
      return {
        status: "claimed",
        extra: { verifierType: "external", verificationAttempts: attempts, verificationReport: log },
      };
    case "FAIL":
      return {
        status: "cancelled",
        extra: {
          verifierType: "external",
          verificationAttempts: attempts,
          verificationReport: log,
          lastError: body.note ?? "verdict FAIL",
        },
      };
  }
}

/** Map violation → ErrorCode (typed narrow, avoids string drift). */
export function violationToErrorCode(v: VerifierViolation): ErrorCode {
  switch (v) {
    case "VERIFIER_IS_OWNER":
      return ErrorCodes.VERIFIER_IS_OWNER;
    case "VERIFIER_IS_WORKER":
      return ErrorCodes.VERIFIER_IS_WORKER;
    case "VERIFIER_IS_PLATFORM":
      return ErrorCodes.VERIFIER_IS_PLATFORM;
  }
}
