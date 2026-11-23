// EPIC-262 (SLICE-262-1): envelope signature contract (Q59=A+C).
//
// One signature — the backend's — over a deterministic signing input:
// JCS (RFC 8785) of the envelope with `signature` replaced by
// {algorithm, key_id}. The signature VALUE is excluded while key_id and
// schema_version stay bound inside the signed bytes. Meaning: "backend
// accepted this envelope" — integrity, not truth of facts. Collector
// signatures are out of v1 (no fake attestation fields).
import { sign, verify, createPrivateKey, createPublicKey } from "node:crypto";
import { canonicalizeJson } from "../../../../agent-readiness/integrity/jcs";
import type {
  SigningKey,
  PublicKeyEntry,
} from "../../../../agent-readiness/integrity/key-manager";
import { canonicalEnvelopeSchema, type CanonicalEnvelope } from "./envelope";

// Ed25519 PKCS8/SPKI DER prefixes — same construction as
// agent-readiness/integrity/signer.ts and lib/intel/keys.ts.
const PKCS8_ED25519_PREFIX = Buffer.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);
const SPKI_ED25519_PREFIX = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
  0x70, 0x03, 0x21, 0x00,
]);

type EnvelopeCore = Omit<CanonicalEnvelope, "signature"> & {
  signature?: Partial<CanonicalEnvelope["signature"]>;
};

// Deterministic signing input — recomputable by any verifier that knows the
// key_id. The signature object is collapsed to {algorithm, key_id}.
export function envelopeSigningInput(env: CanonicalEnvelope | EnvelopeCore): string {
  const { signature, ...fields } = env;
  return canonicalizeJson({
    ...fields,
    signature: { algorithm: "ed25519", key_id: signature?.key_id },
  });
}

export function signEnvelope(
  env: EnvelopeCore | CanonicalEnvelope,
  key: SigningKey,
): CanonicalEnvelope {
  const { signature: _drop, ...fields } = env;
  const input = canonicalizeJson({
    ...fields,
    signature: { algorithm: "ed25519", key_id: key.keyId },
  });
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(key.privateKey)]),
    format: "der",
    type: "pkcs8",
  });
  const value = sign(null, Buffer.from(input, "utf8"), privateKey).toString("base64");
  return {
    ...fields,
    signature: { algorithm: "ed25519", key_id: key.keyId, value },
  };
}

export type VerifyEnvelopeResult =
  | { ok: true; envelope: CanonicalEnvelope }
  | { ok: false; error: string };

// Structure first (schema pins version + algo), then key lookup, then crypto.
// Unknown schema_version / algorithm / key_id / bad signature all → reject.
export function verifyEnvelope(
  candidate: unknown,
  keys: Array<Pick<SigningKey, "keyId" | "publicKey"> | PublicKeyEntry>,
): VerifyEnvelopeResult {
  const parsed = canonicalEnvelopeSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: "invalid_envelope" };
  const env = parsed.data;

  const key = keys.find((k) => k.keyId === env.signature.key_id);
  if (!key) return { ok: false, error: "unknown_key_id" };

  const publicKey = createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(key.publicKey)]),
    format: "der",
    type: "spki",
  });
  let signature: Buffer;
  try {
    signature = Buffer.from(env.signature.value, "base64");
  } catch {
    return { ok: false, error: "malformed_signature" };
  }
  const valid = verify(
    null,
    Buffer.from(envelopeSigningInput(env), "utf8"),
    publicKey,
    signature,
  );
  return valid ? { ok: true, envelope: env } : { ok: false, error: "bad_signature" };
}
