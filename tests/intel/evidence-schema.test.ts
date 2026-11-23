// EPIC-262 (SLICE-262-1): Canonical Evidence & Provenance Contract v1 —
// schema-level guarantees. Collector Submission and Canonical Envelope are
// TWO DIFFERENT schemas (D-262-Q5): the submission is an untrusted DTO that
// physically cannot carry trust fields; the envelope is backend-owned.
import { describe, it, expect } from "vitest";
import {
  collectorSubmissionSchema,
  canonicalEnvelopeSchema,
  provenanceEnum,
  INTEL_ENVELOPE_SCHEMA_VERSION,
  type CollectorSubmission,
} from "../../src/server/lib/intel/evidence";

const VALID_SUBMISSION: CollectorSubmission = {
  collector_id: "wp-plugin@pryme.studio",
  scan_id: "scan_01KDX2V5Q0W6Y8Z9A1B2C3D4E5",
  site_ref: "site_42",
  collected_at: "2026-11-23T10:00:00Z",
  subject: { type: "wp_option", name: "blog_public" },
  payload: { type: "wp_option_read", name: "blog_public", value: "1" },
  evidence_refs: [],
};

function signedEnvelope(over: Record<string, unknown> = {}) {
  return {
    schema_version: "1.0",
    envelope_id: "env_01KDX2V5Q0W6Y8Z9A1B2C3D4E5",
    scan_id: "scan_01KDX2V5Q0W6Y8Z9A1B2C3D4E5",
    site_id: "site_42",
    collector: { type: "wp_plugin", id: "wp-plugin@pryme.studio", version: "1.0.0" },
    verifier: { id: "agentbadge-backend", check_type: "schema-and-channel" },
    provenance: "PLUGIN_SELF_REPORTED",
    collected_at: "2026-11-23T10:00:00Z",
    received_at: "2026-11-23T10:00:04Z",
    subject: { type: "wp_option", name: "blog_public" },
    payload: { type: "wp_option_read", name: "blog_public", value: "1" },
    evidence_refs: [],
    signature: { algorithm: "ed25519", key_id: "bk-2026-11", value: "AA==" },
    ...over,
  };
}

describe("collectorSubmissionSchema — untrusted input DTO", () => {
  it("accepts a well-formed submission", () => {
    expect(collectorSubmissionSchema.safeParse(VALID_SUBMISSION).success).toBe(true);
  });

  it("requires all base fields", () => {
    for (const field of [
      "collector_id",
      "scan_id",
      "site_ref",
      "collected_at",
      "subject",
      "payload",
      "evidence_refs",
    ]) {
      const partial = { ...VALID_SUBMISSION } as Record<string, unknown>;
      delete partial[field];
      expect(collectorSubmissionSchema.safeParse(partial).success).toBe(false);
    }
  });

  // AC #6: trust fields are not merely ignored — their presence is a reject.
  it.each(["provenance", "received_at", "verifier", "signature"])(
    "rejects a submission carrying trust field %s (boundary reject, not strip)",
    (field) => {
      const spoof = { ...VALID_SUBMISSION, [field]: "EXTERNAL_OBSERVED" };
      expect(collectorSubmissionSchema.safeParse(spoof).success).toBe(false);
    },
  );

  it("rejects unknown payload types (discriminant is required)", () => {
    const bad = { ...VALID_SUBMISSION, payload: { type: "exec_shell", cmd: "id" } };
    expect(collectorSubmissionSchema.safeParse(bad).success).toBe(false);
    const noDisc = { ...VALID_SUBMISSION, payload: { value: 42 } };
    expect(collectorSubmissionSchema.safeParse(noDisc).success).toBe(false);
  });

  it("rejects malformed evidence_refs (digest+type+size required)", () => {
    const bad = {
      ...VALID_SUBMISSION,
      evidence_refs: [{ evidence_ref_id: "r1", media_type: "text/plain" }],
    };
    expect(collectorSubmissionSchema.safeParse(bad).success).toBe(false);
  });
});

describe("canonicalEnvelopeSchema — backend-owned record", () => {
  it("accepts a well-formed signed envelope", () => {
    expect(canonicalEnvelopeSchema.safeParse(signedEnvelope()).success).toBe(true);
  });

  it("pins schema_version to the v1 literal", () => {
    expect(INTEL_ENVELOPE_SCHEMA_VERSION).toBe("1.0");
    expect(
      canonicalEnvelopeSchema.safeParse(signedEnvelope({ schema_version: "9.9" })).success,
    ).toBe(false);
  });

  it("provenance enum is exactly the 4 classes", () => {
    expect(provenanceEnum.options).toEqual([
      "EXTERNAL_OBSERVED",
      "PLUGIN_SELF_REPORTED",
      "BACKEND_VERIFIED",
      "DERIVED",
    ]);
  });

  it("rejects a provenance value outside the enum", () => {
    expect(
      canonicalEnvelopeSchema.safeParse(signedEnvelope({ provenance: "TRUSTED" })).success,
    ).toBe(false);
  });

  // AC #7: DERIVED must name its inputs — a derived claim without lineage is rejectable.
  it("DERIVED without derived_from[] → reject; with it → accept", () => {
    const noFrom = signedEnvelope({ provenance: "DERIVED" });
    expect(canonicalEnvelopeSchema.safeParse(noFrom).success).toBe(false);
    const emptyFrom = signedEnvelope({ provenance: "DERIVED", derived_from: [] });
    expect(canonicalEnvelopeSchema.safeParse(emptyFrom).success).toBe(false);
    const ok = signedEnvelope({
      provenance: "DERIVED",
      derived_from: ["env_01KDX2V5Q0W6Y8Z9A1B2C3D4E5"],
    });
    expect(canonicalEnvelopeSchema.safeParse(ok).success).toBe(true);
  });

  it("non-DERIVED provenance may still carry derived_from (verifier linkage)", () => {
    const env = signedEnvelope({
      provenance: "BACKEND_VERIFIED",
      derived_from: ["env_01KDX2V5Q0W6Y8Z9A1B2C3D4E5"],
    });
    expect(canonicalEnvelopeSchema.safeParse(env).success).toBe(true);
  });

  it("verifier is a structure: who AND what was checked", () => {
    const flat = signedEnvelope({ verifier: "agentbadge-backend" });
    expect(canonicalEnvelopeSchema.safeParse(flat).success).toBe(false);
    const noCheck = signedEnvelope({ verifier: { id: "x" } });
    expect(canonicalEnvelopeSchema.safeParse(noCheck).success).toBe(false);
  });

  it("rejects unknown top-level keys (backend-owned record is closed)", () => {
    expect(
      canonicalEnvelopeSchema.safeParse(signedEnvelope({ confidence: 0.9 })).success,
    ).toBe(false);
  });
});
