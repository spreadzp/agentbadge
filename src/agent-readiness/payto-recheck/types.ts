// SLICE-258-18: proof recheck / revocation vocabulary (D-258-Q20,
// D-258-Q26…Q29). Independent contract — the future reconcile watcher
// (258-20) imports this module without the scanner runtime.
// Pure: no IO, no clock, no scanner state. History is an INPUT
// (two reports + optional knownDropped), never module state.

import type { SignatureStatus } from "@agentbadge/x402-payto-proof";

export const RECHECK_SCHEMA_VERSION = 1;

/** One member of a published proof set — identity = payTo + source + scope. */
export interface ProofSetEntry {
  /** Payout address, normalized (0x lowercased, base58 preserved). */
  payTo: string;
  /** Proof tier this entry was proven on. */
  source: "dns" | "site";
  /**
   * Where the proof resolved: DNS hit-name (`_x402-payto.example.com`
   * vs `_x402-payto.api.example.com` — child vs parent) or the
   * well-known host for `site`. Part of identity (D-258-Q28): same
   * payTo under a different provenance is NOT the same proof.
   */
  scope_name: string;
  issued?: string;
  /** Signature verification status at observation time, when computed. */
  signature_status?: SignatureStatus;
}

/**
 * One observation of the proof SET (not the payment quotes — the
 * published set the quotes are checked against). Built by the caller
 * from a scan's proof inputs or a watcher probe.
 */
export interface ProofSetSnapshot {
  schema_version: number;
  /** Target domain the proof set binds to. */
  domain: string;
  /** When THIS snapshot was observed (UTC ISO-8601, C2/C11). */
  observed_at: string;
  /** DNS tier fetch state — `unchecked` means the tier could not
   *  be resolved this run (SERVFAIL/timeout/resolver disagreement). */
  dns_state: "ok" | "unchecked";
  /** Well-known tier fetch state. */
  site_state: "ok" | "absent" | "unchecked";
  /** DNS name the proof record resolved at, when hit. */
  dns_hit_name?: string | null;
  /** All parsed entries from BOTH tiers (pre-shadowing). */
  entries: ProofSetEntry[];
  /**
   * Caller-asserted confirmed absence: a full probe ran this run —
   * not a cache hit, resolvers agreed, bounded double-probe done.
   * The diff never INFERS confirmedness (D-258-Q27).
   */
  absence_confirmed?: boolean;
}

/** Transition classes — the ontology, exactly as decided (D-258-Q20). */
export type ProofTransitionKind =
  | "still_verified"
  | "still_absent"
  | "newly_proven"
  | "DROPPED"
  | "ROTATED"
  | "SCOPE_CHANGED"
  | "REAPPEARED"
  | "recheck_unchecked"
  | "CONFLICT";

export type TransitionSeverity = "none" | "info" | "medium";

export interface ProofTransition {
  kind: ProofTransitionKind;
  severity: TransitionSeverity;
  /** Subject payTo (normalized). */
  payTo: string;
  /** Full identity `source|scope_name|payTo` of the prev member. */
  identity?: string;
  /** prev.observed_at — when it was last observed proven. */
  previously_verified_at?: string;
  /** cur.observed_at — when this transition was observed. */
  currently_observed_at?: string;
  /** SCOPE_CHANGED: previous `source|scope_name`. */
  from_scope?: string;
  /** SCOPE_CHANGED: new `source|scope_name`. */
  to_scope?: string;
  /** ROTATED: the payTo that replaced this one, when known. */
  replaced_by?: string;
  /** ROTATED (new member): the payTo it replaced. */
  replaces?: string;
  /** Signature status of the added/current entry, when known
   *  (arc-review M7: unsigned and signed adds must not look identical). */
  signature_status?: SignatureStatus;
  /** Human-readable line, e.g. "was proven 2026-11-20, absent 2026-11-24". */
  note: string;
}

/** Alert-level summary of the whole diff (dominant class wins). */
export type RecheckSummary =
  | "stable"          // nothing meaningfully changed
  | "unchanged_info"  // only info-level transitions (newly_proven/REAPPEARED)
  | "unchecked"       // could not confirm — never a revocation
  | "changed"         // medium-severity transitions present
  ;

export type RecheckDiffResult =
  | {
      comparable: true;
      summary: RecheckSummary;
      transitions: ProofTransition[];
      prev_observed_at: string;
      cur_observed_at: string;
    }
  | {
      comparable: false;
      reason:
        | "domain_mismatch"
        | "schema_version_mismatch"
        | "time_order"
        | "invalid_report";
      detail?: string;
    };
