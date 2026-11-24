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

const identity = (e: Pick<ProofSetEntry, "source" | "scope_name" | "payTo">) =>
  `${e.source}|${e.scope_name}|${e.payTo}`;

const scopeOf = (e: Pick<ProofSetEntry, "source" | "scope_name">) =>
  `${e.source}|${e.scope_name}`;

/** Was this member's absence actually provable this run? (C13/D-258-Q27) */
function confirmsAbsence(
  prev: ProofSetEntry,
  cur: ProofSetSnapshot,
): boolean {
  if (cur.absence_confirmed === true) return true;
  if (prev.source === "dns") return cur.dns_state === "ok";
  // site member: the effective tier must have been resolved — an
  // unanswered DNS could have published a shadowing set this run.
  if (cur.dns_state !== "ok") return false;
  const dnsHas = cur.entries.some((e) => e.source === "dns");
  if (dnsHas) return true; // DNS set rules — absence in it is confirmed
  return cur.site_state !== "unchecked";
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
  if (!prev || !cur || !prev.domain || !cur.domain) {
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

  const prevByIdentity = new Map(prev.entries.map((e) => [identity(e), e]));
  const curByIdentity = new Map(cur.entries.map((e) => [identity(e), e]));
  const curByPayTo = new Map<string, ProofSetEntry[]>();
  for (const e of cur.entries) {
    const list = curByPayTo.get(e.payTo) ?? [];
    list.push(e);
    curByPayTo.set(e.payTo, list);
  }
  const prevPayTos = new Set(prev.entries.map((e) => e.payTo));

  // ── prev members: still / scope-change / drop / unchecked ────────
  for (const pm of prev.entries) {
    const id = identity(pm);
    const exact = curByIdentity.get(id);
    if (exact) {
      if (
        pm.signature_status === "valid" &&
        exact.signature_status === "invalid"
      ) {
        transitions.push({
          kind: "CONFLICT",
          severity: "medium",
          payTo: pm.payTo,
          identity: id,
          previously_verified_at: prev.observed_at,
          currently_observed_at: cur.observed_at,
          note:
            `signature for ${pm.payTo} was valid ${day(prev.observed_at)}, ` +
            `verifies invalid ${day(cur.observed_at)} — investigate`,
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
  for (const ce of cur.entries) {
    if (prevByIdentity.has(identity(ce)) || prevPayTos.has(ce.payTo)) {
      continue; // already classified via prev side
    }
    added.push(ce);
  }

  // ── classify drops + adds ────────────────────────────────────────
  const rotated = dropped.length > 0 && added.length > 0;
  for (const pm of dropped) {
    const kind = rotated ? "ROTATED" : "DROPPED";
    transitions.push({
      kind,
      severity: "medium",
      payTo: pm.payTo,
      identity: identity(pm),
      previously_verified_at: prev.observed_at,
      currently_observed_at: cur.observed_at,
      ...(rotated ? { replaced_by: added[0]!.payTo } : {}),
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
    transitions.push({
      kind,
      severity: reappeared ? "info" : rotated ? "medium" : "info",
      payTo: ce.payTo,
      identity: identity(ce),
      currently_observed_at: cur.observed_at,
      ...(rotated && !reappeared && dropped.length > 0
        ? { replaces: dropped[0]!.payTo }
        : {}),
      note: reappeared
        ? `${ce.payTo} reappeared at ${scopeOf(ce)} — was dropped earlier`
        : rotated
          ? `${ce.payTo} appeared replacing ${dropped.map((d) => d.payTo).join(", ")}`
          : `${ce.payTo} newly proven at ${scopeOf(ce)}`,
    });
  }

  if (prev.entries.length === 0 && cur.entries.length === 0) {
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
