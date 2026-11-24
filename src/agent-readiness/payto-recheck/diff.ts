// SLICE-258-18: diffPaytoReports — pure recheck/revocation diff
// between two proof-set snapshots (D-258-Q26…Q29).
//
// Three levels are never mixed (D-258-Q20):
//   current state      — what each snapshot says
//   historical event   — the transitions this function returns
//   operational action — left to the caller (alert/hold/remove)
//
// DROPPED only on CONFIRMED absence: a failed or partial probe is
// `recheck_unchecked`, never a revocation (false-revocation guard).

import { normalizeAddress } from "@agentbadge/x402-payto-proof";
import {
  confirmsAbsence,
  identity,
  normalizeEntries,
  scopeOf,
} from "./entries.js";
import {
  RECHECK_SCHEMA_VERSION,
  type ProofSetEntry,
  type ProofSetSnapshot,
  type ProofTransition,
  type RecheckDiffResult,
  type RecheckSummary,
} from "./types.js";

export interface DiffOptions {
  /**
   * payTo addresses known to have DROPPED in an earlier transition
   * (caller-supplied history — the module stays stateless). A payTo
   * in `cur` that is also in this set classifies REAPPEARED, not
   * newly_proven.
   */
  knownDropped?: string[];
}

const day = (iso?: string) => (iso ? iso.slice(0, 10) : "?");

/**
 * Diff two observations of one proof set.
 *
 * Comparability gate (D-258-Q26): same domain, same schema version,
 * strictly ordered timestamps — otherwise `{comparable:false}`.
 * The function never guesses across incompatible reports.
 */
export function diffPaytoReports(
  prev: ProofSetSnapshot,
  cur: ProofSetSnapshot,
  opts: DiffOptions = {},
): RecheckDiffResult {
  if (
    !prev || !cur || !prev.domain || !cur.domain ||
    !Array.isArray(prev.entries) || !Array.isArray(cur.entries)
  ) {
    return { comparable: false, reason: "invalid_report" };
  }
  if (
    prev.schema_version !== RECHECK_SCHEMA_VERSION ||
    cur.schema_version !== RECHECK_SCHEMA_VERSION
  ) {
    return {
      comparable: false,
      reason: "schema_version_mismatch",
      detail: `${prev.schema_version} vs ${cur.schema_version}, expected ${RECHECK_SCHEMA_VERSION}`,
    };
  }
  if (prev.domain !== cur.domain) {
    return {
      comparable: false,
      reason: "domain_mismatch",
      detail: `${prev.domain} vs ${cur.domain}`,
    };
  }
  if (
    !(Date.parse(cur.observed_at) > Date.parse(prev.observed_at))
  ) {
    return {
      comparable: false,
      reason: "time_order",
      detail: `prev ${prev.observed_at} !< cur ${cur.observed_at}`,
    };
  }

  const known = new Set(
    (opts.knownDropped ?? []).map((a) => normalizeAddress(a)),
  );
  const transitions: ProofTransition[] = [];
  const dropped: ProofSetEntry[] = [];
  const added: ProofSetEntry[] = [];

  const prevEntries = normalizeEntries(prev.entries);
  const curEntries = normalizeEntries(cur.entries);

  const prevByIdentity = new Map(prevEntries.map((e) => [identity(e), e]));
  const curByIdentity = new Map(curEntries.map((e) => [identity(e), e]));
  const curByPayTo = new Map<string, ProofSetEntry[]>();
  for (const e of curEntries) {
    const list = curByPayTo.get(e.payTo) ?? [];
    list.push(e);
    curByPayTo.set(e.payTo, list);
  }
  const prevPayTos = new Set(prevEntries.map((e) => e.payTo));

  // ── prev members: still / scope-change / drop / unchecked ────────
  for (const pm of prevEntries) {
    const id = identity(pm);
    const exact = curByIdentity.get(id);
    if (exact) {
      // Any WEAKENING of a once-valid signature is a conflict — not
      // only valid→invalid. valid→none means the signature was
      // stripped; valid→unverifiable means it was corrupted into a
      // shape we cannot check (arc-review M7).
      if (
        pm.signature_status === "valid" &&
        exact.signature_status !== "valid"
      ) {
        transitions.push({
          kind: "CONFLICT",
          severity: "medium",
          payTo: pm.payTo,
          identity: id,
          previously_verified_at: prev.observed_at,
          currently_observed_at: cur.observed_at,
          signature_status: exact.signature_status,
          note:
            `signature for ${pm.payTo} was valid ${day(prev.observed_at)}, ` +
            `now ${exact.signature_status ?? "none"} ${day(cur.observed_at)} — investigate`,
        });
      } else {
        transitions.push({
          kind: "still_verified",
          severity: "none",
          payTo: pm.payTo,
          identity: id,
          previously_verified_at: prev.observed_at,
          currently_observed_at: cur.observed_at,
          note: `${pm.payTo} still proven at ${scopeOf(pm)}`,
        });
      }
      continue;
    }

    const samePayTo = curByPayTo.get(pm.payTo) ?? [];
    if (samePayTo.length > 0) {
      // Same address, different provenance — the proof's owner
      // scope moved (child→parent, site→dns…). Never "still".
      const to = samePayTo[0]!;
      transitions.push({
        kind: "SCOPE_CHANGED",
        severity: "medium",
        payTo: pm.payTo,
        identity: id,
        previously_verified_at: prev.observed_at,
        currently_observed_at: cur.observed_at,
        from_scope: scopeOf(pm),
        to_scope: scopeOf(to),
        note:
          `${pm.payTo} proof moved ${scopeOf(pm)} → ${scopeOf(to)} ` +
          `(verified ${day(prev.observed_at)}, observed ${day(cur.observed_at)})`,
      });
      continue;
    }

    if (!confirmsAbsence(pm, cur)) {
      transitions.push({
        kind: "recheck_unchecked",
        severity: "none",
        payTo: pm.payTo,
        identity: id,
        previously_verified_at: prev.observed_at,
        currently_observed_at: cur.observed_at,
        note:
          `${pm.payTo} was proven ${day(prev.observed_at)}; recheck ` +
          `inconclusive ${day(cur.observed_at)} — NOT a revocation`,
      });
      continue;
    }

    dropped.push(pm); // ROTATED pairing resolved after new members known
  }

  // ── cur members not in prev: new / reappeared ────────────────────
  for (const ce of curEntries) {
    if (prevByIdentity.has(identity(ce)) || prevPayTos.has(ce.payTo)) {
      continue; // already classified via prev side
    }
    added.push(ce);
  }

  // ── classify drops + adds ────────────────────────────────────────
  const rotated = dropped.length > 0 && added.length > 0;
  // replaced_by/replaces only when the pairing is unambiguous —
  // many-to-many attributions would lie (arc-review nit).
  const oneToOne = dropped.length === 1 && added.length === 1;
  for (const pm of dropped) {
    const kind = rotated ? "ROTATED" : "DROPPED";
    transitions.push({
      kind,
      severity: "medium",
      payTo: pm.payTo,
      identity: identity(pm),
      previously_verified_at: prev.observed_at,
      currently_observed_at: cur.observed_at,
      ...(oneToOne ? { replaced_by: added[0]!.payTo } : {}),
      note:
        `${pm.payTo} was proven ${day(prev.observed_at)}, absent ` +
        `${day(cur.observed_at)}` +
        (rotated
          ? ` — proof set rotated to ${added.map((a) => a.payTo).join(", ")}`
          : " — possible rotation or compromise"),
    });
  }

  for (const ce of added) {
    const reappeared = known.has(ce.payTo);
    const kind = reappeared
      ? "REAPPEARED"
      : rotated
        ? "ROTATED"
        : "newly_proven";
    // An added member that does NOT carry a verified signature is an
    // unsigned address claim — the add-only-compromise shape
    // (arc-review M7). Signed adds stay info.
    const unsignedAdd = ce.signature_status !== "valid";
    transitions.push({
      kind,
      severity:
        reappeared || kind === "newly_proven"
          ? unsignedAdd
            ? "medium"
            : "info"
          : "medium", // ROTATED is already medium
      payTo: ce.payTo,
      identity: identity(ce),
      currently_observed_at: cur.observed_at,
      signature_status: ce.signature_status,
      ...(oneToOne && !reappeared ? { replaces: dropped[0]!.payTo } : {}),
      note: reappeared
        ? `${ce.payTo} reappeared at ${scopeOf(ce)} — was dropped earlier` +
          (unsignedAdd ? " (signature not verified)" : "")
        : rotated
          ? `${ce.payTo} appeared replacing ${dropped.map((d) => d.payTo).join(", ")}`
          : `${ce.payTo} newly proven at ${scopeOf(ce)}` +
            (unsignedAdd ? " (signature not verified)" : ""),
    });
  }

  if (prevEntries.length === 0 && curEntries.length === 0) {
    transitions.push({
      kind: "still_absent",
      severity: "none",
      payTo: "",
      currently_observed_at: cur.observed_at,
      note: "no proof set before, none now",
    });
  }

  const summary: RecheckSummary = transitions.some(
    (t) => t.severity === "medium",
  )
    ? "changed"
    : transitions.some((t) => t.kind === "recheck_unchecked")
      ? "unchecked"
      : transitions.some(
            (t) => t.kind === "newly_proven" || t.kind === "REAPPEARED",
          )
        ? "unchanged_info"
        : "stable";

  return {
    comparable: true,
    summary,
    transitions,
    prev_observed_at: prev.observed_at,
    cur_observed_at: cur.observed_at,
  };
}
