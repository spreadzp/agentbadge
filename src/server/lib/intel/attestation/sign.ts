// EPIC-262 (SLICE-262-28): attestation signature — identical
// convention to report/sign.ts: Ed25519 over JCS(RFC 8785) of the
// record with signature collapsed to {algorithm, key_id}. One
// mechanism verifies reports, envelopes, attestations.
import { sign, verify, createPrivateKey, createPublicKey } from "node:crypto";
import { canonicalizeJson } from "../../../../agent-readiness/integrity/jcs";
import type {
  SigningKey,
  PublicKeyEntry,
} from "../../../../agent-readiness/integrity/key-manager";
import {
  intelAttestationSchema,
  type IntelAttestation,
} from "./types";

const PKCS8_ED25519_PREFIX = Buffer.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);
const SPKI_ED25519_PREFIX = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
  0x70, 0x03, 0x21, 0x00,
]);

type AttestationCore = Omit<IntelAttestation, "signature"> & {
  signature?: Partial<IntelAttestation["signature"]>;
};

export function attestationSigningInput(
  a: IntelAttestation | AttestationCore,
  keyId?: string,
): string {
  const { signature, ...body } = a;
  return canonicalizeJson({
    ...body,
    signature: {
      algorithm: "ed25519",
      key_id: keyId ?? signature?.key_id,
    },
  });
}

export function signAttestation(
  body: Omit<IntelAttestation, "signature">,
  key: SigningKey,
): IntelAttestation {
  const input = attestationSigningInput(body, key.keyId);
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(key.privateKey)]),
    format: "der",
    type: "pkcs8",
  });
  const value = sign(null, Buffer.from(input, "utf8"), privateKey).toString("base64");
  return {
    ...body,
    signature: { algorithm: "ed25519", key_id: key.keyId, value },
  };
}

export function verifyAttestation(
  candidate: unknown,
  keys: Array<Pick<SigningKey, "keyId" | "publicKey"> | PublicKeyEntry>,
): { ok: true } | { ok: false; error: string } {
  const parsed = intelAttestationSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: "invalid_attestation" };
  const a = parsed.data;
  const key = keys.find((k) => k.keyId === a.signature.key_id);
  if (!key) return { ok: false, error: "unknown_key_id" };
  const publicKey = createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(key.publicKey)]),
    format: "der",
    type: "spki",
  });
  let sig: Buffer;
  try {
    sig = Buffer.from(a.signature.value, "base64");
  } catch {
    return { ok: false, error: "malformed_signature" };
  }
  return verify(null, Buffer.from(attestationSigningInput(a), "utf8"), publicKey, sig)
    ? { ok: true }
    : { ok: false, error: "bad_signature" };
}
