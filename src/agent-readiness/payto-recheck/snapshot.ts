// SLICE-258-18: adapter — scan proof inputs → ProofSetSnapshot.
// Structural input (same field names as collectProofInputs output)
// so the reconcile watcher can build snapshots without the scanner.

import {
  normalizeAddress,
  verifyEntrySignature,
  type ProofEntry,
} from "@agentbadge/x402-payto-proof";
import {
  RECHECK_SCHEMA_VERSION,
  type ProofSetEntry,
  type ProofSetSnapshot,
} from "./types.js";

export interface ProofSnapshotSource {
  domain: string;
  dnsEntries: ProofEntry[];
  siteEntries: ProofEntry[];
  dnsState: "ok" | "unchecked";
  siteState: "ok" | "absent" | "unchecked";
  /** DNS name the record resolved at (child vs parent scope). */
  dnsHitName?: string | null;
  /**
   * A fresh non-cached lookup ran this run (scanner: !fromCache).
   * With dns_state "ok" this asserts resolver-agreed absence —
   * the only path to `absence_confirmed` (D-258-Q27).
   */
  liveRecheckDone?: boolean;
  observedAt: string;
}

/**
 * Flatten both proof tiers into ProofSetEntry rows. Entries keep
 * their own `source`; DNS rows take the hit-name as scope so a
 * child→parent move reads as SCOPE_CHANGED, not a drop+add.
 */
export function proofSnapshotFromInputs(
  input: ProofSnapshotSource,
): ProofSetSnapshot {
  const entries: ProofSetEntry[] = [];
  for (const e of input.dnsEntries) {
    entries.push({
      payTo: normalizeAddress(e.address),
      source: "dns",
      scope_name: input.dnsHitName ?? `_x402-payto.${input.domain}`,
      issued: e.issued,
      signature_status: verifyEntrySignature(e, input.domain),
    });
  }
  for (const e of input.siteEntries) {
    entries.push({
      payTo: normalizeAddress(e.address),
      source: "site",
      scope_name: input.domain,
      issued: e.issued,
      signature_status: verifyEntrySignature(e, input.domain),
    });
  }
  return {
    schema_version: RECHECK_SCHEMA_VERSION,
    domain: input.domain,
    observed_at: input.observedAt,
    dns_state: input.dnsState,
    site_state: input.siteState,
    dns_hit_name: input.dnsHitName ?? null,
    entries,
    absence_confirmed:
      input.liveRecheckDone === true && input.dnsState === "ok",
  };
}
