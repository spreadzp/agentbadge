import { randomUUID } from "node:crypto";

/**
 * EPIC-229 (SLICE-229-9, Arc R2 H-1): single-use form tokens for the
 * operator console. The previous ssrWrite dedupe hashed the POST
 * body — it wrapped every domain result in status:200, so
 * cacheErrors:false never triggered and FAILED writes were cached
 * for 24h (false success on replay, cross-operator replay of a
 * cached verify, blocked honest retries).
 *
 * Instead: every rendered form mints a one-time token; the POST
 * consumes it. A double-submit/back-button/F5 POST arrives with a
 * spent (or missing) token and gets an honest "expired/duplicate"
 * flash — the domain function never runs twice for one render,
 * and a failed write is never cached at all: the user simply
 * resubmits the freshly rendered form.
 */

const TOKEN_TTL_MS = 60 * 60 * 1000;
const TOKEN_CAP = 10_000;
const tokens = new Map<string, number>(); // token -> expiresAt

function sweep(now: number): void {
  for (const [t, exp] of tokens) {
    if (exp <= now) tokens.delete(t);
  }
  // FIFO eviction — Map iterates in insertion order.
  while (tokens.size > TOKEN_CAP) {
    const first = tokens.keys().next();
    if (first.done) break;
    tokens.delete(first.value);
  }
}

/** Minted at render time; embedded as a hidden formToken input. */
export function mintFormToken(): string {
  const now = Date.now();
  sweep(now);
  const t = `ft_${randomUUID()}`;
  tokens.set(t, now + TOKEN_TTL_MS);
  return t;
}

/** True exactly once per minted, unexpired token. */
export function consumeFormToken(token: string): boolean {
  const exp = tokens.get(token);
  if (exp === undefined || exp <= Date.now()) return false;
  tokens.delete(token);
  return true;
}
