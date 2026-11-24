// EPIC-264 (SLICE-264-4): one-time key reveal — the SSR console must
// show a freshly minted opk_ plaintext EXACTLY once (C11), but the
// key itself must never travel in a URL (?ok= flashes are browser
// history + proxy-log material). So the POST mints a single-use
// reveal TOKEN that goes into the redirect; the page's first render
// consumes it and displays the plaintext — a second render, a copy
// of the link, or another operator's session finds nothing.
//
// The slot is bound to the minting principal — a reveal link handed
// to a different operator-admin yields nothing (the key crossed to
// them anyway only if they generated it).
//
// Same shape as knowledge/form-tokens.ts (D-229-12): in-memory v1,
// TTL + cap, consume-once. A pod restart simply loses pending reveals
// — the operator re-issues the credential.

import { randomUUID } from "node:crypto";

const REVEAL_TTL_MS = 60 * 1000; // 60s — enough for the PRG round-trip
const REVEAL_CAP = 1_000;

interface RevealSlot {
  plaintext: string;
  ownerId: string; // principal.id that minted — bound on consume
  expiresAt: number;
}

const slots = new Map<string, RevealSlot>();

function sweep(now: number): void {
  for (const [t, s] of slots) {
    if (s.expiresAt <= now) slots.delete(t);
  }
  // FIFO eviction — Map iterates in insertion order.
  while (slots.size > REVEAL_CAP) {
    const first = slots.keys().next();
    if (first.done) break;
    slots.delete(first.value);
  }
}

/** Called inside the POST handler — returns the opaque ?reveal= token. */
export function mintKeyReveal(plaintext: string, ownerId: string): string {
  const now = Date.now();
  sweep(now);
  const token = `kr_${randomUUID()}`;
  slots.set(token, { plaintext, ownerId, expiresAt: now + REVEAL_TTL_MS });
  return token;
}

/** True-once per (token, owner) — the plaintext leaves the slot on
 *  FIRST successful read. A wrong-owner or replayed read gets null. */
export function consumeKeyReveal(
  token: string,
  ownerId: string,
): string | null {
  const slot = slots.get(token);
  if (slot === undefined || slot.expiresAt <= Date.now()) return null;
  if (slot.ownerId !== ownerId) return null;
  slots.delete(token);
  return slot.plaintext;
}
