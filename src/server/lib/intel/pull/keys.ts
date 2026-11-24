// EPIC-262 (SLICE-262-16): domain-separated jobs signing key.
//
// `intel:jobs` sub-key is DERIVED from the intel seed — no second
// secret to manage (D-262-Q25): sub_seed = sha256("intel:jobs" ||
// seed). The well-known publishes it inside `keysets[]` with
// purpose:"jobs" + validity window, and the whole {root_id, keysets}
// doc is signed by the ROOT intel key. Plugins pin the root pubkey —
// never accept keys from a job response.
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { canonicalizeJson } from "../../../../agent-readiness/integrity/jcs";
import type { SigningKey } from "../../../../agent-readiness/integrity/key-manager";

const PKCS8_ED25519_PREFIX = Buffer.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

export const JOBS_KEY_DOMAIN = "intel:jobs";
export const JOBS_KEY_ID = "intel-jobs-v1";
/** issued at first deploy; rotation bumps key id + overlap window */
export const JOBS_KEY_NOT_BEFORE = "2026-11-24T00:00:00.000Z";
export const JOBS_KEY_NOT_AFTER = "2027-11-24T00:00:00.000Z";

/** Deterministic sub-key: same intel seed → same jobs key. Domain
 *  separation: a jobs signature can never verify under the report/
 *  envelope key and vice versa. */
export function deriveJobsKey(root: SigningKey): SigningKey {
  const sub = createHash("sha256")
    .update(JOBS_KEY_DOMAIN)
    .update(Buffer.from(root.privateKey))
    .digest();
  const privateKeyObj = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, sub]),
    format: "der",
    type: "pkcs8",
  });
  const spki = createPublicKey(privateKeyObj).export({
    format: "der",
    type: "spki",
  });
  return {
    keyId: JOBS_KEY_ID,
    algorithm: "ed25519",
    privateKey: new Uint8Array(sub),
    publicKey: new Uint8Array(spki.subarray(spki.length - 32)),
  };
}

export interface KeysetEntry {
  key_id: string;
  public_key: string; // base64 raw 32-byte pubkey
  purpose: "jobs";
  not_before: string;
  not_after: string;
  status: "active";
}

export function jobsKeysetEntry(jobs: SigningKey): KeysetEntry {
  return {
    key_id: jobs.keyId,
    public_key: Buffer.from(jobs.publicKey).toString("base64"),
    purpose: "jobs",
    not_before: JOBS_KEY_NOT_BEFORE,
    not_after: JOBS_KEY_NOT_AFTER,
    status: "active",
  };
}

/** Signed keyset doc for /.well-known/agentbadge-keys.json — root
 *  signs JCS({root_id, keysets}); plugins pin root, so a forged
 *  keyset fails signature verification. */
export function signKeyset(
  root: SigningKey,
  keysets: KeysetEntry[],
): { root_id: string; keysets: KeysetEntry[]; sig: { algorithm: "ed25519"; key_id: string; value: string } } {
  const body = { root_id: root.keyId, keysets };
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(root.privateKey)]),
    format: "der",
    type: "pkcs8",
  });
  const value = sign(
    null,
    Buffer.from(canonicalizeJson(body), "utf8"),
    privateKey,
  ).toString("base64");
  return {
    ...body,
    sig: { algorithm: "ed25519", key_id: root.keyId, value },
  };
}
