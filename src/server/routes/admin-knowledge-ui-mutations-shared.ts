/**
 * EPIC-229 (SLICE-229-9): shared helpers for the browser-form
 * mutation routes — form-field readers and the SSR idempotency
 * wrapper. Split out when the mutations file hit the 300-line cap
 * (taxonomy mutations live in admin-knowledge-ui-mutations-taxonomy.ts).
 * SLICE-264-6: the `operator` form field + shape check are gone —
 * the actor is the credential-resolved principal.id.
 */

import {
  consumeFormToken,
  isOperatorRef,
  normalizeOperatorRef,
} from "../lib/knowledge";

export const formStr = (b: Record<string, unknown>, k: string): string =>
  typeof b[k] === "string" ? (b[k] as string).trim() : "";

/** Raw (untrimmed) field — whitespace inside prose is the author's.
 *  Arc R2 nit: CRLF→LF — a Windows-submitted body must not mint a
 *  spurious "changed" version against LF-normalized content. */
export const formRaw = (b: Record<string, unknown>, k: string): string =>
  typeof b[k] === "string" ? (b[k] as string).replace(/\r\n/g, "\n") : "";

/** Arc R1 H2 + R2 M-5: empty → "admin-browser" (a valid ref); a
 *  provided value is canonicalized NFKC+lowercase (same as the JSON
 *  edge) then must pass the strict operator shape — `agent-7`,
 *  `did:*`, zero-width and fullwidth forms are refused with a flash.
 *  SLICE-264-6: knowledge routes no longer read this (actor =
 *  principal.id); review-center consumes it until SLICE-264-8. */
export const BROWSER_OPERATOR = "admin-browser";

export const opOf = (b: Record<string, unknown>): string =>
  normalizeOperatorRef(formStr(b, "operator")) || BROWSER_OPERATOR;

export const opBad = (b: Record<string, unknown>): boolean =>
  !isOperatorRef(opOf(b));

/** Arc R1 nit: `Number("1e2") === 100` slipped through — digits only. */
export const readSeq = (b: Record<string, unknown>): number | null => {
  const s = formStr(b, "seq");
  if (!/^\d{1,9}$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n > 0 ? n : null;
};

/** Arc R2 H-1: ssrWrite's body-hash dedupe wrapped every result in
 *  status:200 — failures got cached 24h and replayed cross-operator.
 *  Replaced by render-minted single-use formToken: consume-once at
 *  the POST edge; a spent/missing token gets an honest flash and the
 *  domain write never runs. */
export const FORM_TOKEN_ERR = "form_expired_or_duplicate";

export const tokenConsumed = (b: Record<string, unknown>): boolean =>
  consumeFormToken(formStr(b, "formToken"));
