// EPIC-259 (SLICE-259-30): test-override state split from did-auth.ts
// (max-lines). Re-exported by did-auth.ts — consumers keep importing
// from "middleware/did-auth".
import { NonceStore } from "./did-nonce";
import type { VerifySignatureFn } from "./did-verify";

let _overrideVerifier: VerifySignatureFn | null = null;
let _overrideNonceStore: NonceStore | null = null;
const _defaultNonceStore = new NonceStore();

export function configureDidAuthForTesting(config: {
  verifier?: VerifySignatureFn | null;
  nonceStore?: NonceStore | null;
}) {
  _overrideVerifier = config.verifier ?? null;
  _overrideNonceStore = config.nonceStore ?? null;
}

/** Test overrides shared by every DID-auth surface — requireDidSignature
 *  AND didAuthEnrich (EPIC-259) read them when no explicit opts given. */
export function didAuthTestOverrides(): {
  verifier: VerifySignatureFn | null;
  nonceStore: NonceStore | null;
} {
  return { verifier: _overrideVerifier, nonceStore: _overrideNonceStore };
}

/** The nonce store requireDidSignature will consume from — the challenge
 *  endpoint must issue into the same store (test override wins). */
export function didAuthNonceStore(): NonceStore {
  return _overrideNonceStore ?? _defaultNonceStore;
}
