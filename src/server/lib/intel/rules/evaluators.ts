// EPIC-262 (SLICE-262-4): selector + verdict helpers for rules.
// Collectors emit an observation/fact envelope for EVERY probed path —
// so "robots missing" arrives as an http_observation 404, and an
// empty selector result honestly means "the scan never checked".

import type { CanonicalEnvelope, Payload } from "../evidence";
import type { IntelRule, RuleVerdict, IntelSeverity, IntelRuleSurface } from "./types";

type P<T extends Payload["type"]> = Extract<Payload, { type: T }>;

// ─── payload narrowers ──────────────────────────────────────────────
const has = <T extends Payload["type"]>(t: T) =>
  (e: CanonicalEnvelope): e is CanonicalEnvelope & { payload: P<T> } =>
    e.payload.type === t;

export const isHttpObs = has("http_observation");
export const isDocFact = has("document_fact");
export const isFilePresence = has("file_presence");
export const isOptionRead = has("wp_option_read");

export const httpWhere =
  (pred: (p: P<"http_observation">) => boolean) =>
  (e: CanonicalEnvelope) =>
    isHttpObs(e) && pred(e.payload);
export const docWhere =
  (docType: string, pred?: (p: P<"document_fact">) => boolean) =>
  (e: CanonicalEnvelope) =>
    isDocFact(e) && e.payload.doc_type === docType && (pred?.(e.payload) ?? true);
export const fileWhere =
  (pred: (p: P<"file_presence">) => boolean) =>
  (e: CanonicalEnvelope) =>
    isFilePresence(e) && pred(e.payload);
export const optionWhere =
  (pred: (p: P<"wp_option_read">) => boolean) =>
  (e: CanonicalEnvelope) =>
    isOptionRead(e) && pred(e.payload);

// ─── url / header helpers ───────────────────────────────────────────
export const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};
export const isRootUrl = (url: string) => pathOf(url) === "/";
export const pathEnds = (suffix: string) => (url: string) =>
  pathOf(url).endsWith(suffix);
export const pathIncludes = (frag: string) => (url: string) =>
  pathOf(url).includes(frag);

export const headerOf = (
  p: P<"http_observation">,
  name: string,
): string | undefined => {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(p.headers ?? {})) {
    if (k.toLowerCase() === want) return v;
  }
  return undefined;
};

// ─── verdicts ───────────────────────────────────────────────────────
export const pass = (reason: string): RuleVerdict => ({ status: "pass", reason });
export const fail = (reason: string): RuleVerdict => ({ status: "fail", reason });
export const warn = (reason: string): RuleVerdict => ({ status: "warn", reason });

// ─── composite builders ─────────────────────────────────────────────
const rule = (
  surface: IntelRuleSurface,
  rule_id: string,
  severity: IntelSeverity,
  name: string,
  select: IntelRule["select"],
  evaluate: IntelRule["evaluate"],
): IntelRule => ({ rule_id, version: "1.0.0", surface, severity, name, select, evaluate });

/** readiness/exposure presence check on a conventional path — a doc
 *  fact OR a 2xx observation passes; an explicit 4xx observation fails */
export function presenceRule(opts: {
  surface: IntelRuleSurface;
  id: string;
  severity: IntelSeverity;
  name: string;
  docType?: string;
  paths: string[];
  passReason: string;
  failReason: string;
}): IntelRule {
  return rule(
    opts.surface,
    opts.id,
    opts.severity,
    opts.name,
    (e) =>
      (opts.docType ? docWhere(opts.docType)(e) : false) ||
      httpWhere((p) => opts.paths.some((x) => pathOf(p.url) === x))(e) ||
      fileWhere((p) => opts.paths.some((x) => p.path === x))(e),
    (m) => {
      const hasDoc = opts.docType && m.some((e) => docWhere(opts.docType!)(e));
      const obs = m.filter(isHttpObs).map((e) => e.payload);
      const files = m.filter(isFilePresence).map((e) => e.payload);
      if (hasDoc || obs.some((o) => o.status < 400) || files.some((f) => f.present)) {
        return pass(opts.passReason);
      }
      if (files.length && files.every((f) => !f.present)) {
        return pass(`${opts.passReason} (absent)`);
      }
      return fail(opts.failReason);
    },
  );
}
