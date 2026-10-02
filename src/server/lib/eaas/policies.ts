/**
 * SLICE-154-1: named policy packs — the single VerifyFn callback from
 * packages/circle-payments/escrow/evaluator.ts grown into a registry.
 *
 * Each policy takes a DeliverableInput and returns {pass, reason, evidence};
 * index.ts turns the result into a signed VerdictArtifact. Unknown policy
 * names throw UnknownPolicyError — the route layer (SLICE-154-2) maps it
 * to HTTP 400.
 *
 * The scanner dep is injectable (createPolicyRegistry) so tests stay
 * runner-agnostic — no module mocking required.
 */
import type { Hex } from "viem";
import { scanDomain } from "../../../agent-readiness/scanner/orchestrator/scan";
import type { SourceState } from "../../../agent-readiness/scanner/source-state";
import { hashDeliverable } from "./verdict";

export interface DeliverableInput {
  /** Arbitrary payload — canonical-JSON-hashed into deliverableHash. */
  deliverable: unknown;
  /** Target URL for the readiness-scan policy. */
  deliverableUri?: string;
  /** Commitment hash for hash-match (private jobs, EPIC-153). */
  expectedHash?: Hex;
  /** Requesting consumer wallet — recorded for billing/limits (154-2/154-5). */
  consumerWallet?: string;
}

export interface PolicyResult {
  pass: boolean;
  reason: string;
  evidence?: unknown;
}

export type PolicyFn = (input: DeliverableInput) => Promise<PolicyResult>;

/** Thrown for unregistered policy names; route layer maps to 400. */
export class UnknownPolicyError extends Error {
  constructor(public readonly policy: string) {
    super(`Unknown policy: ${policy}`);
    this.name = "UnknownPolicyError";
  }
}

/** readiness-scan bound — verdicts must stay cheap and predictable. */
export const READINESS_SCAN_TIMEOUT_MS = 60_000;

export interface PolicyDeps {
  /** Default: the real agent-readiness scanner. */
  scan?: (url: string) => Promise<SourceState>;
  /** Per-scan bound (default READINESS_SCAN_TIMEOUT_MS). */
  scanTimeoutMs?: number;
}

/** Race a promise against a timeout; exported for direct unit testing. */
export function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms),
    ),
  ]);
}

function deliverablePresent(input: DeliverableInput): Promise<PolicyResult> {
  // Parity with evaluator.ts defaultVerify: present = non-null payload.
  const present = input.deliverable !== undefined && input.deliverable !== null;
  return Promise.resolve(
    present
      ? { pass: true, reason: "deliverable present" }
      : { pass: false, reason: "deliverable absent" },
  );
}

function hashMatch(input: DeliverableInput): Promise<PolicyResult> {
  if (!input.expectedHash) {
    return Promise.resolve({
      pass: false,
      reason: "hash-match: expectedHash required",
    });
  }
  const actual = hashDeliverable(input.deliverable);
  const pass = actual === input.expectedHash;
  return Promise.resolve({
    pass,
    reason: pass
      ? "deliverable hash matches commitment"
      : "deliverable hash mismatch",
    evidence: { expected: input.expectedHash, actual },
  });
}

function readinessScan(deps: Required<PolicyDeps>): PolicyFn {
  return async (input) => {
    if (!input.deliverableUri) {
      return { pass: false, reason: "readiness-scan: deliverableUri required" };
    }
    try {
      const state = await withTimeout(
        deps.scan(input.deliverableUri),
        deps.scanTimeoutMs,
        "readiness-scan",
      );
      // Scanner hardening (EPIC-85): SSRF DNS pinning + redirect caps are
      // inside the resource loader — scanDomain never escapes that bound.
      const snapshots = state.snapshots ?? {};
      const fetched = Object.values(snapshots).filter((s) => s !== null).length;
      const pass = fetched >= 1;
      return {
        pass,
        reason: pass
          ? `readiness-scan completed: ${fetched} resources fetched`
          : "readiness-scan produced no resources",
        evidence: {
          url: input.deliverableUri,
          domain: state.domain,
          scannedAt: state.scannedAt,
          resourcesTotal: Object.keys(snapshots).length,
          resourcesFetched: fetched,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { pass: false, reason: `readiness-scan failed: ${msg}` };
    }
  };
}

/**
 * Registry factory — dependencies injectable for tests. The exported
 * POLICY_REGISTRY singleton wires the real scanner.
 */
export function createPolicyRegistry(
  deps: PolicyDeps = {},
): Record<string, PolicyFn> {
  const resolved: Required<PolicyDeps> = {
    scan: deps.scan ?? ((url: string) => scanDomain(url)),
    scanTimeoutMs: deps.scanTimeoutMs ?? READINESS_SCAN_TIMEOUT_MS,
  };
  return {
    "deliverable-present": deliverablePresent,
    "hash-match": hashMatch,
    "readiness-scan": readinessScan(resolved),
  };
}

export const POLICY_REGISTRY: Record<string, PolicyFn> =
  createPolicyRegistry();

export function getPolicy(
  name: string,
  registry: Record<string, PolicyFn> = POLICY_REGISTRY,
): PolicyFn {
  const fn = registry[name];
  if (!fn) throw new UnknownPolicyError(name);
  return fn;
}
