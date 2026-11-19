/**
 * SLICE-255-4: crypto/evidence runner — credential.json (6) +
 * evidence.json (3).
 *
 * What runs: our §5.6/§7 canonicalizer (tests/conformance/mmf/lib/
 * mmf-canon.ts) + @noble/curves Ed25519 — byte-exact reproduction of
 * the corpus's pinned payloads/hashes/signature.
 *
 * Prod equivalence honesty: prod wallet-sigs are EIP-191/ECDSA —
 * Ed25519 credentials and the MMF evidence hash chain DO NOT EXIST in
 * production. production_path therefore names the test-lib, and the
 * dimensions mark the prod-side mechanism as None — the PASS here is
 * "our canonicalizer is spec-conformant", never "prod conforms".
 */
import { ed25519 } from "@noble/curves/ed25519.js";

import type { CredentialVector, EvidenceVector } from "./mmf-types";
import {
  boundsPayload,
  canonNumber,
  credentialPayload,
  evidenceChain,
  field,
  sha256hex,
  type CanonMandateInputs,
} from "./mmf-canon";
import {
  RESULT_SCHEMA_VERSION,
  CORPUS_VERSION,
  deriveEquivalence,
  type DimensionNote,
  type VectorResult,
} from "./result";

const PROD_PATH = "tests/conformance/mmf/lib/mmf-canon+ed25519 (no prod analogue)";

const cryptoDims = (): Record<string, DimensionNote> => ({
  canonical_form: {
    mapped_to: "mmf-canon.ts (test-lib)",
    equivalence: "Partial",
    note: "spec byte-form reproduced in tests; prod has no §5.6 serializer",
  },
  ed25519_credentials: {
    mapped_to: null,
    equivalence: "None",
    note: "prod auth is EIP-191/ECDSA wallet-sig — no Ed25519 credential model",
  },
  evidence_hash_chain: {
    mapped_to: null,
    equivalence: "None",
    note: "prod evidence = ledger rows + alert log, no canonical hash chain",
  },
});

const hex = (s: string) => Buffer.from(s, "hex");
const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");

/* ------------------------------ credentials ----------------------------- */

/** §7 verification: every check reported, order fixed for triage. */
export function verifyCredential(
  cred: {
    mandate_id?: string;
    agent?: string;
    bounds_hash?: string;
    expires_at?: number;
    signature?: string;
    public_key?: string;
  },
  inputs: CanonMandateInputs,
  principalKeyHex: string,
): { ok: boolean; failed: string[] } {
  const failed: string[] = [];
  // §7: payload is rebuilt from the CREDENTIAL's claimed fields —
  // signature coverage is over what the credential asserts, then
  // bindings are checked separately against the mandate.
  const payload = [
    field(cred.mandate_id),
    field(cred.agent),
    field(cred.bounds_hash),
    field(
      cred.expires_at === undefined
        ? undefined
        : canonNumber(cred.expires_at),
    ),
  ].join("|");
  let sigOk = false;
  try {
    sigOk = ed25519.verify(
      hex(cred.signature ?? ""),
      new TextEncoder().encode(payload),
      hex(cred.public_key ?? ""),
    );
  } catch {
    sigOk = false;
  }
  if (!sigOk) failed.push("signature");
  if (cred.public_key !== principalKeyHex) failed.push("issuer_key");
  if (cred.mandate_id !== inputs.mandate_id) failed.push("mandate_binding");
  if (cred.agent !== inputs.agent) failed.push("agent_binding");
  const recomputed = sha256hex(boundsPayload(inputs));
  if (cred.bounds_hash !== recomputed) failed.push("bounds_hash");
  return { ok: failed.length === 0, failed };
}

export function runCredentialVector(
  v: CredentialVector,
  corpusSha256: string,
): VectorResult {
  const dimensions = cryptoDims();
  try {
    if (v.kind === "credential-signature") {
      const inputs = v.inputs as CanonMandateInputs;
      const secret = hex(v.seed_hex!);
      const pub = ed25519.getPublicKey(secret);
      const bPayload = boundsPayload(inputs);
      const bHash = sha256hex(bPayload);
      const cPayload = credentialPayload(inputs, bHash);
      const sig = ed25519.sign(new TextEncoder().encode(cPayload), secret);
      const exp = v.expected as {
        bounds_payload_hex?: string;
        bounds_hash?: string;
        payload_hex?: string;
        signature?: string;
        valid?: boolean;
      };
      const actual = {
        public_key_hex: toHex(pub),
        bounds_payload_hex: toHex(new TextEncoder().encode(bPayload)),
        bounds_hash: bHash,
        payload_hex: toHex(new TextEncoder().encode(cPayload)),
        signature: toHex(sig),
      };
      const match =
        actual.public_key_hex === v.public_key_hex &&
        actual.bounds_payload_hex === exp.bounds_payload_hex &&
        actual.bounds_hash === exp.bounds_hash &&
        actual.payload_hex === exp.payload_hex &&
        actual.signature === exp.signature;
      return {
        schema_version: RESULT_SCHEMA_VERSION,
        corpus_version: CORPUS_VERSION,
        corpus_sha256: corpusSha256,
        track: "crypto",
        vector_id: v.id,
        result: match ? "PASS" : "DIVERGENCE-MODEL",
        equivalence: deriveEquivalence(dimensions),
        production_path: PROD_PATH,
        expected: exp as unknown as Record<string, unknown>,
        actual,
        dimensions,
        notes: match ? undefined : "byte-level mismatch vs pinned §7 output",
      };
    }

    // negative vectors C02–C06: expected {valid:false}
    const exp = v.expected as { valid?: boolean };
    const { ok, failed } = verifyCredential(
      v.credential as never,
      v.mandate_inputs as CanonMandateInputs,
      v.principal_public_key_hex ?? "",
    );
    const match = ok === false && exp.valid === false;
    return {
      schema_version: RESULT_SCHEMA_VERSION,
      corpus_version: CORPUS_VERSION,
      corpus_sha256: corpusSha256,
      track: "crypto",
      vector_id: v.id,
      result: match ? "PASS" : "DIVERGENCE-MODEL",
      equivalence: deriveEquivalence(dimensions),
      production_path: PROD_PATH,
      expected: exp as Record<string, unknown>,
      actual: { valid: ok, failedChecks: failed },
      dimensions,
      notes: match ? undefined : `expected rejection, got ${JSON.stringify(failed)}`,
    };
  } catch (e) {
    return {
      schema_version: RESULT_SCHEMA_VERSION,
      corpus_version: CORPUS_VERSION,
      corpus_sha256: corpusSha256,
      track: "crypto",
      vector_id: v.id,
      result: "HARNESS_ERROR",
      equivalence: "None",
      production_path: PROD_PATH,
      expected: v.expected as Record<string, unknown>,
      actual: { error: e instanceof Error ? e.message : String(e) },
      dimensions,
    };
  }
}

/* -------------------------------- evidence ------------------------------ */

export function runEvidenceVector(
  v: EvidenceVector,
  corpusSha256: string,
): VectorResult {
  const dimensions = cryptoDims();
  try {
    const rows = evidenceChain(v.records);
    const head = rows.at(-1)?.hash ?? null;
    const payloadMatch = rows.every(
      (r, i) => r.payload === v.expect[i]?.payload && r.hash === v.expect[i]?.hash,
    );
    const match = payloadMatch && head === v.head;
    return {
      schema_version: RESULT_SCHEMA_VERSION,
      corpus_version: CORPUS_VERSION,
      corpus_sha256: corpusSha256,
      track: "crypto",
      vector_id: v.id,
      result: match ? "PASS" : "DIVERGENCE-MODEL",
      equivalence: deriveEquivalence(dimensions),
      production_path: PROD_PATH,
      expected: { expect: v.expect, head: v.head } as Record<string, unknown>,
      actual: { rows, head },
      dimensions,
      notes: match ? undefined : "canonical bytes or chain head differ",
    };
  } catch (e) {
    return {
      schema_version: RESULT_SCHEMA_VERSION,
      corpus_version: CORPUS_VERSION,
      corpus_sha256: corpusSha256,
      track: "crypto",
      vector_id: v.id,
      result: "HARNESS_ERROR",
      equivalence: "None",
      production_path: PROD_PATH,
      expected: { head: v.head },
      actual: { error: e instanceof Error ? e.message : String(e) },
      dimensions,
    };
  }
}
