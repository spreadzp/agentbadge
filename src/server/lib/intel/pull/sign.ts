// EPIC-262 (SLICE-262-16): pull-job signature — Ed25519 over the
// JCS-canonical signed body {job_id, site_id, probe_id, params, exp,
// nonce, key_id}. Lifecycle fields (status, lease) are NOT signed.
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { canonicalizeJson } from "../../../../agent-readiness/integrity/jcs";
import type { SigningKey } from "../../../../agent-readiness/integrity/key-manager";
import type { PullJob } from "./types";

const PKCS8_ED25519_PREFIX = Buffer.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

export interface JobSignedBody {
  job_id: string;
  site_id: string;
  probe_id: string;
  params: Record<string, unknown>;
  exp: string;
  nonce: string;
  key_id: string;
}

export function jobSignedBody(j: PullJob): JobSignedBody {
  return {
    job_id: j.id,
    site_id: j.siteId,
    probe_id: j.probeId,
    params: j.params,
    exp: j.exp,
    nonce: j.nonce,
    key_id: j.keyId,
  };
}

export function jobSigningInput(body: JobSignedBody): string {
  return canonicalizeJson(body);
}

export function signJobBody(
  body: JobSignedBody,
  jobsKey: SigningKey,
): { algorithm: "ed25519"; value: string } {
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(jobsKey.privateKey)]),
    format: "der",
    type: "pkcs8",
  });
  const value = sign(
    null,
    Buffer.from(jobSigningInput(body), "utf8"),
    privateKey,
  ).toString("base64");
  return { algorithm: "ed25519", value };
}

const SPKI_ED25519_PREFIX = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
  0x70, 0x03, 0x21, 0x00,
]);

/** Mirror of the plugin-side check — tests assert both directions. */
export function verifyJobBody(
  body: JobSignedBody,
  sig: { algorithm: string; value: string },
  publicKey: Uint8Array,
): boolean {
  if (sig.algorithm !== "ed25519") return false;
  const pub = createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(publicKey)]),
    format: "der",
    type: "spki",
  });
  return verify(
    null,
    Buffer.from(jobSigningInput(body), "utf8"),
    pub,
    Buffer.from(sig.value, "base64"),
  );
}
