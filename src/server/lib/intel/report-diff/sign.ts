// EPIC-262 (SLICE-262-34): diff signature — identical convention to
// report/sign.ts + attestation/sign.ts: Ed25519 over JCS(RFC 8785)
// with the signature collapsed to {algorithm, key_id} inside the
// signed bytes. Third artefact on one mechanism (a shared helper is
// a worthwhile extraction, deliberately NOT this slice's scope).
import { sign, verify, createPrivateKey, createPublicKey } from "node:crypto";
import { canonicalizeJson } from "../../../../agent-readiness/integrity/jcs";
import type {
  SigningKey,
  PublicKeyEntry,
} from "../../../../agent-readiness/integrity/key-manager";
import {
  reportDiffSchema,
  type IntelReportDiff,
  type IntelReportDiffBody,
} from "./types";

const PKCS8_ED25519_PREFIX = Buffer.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);
const SPKI_ED25519_PREFIX = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
  0x70, 0x03, 0x21, 0x00,
]);

export function reportDiffSigningInput(
  d: IntelReportDiff | (IntelReportDiffBody & { signature?: { key_id?: string } }),
  keyId?: string,
): string {
  const { signature, ...body } = d;
  return canonicalizeJson({
    ...body,
    signature: {
      algorithm: "ed25519",
      key_id: keyId ?? signature?.key_id,
    },
  });
}

export function signReportDiff(
  body: IntelReportDiffBody,
  key: SigningKey,
): IntelReportDiff {
  const input = reportDiffSigningInput(body, key.keyId);
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

export function verifyReportDiff(
  candidate: unknown,
  keys: Array<Pick<SigningKey, "keyId" | "publicKey"> | PublicKeyEntry>,
): { ok: true; diff: IntelReportDiff } | { ok: false; error: string } {
  const parsed = reportDiffSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: "invalid_diff" };
  const d = parsed.data;
  const key = keys.find((k) => k.keyId === d.signature.key_id);
  if (!key) return { ok: false, error: "unknown_key_id" };
  const publicKey = createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(key.publicKey)]),
    format: "der",
    type: "spki",
  });
  let sig: Buffer;
  try {
    sig = Buffer.from(d.signature.value, "base64");
  } catch {
    return { ok: false, error: "malformed_signature" };
  }
  return verify(
    null,
    Buffer.from(reportDiffSigningInput(d), "utf8"),
    publicKey,
    sig,
  )
    ? { ok: true, diff: d }
    : { ok: false, error: "bad_signature" };
}
