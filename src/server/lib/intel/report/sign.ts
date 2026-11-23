// EPIC-262 (SLICE-262-5): report signature contract — same convention
// as evidence envelopes: Ed25519 over JCS(RFC 8785) of the report with
// the signature collapsed to {algorithm, key_id} inside the signed
// bytes. One backend signature = integrity of the assembled report.
import { sign, verify, createPrivateKey, createPublicKey } from "node:crypto";
import { canonicalizeJson } from "../../../../agent-readiness/integrity/jcs";
import type {
  SigningKey,
  PublicKeyEntry,
} from "../../../../agent-readiness/integrity/key-manager";
import { intelReportSchema, type IntelReport } from "./schema";

const PKCS8_ED25519_PREFIX = Buffer.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);
const SPKI_ED25519_PREFIX = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
  0x70, 0x03, 0x21, 0x00,
]);

type ReportCore = Omit<IntelReport, "integrity"> & {
  integrity?: Partial<IntelReport["integrity"]>;
};

// Deterministic signing input — signature.value excluded, content_hash
// and key_id stay bound inside the signed bytes.
export function reportSigningInput(
  report: IntelReport | ReportCore,
  keyId?: string,
): string {
  const { integrity, ...body } = report;
  return canonicalizeJson({
    ...body,
    integrity: {
      content_hash: integrity?.content_hash,
      signature: {
        algorithm: "ed25519",
        key_id: keyId ?? integrity?.signature?.key_id,
      },
    },
  });
}

type ReportToSign = Omit<IntelReport, "integrity"> & {
  integrity: { content_hash: string };
};

export function signReport(body: ReportToSign, key: SigningKey): IntelReport {
  const input = reportSigningInput(body, key.keyId);
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(key.privateKey)]),
    format: "der",
    type: "pkcs8",
  });
  const value = sign(null, Buffer.from(input, "utf8"), privateKey).toString("base64");
  return {
    ...body,
    integrity: {
      content_hash: body.integrity.content_hash,
      signature: { algorithm: "ed25519", key_id: key.keyId, value },
    },
  };
}

export type VerifyReportResult =
  | { ok: true; report: IntelReport }
  | { ok: false; error: string };

export function verifyIntelReport(
  candidate: unknown,
  keys: Array<Pick<SigningKey, "keyId" | "publicKey"> | PublicKeyEntry>,
): VerifyReportResult {
  const parsed = intelReportSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: "invalid_report" };
  const report = parsed.data;

  const key = keys.find((k) => k.keyId === report.integrity.signature.key_id);
  if (!key) return { ok: false, error: "unknown_key_id" };

  const publicKey = createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(key.publicKey)]),
    format: "der",
    type: "spki",
  });
  let signature: Buffer;
  try {
    signature = Buffer.from(report.integrity.signature.value, "base64");
  } catch {
    return { ok: false, error: "malformed_signature" };
  }
  const valid = verify(
    null,
    Buffer.from(reportSigningInput(report), "utf8"),
    publicKey,
    signature,
  );
  return valid ? { ok: true, report } : { ok: false, error: "bad_signature" };
}
