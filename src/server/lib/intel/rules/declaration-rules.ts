// EPIC-262 (SLICE-262-4 corpus): declaration-consistency rules —
// the checkers hardened by the closed EPIC-259 audit
// (kid-unification, placeholder digests, dead advertised URLs,
// declared-vs-served prices). All readiness-surface: "can agents
// trust the documents the site publishes". Sites without any
// well-known documents honestly evaluate to unknown — the rules'
// selectors require declaration/fan-out facts to exist.

import type { IntelRule } from "./types";
import { docWhere, isDocFact, pass, fail, warn } from "./evaluators";

type Env = Parameters<IntelRule["evaluate"]>[0][number];
const facts = (e: Env) =>
  (isDocFact(e) ? e.payload.facts : {}) as Record<string, unknown>;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const R = (
  id: string,
  sev: IntelRule["severity"],
  name: string,
  select: IntelRule["select"],
  evaluate: IntelRule["evaluate"],
): IntelRule => ({
  rule_id: `AB-INTEL-R-${id}`,
  version: "1.1.0",
  surface: "readiness",
  severity: sev,
  name,
  select,
  evaluate,
});

const isWellKnownDoc = docWhere("well_known");
const isFanned = docWhere("other", (p) => p.facts.fanned_advertised === true);

// ─── R-023: declaration documents parse ───────────────────────────
// Every well-known JSON doc the site publishes must actually parse —
// a malformed agent-card is worse than none (it claims a surface it
// doesn't serve).
const declarationParse = R(
  "023",
  "medium",
  "declaration documents parse",
  isWellKnownDoc,
  (m) => {
    const bad = m
      .filter((e) => facts(e).parse_ok === false)
      .map((e) => (isDocFact(e) ? e.payload.url : "?"));
    return bad.length > 0
      ? fail(`unparseable: ${bad.join(", ")}`)
      : pass("all well-known docs parse");
  },
);

// ─── R-024: key material unified (kid consistency) ────────────────
// 259-F2: the same public key appeared under different kids in
// did.json vs jwks.json vs the WBA directory — an agent resolving
// by kid could get different identities for identical material.
const keyUnified = R(
  "024",
  "high",
  "key material consistent across declarations",
  docWhere("well_known", (p) => list(p.facts.key_pairs).length > 0),
  (m) => {
    const byKid = new Map<string, string>();
    const byX = new Map<string, string>();
    const conflicts: string[] = [];
    for (const e of m) {
      for (const pair of list(facts(e).key_pairs)) {
        const { kid, x } = pair as { kid?: unknown; x?: unknown };
        if (typeof kid !== "string" || typeof x !== "string") continue;
        if (byKid.has(kid) && byKid.get(kid) !== x)
          conflicts.push(`kid ${kid} → divergent key material`);
        if (byX.has(x) && byX.get(x) !== kid)
          conflicts.push(`key shared by kids ${byX.get(x)}/${kid}`);
        byKid.set(kid, x);
        byX.set(x, kid);
      }
    }
    return conflicts.length > 0
      ? fail(conflicts[0])
      : pass(`${byKid.size} key(s), consistent identity`);
  },
);

// ─── R-025: no placeholder digests ────────────────────────────────
// 259-F5 class: sha256/digest fields filled with all-zeros (or any
// single repeated char) — cosmetic integrity that verifies nothing.
const noPlaceholderDigests = R(
  "025",
  "high",
  "no placeholder digests in declarations",
  isWellKnownDoc,
  (m) => {
    const bad = m.flatMap((e) =>
      list(facts(e).placeholder_digests).map(
        (p) => `${String(p)} in ${isDocFact(e) ? e.payload.url : "?"}`,
      ),
    );
    return bad.length > 0
      ? fail(bad[0])
      : pass("no all-zero/constant digests");
  },
);

// ─── R-026: advertised URLs alive ─────────────────────────────────
// Every same-origin URL a site advertises (bounded fan-out ≤8)
// must resolve — a 404 in your own agent-card is the dead-URL class.
const advertisedAlive = R(
  "026",
  "medium",
  "advertised URLs resolve",
  (e) =>
    docWhere("well_known", (p) => list(p.facts.advertised_urls).length > 0)(e) ||
    isFanned(e),
  (m) => {
    const dead: string[] = [];
    let alive = 0;
    for (const e of m) {
      if (!isDocFact(e) || facts(e).fanned_advertised !== true) continue;
      if (facts(e).reachable === true) alive += 1;
      else dead.push(isDocFact(e) ? e.payload.url : "?");
    }
    if (dead.length > 0) return fail(`dead advertised: ${dead.join(", ")}`);
    return alive > 0
      ? pass(`${alive} advertised url(s) alive`)
      : warn("advertised urls declared but none probed");
  },
);

// ─── R-027: declared prices consistent with served 402s ───────────
// price-consistency: a 402 the endpoint actually demands must appear
// in the declared set — silently divergent pricing is the finding.
const priceKey = (p: { amount?: unknown; asset?: unknown }) =>
  `${String(p.asset ?? "?")}:${String(p.amount ?? "?")}`;
const priceConsistent = R(
  "027",
  "medium",
  "declared prices match served demands",
  (e) =>
    docWhere("well_known", (p) => list(p.facts.declared_prices).length > 0)(e) ||
    docWhere("other", (p) => list(p.facts.paid_accepts).length > 0)(e),
  (m) => {
    const declared = new Set<string>();
    const served = new Set<string>();
    for (const e of m) {
      for (const p of list(facts(e).declared_prices)) {
        declared.add(priceKey(p as { amount?: unknown; asset?: unknown }));
      }
      for (const p of list(facts(e).paid_accepts)) {
        served.add(priceKey(p as { amount?: unknown; asset?: unknown }));
      }
    }
    if (served.size === 0) {
      return declared.size > 0
        ? warn("prices declared but no 402 demanded on probed urls")
        : warn("no price evidence either side");
    }
    const undeclared = [...served].filter((k) => !declared.has(k));
    return undeclared.length > 0
      ? fail(`served price not declared: ${undeclared[0]}`)
      : pass(`${served.size} served price(s) all declared`);
  },
);

export const DECLARATION_RULES: IntelRule[] = [
  declarationParse,
  keyUnified,
  noPlaceholderDigests,
  advertisedAlive,
  priceConsistent,
];
