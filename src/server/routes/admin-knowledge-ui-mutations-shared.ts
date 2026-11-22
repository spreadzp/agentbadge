/**
 * EPIC-229 (SLICE-229-9): shared helpers for the browser-form
 * mutation routes — form-field readers, operator shape check and
 * the SSR idempotency wrapper. Split out when the mutations file
 * hit the 300-line cap (taxonomy mutations live in
 * admin-knowledge-ui-mutations-taxonomy.ts).
 */

import { createHash } from "node:crypto";

import { idempotentWrite } from "../lib/contract-guards";
import { isOperatorRef } from "../lib/knowledge";

export const formStr = (b: Record<string, unknown>, k: string): string =>
  typeof b[k] === "string" ? (b[k] as string).trim() : "";

/** Raw (untrimmed) field — whitespace inside prose is the author's. */
export const formRaw = (b: Record<string, unknown>, k: string): string =>
  typeof b[k] === "string" ? (b[k] as string) : "";

/** Arc R1 H2: empty → "admin-browser" (a valid ref); a provided
 *  value must pass the strict operator shape — `agent-7`, `did:*`,
 *  zero-width and fullwidth forms are refused with a flash. */
export const BROWSER_OPERATOR = "admin-browser";

export const opOf = (b: Record<string, unknown>): string =>
  formStr(b, "operator") || BROWSER_OPERATOR;

export const opBad = (b: Record<string, unknown>): boolean =>
  !isOperatorRef(opOf(b));

/** Arc R1 nit: `Number("1e2") === 100` slipped through — digits only. */
export const readSeq = (b: Record<string, unknown>): number | null => {
  const s = formStr(b, "seq");
  if (!/^\d{1,9}$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n > 0 ? n : null;
};

/** Arc R1 M10: console posts had zero idempotency — F5/double-click
 *  replayed every mutation (double versions, double transitions).
 *  Synthetic key = route + normalized body digest; the shared 24 h
 *  window dedupes replays the way the JSON API does. Failures are
 *  never cached so a corrected re-submit always re-executes. */
export const ssrWrite = async <T>(
  scope: string,
  binding: unknown,
  run: () => Promise<T>,
): Promise<T> => {
  const h = createHash("sha256")
    .update(JSON.stringify(binding))
    .digest("hex")
    .slice(0, 32);
  const r = await idempotentWrite(
    `ssr:${scope}`,
    `ssr:${h}`,
    async () => ({ status: 200, body: (await run()) as unknown }),
    { cacheErrors: false },
  );
  return r.body as T;
};
