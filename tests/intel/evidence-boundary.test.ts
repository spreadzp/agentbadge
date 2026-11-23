// EPIC-262 (SLICE-262-1): trust boundary — acceptSubmission turns an
// untrusted Collector Submission into a signed Canonical Envelope.
// Provenance comes ONLY from the authenticated collector context; storage,
// signing, and transformation never raise trust (D-262-Q6).
import { describe, it, expect } from "vitest";
import { verify, createPublicKey, createHash } from "node:crypto";
import {
  acceptSubmission,
  signEnvelope,
  verifyEnvelope,
  envelopeSigningInput,
  verifyEvidenceRefDigest,
  collectorSubmissionSchema,
  type AuthenticatedCollectorContext,
  type CollectorSubmission,
  type CanonicalEnvelope,
} from "../../src/server/lib/intel/evidence";
import { generateSigningKey } from "../../src/agent-readiness/integrity/key-manager";
import { canonicalizeJson } from "../../src/agent-readiness/integrity/jcs";

const KEY = generateSigningKey("bk-test-1");
const NOW = new Date("2026-11-23T10:00:04Z");

const SUBMISSION: CollectorSubmission = {
  collector_id: "hosted-scan@agentbadge.xyz",
  scan_id: "scan_01KDX2V5Q0W6Y8Z9A1B2C3D4E5",
  site_ref: "site_42",
  collected_at: "2026-11-23T10:00:00Z",
  subject: { type: "url", url: "https://EXAMPLE.com/robots.txt/" },
  payload: {
    type: "http_observation",
    url: "https://example.com/robots.txt",
    status: 200,
    content_hash: "a".repeat(64),
    content_type: "text/plain",
  },
  evidence_refs: [],
};

const ctx = (over: Partial<AuthenticatedCollectorContext> = {}): AuthenticatedCollectorContext => ({
  collector: { type: "external_scan", id: "hosted-scan@agentbadge.xyz", version: "2.2.0" },
  site_id: "site_42",
  ...over,
});

const pluginSubmission = (): CollectorSubmission => ({
  ...SUBMISSION,
  collector_id: "wp-plugin@pryme.studio",
  subject: { type: "wp_option", name: "blog_public" },
  payload: { type: "wp_option_read", name: "blog_public", value: "1" },
});

describe("provenance matrix — authenticated context decides, submission cannot", () => {
  it.each([
    ["external_scan", "EXTERNAL_OBSERVED"],
    ["wp_plugin", "PLUGIN_SELF_REPORTED"],
    ["backend_verifier", "BACKEND_VERIFIED"],
    ["deriver", "DERIVED"],
  ] as const)("collector.type=%s → provenance=%s", (type, expected) => {
    const c = ctx({ collector: { type, id: SUBMISSION.collector_id, version: "1.0.0" } });
    if (type === "backend_verifier")
      c.verifier = { id: "verifier-1", check_type: "external-refetch" };
    if (type === "deriver") c.derived_from = ["env_01KDX2V5Q0W6Y8Z9A1B2C3D4E5"];
    const env = acceptSubmission(SUBMISSION, c, KEY, NOW);
    expect(env.provenance).toBe(expected);
  });

  it("BACKEND_VERIFIED requires a concrete check_type, not just the class claim", () => {
    expect(() =>
      acceptSubmission(
        SUBMISSION,
        ctx({
          collector: { type: "backend_verifier", id: SUBMISSION.collector_id, version: "1" },
        }),
        KEY,
        NOW,
      ),
    ).toThrow(/verifier/i);
  });

  it("wp_plugin submitting identical content can never reach EXTERNAL_OBSERVED", () => {
    const env = acceptSubmission(
      pluginSubmission(),
      ctx({ collector: { type: "wp_plugin", id: "wp-plugin@pryme.studio", version: "1.0.0" } }),
      KEY,
      NOW,
    );
    expect(env.provenance).toBe("PLUGIN_SELF_REPORTED");
  });

  it("collector_id mismatch with authenticated context → reject (spoofed identity)", () => {
    expect(() =>
      acceptSubmission(
        SUBMISSION,
        ctx({ collector: { type: "wp_plugin", id: "attacker@evil", version: "1.0.0" } }),
        KEY,
        NOW,
      ),
    ).toThrow(/collector/i);
  });

  it("a submission trying to inject trust fields never reaches acceptSubmission", () => {
    const spoof = { ...SUBMISSION, provenance: "BACKEND_VERIFIED" };
    expect(collectorSubmissionSchema.safeParse(spoof).success).toBe(false);
  });
});

describe("envelope construction — backend-owned fields", () => {
  it("assigns envelope_id, site_id from context, received_at from backend clock", () => {
    const env = acceptSubmission(SUBMISSION, ctx(), KEY, NOW);
    expect(env.envelope_id).toMatch(/^env_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(env.site_id).toBe("site_42");
    expect(env.received_at).toBe("2026-11-23T10:00:04.000Z");
    expect(env.collected_at).toBe("2026-11-23T10:00:00Z");
    expect(env.schema_version).toBe("1.0");
  });

  it("normalizes the subject (lowercase host, no fabricated fields)", () => {
    const env = acceptSubmission(SUBMISSION, ctx(), KEY, NOW);
    expect(env.subject).toEqual({ type: "url", url: "https://example.com/robots.txt/" });
  });

  it("redacts secret-looking values in subject/payload", () => {
    const leaky: CollectorSubmission = {
      ...SUBMISSION,
      subject: { type: "wp_option", name: "smtp_password" },
      payload: { type: "wp_option_read", name: "smtp_password", value: "hunter2" },
    };
    const env = acceptSubmission(
      leaky,
      ctx({ collector: { type: "wp_plugin", id: "hosted-scan@agentbadge.xyz", version: "1" } }),
      KEY,
      NOW,
    );
    expect(JSON.stringify(env.payload)).not.toContain("hunter2");
    expect(JSON.stringify(env.payload)).toContain("[REDACTED]");
  });

  it("DERIVED requires derived_from from the (backend) context, not the submission", () => {
    expect(() =>
      acceptSubmission(
        SUBMISSION,
        ctx({ collector: { type: "deriver", id: SUBMISSION.collector_id, version: "1" } }),
        KEY,
        NOW,
      ),
    ).toThrow(/derived_from/i);
    const env = acceptSubmission(
      SUBMISSION,
      ctx({
        collector: { type: "deriver", id: SUBMISSION.collector_id, version: "1" },
        derived_from: ["env_01KDX2V5Q0W6Y8Z9A1B2C3D4E5"],
      }),
      KEY,
      NOW,
    );
    expect(env.derived_from).toEqual(["env_01KDX2V5Q0W6Y8Z9A1B2C3D4E5"]);
  });
});

describe("signature contract — integrity of the accepted envelope, not truth", () => {
  const makeEnv = () => acceptSubmission(SUBMISSION, ctx(), KEY, NOW);

  it("signature verifies against the published public key (JCS input)", () => {
    const env = makeEnv();
    expect(env.signature.algorithm).toBe("ed25519");
    expect(env.signature.key_id).toBe("bk-test-1");
    const input = Buffer.from(envelopeSigningInput(env), "utf8");
    const spki = Buffer.concat([
      Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]),
      Buffer.from(KEY.publicKey),
    ]);
    const pub = createPublicKey({ key: spki, format: "der", type: "spki" });
    expect(verify(null, input, pub, Buffer.from(env.signature.value, "base64"))).toBe(true);
  });

  it("signing input excludes the signature value but binds key_id + schema_version", () => {
    const env = makeEnv();
    const input = envelopeSigningInput(env);
    expect(input).not.toContain(env.signature.value);
    expect(input).toContain("bk-test-1");
    expect(input).toContain('"schema_version":"1.0"');
    // deterministic: same envelope → same canonical input
    expect(envelopeSigningInput(env)).toBe(input);
    expect(input).toBe(canonicalizeJson(JSON.parse(input)));
  });

  it("verifyEnvelope round-trips a freshly accepted envelope", () => {
    const env = makeEnv();
    const res = verifyEnvelope(env, [KEY]);
    expect(res.ok).toBe(true);
  });

  it.each([
    ["invalid signature", (e: CanonicalEnvelope) => ({ ...e, signature: { ...e.signature, value: Buffer.alloc(64, 9).toString("base64") } })],
    ["unknown key_id", (e: CanonicalEnvelope) => ({ ...e, signature: { ...e.signature, key_id: "bk-other" } })],
    ["unknown algorithm", (e: CanonicalEnvelope) => ({ ...e, signature: { ...e.signature, algorithm: "rsa" } })],
    ["unknown schema_version", (e: CanonicalEnvelope) => ({ ...e, schema_version: "9.9" })],
    ["tampered payload", (e: CanonicalEnvelope) => ({ ...e, site_id: "site_99" })],
  ])("rejects: %s", (_name, tamper) => {
    const res = verifyEnvelope(tamper(makeEnv()), [KEY]);
    expect(res.ok).toBe(false);
  });

  it("verifyEnvelope rejects a structurally invalid envelope before crypto", () => {
    const res = verifyEnvelope({ garbage: true }, [KEY]);
    expect(res.ok).toBe(false);
  });
});

describe("evidence refs — artifact verifiable by digest (AC #10)", () => {
  it("verifyEvidenceRefDigest checks sha256 + size of real bytes", () => {
    const bytes = Buffer.from("robots.txt body fixture");
    const ref = {
      evidence_ref_id: "ref-1",
      media_type: "text/plain",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
    };
    expect(verifyEvidenceRefDigest(ref, bytes)).toBe(true);
    expect(verifyEvidenceRefDigest(ref, Buffer.from("tampered"))).toBe(false);
    expect(verifyEvidenceRefDigest({ ...ref, size: bytes.length + 1 }, bytes)).toBe(false);
  });
});

describe("signEnvelope — re-signing an unsigned envelope shape", () => {
  it("produces an equivalent signature deterministically (ed25519 has no nonce)", () => {
    const a = acceptSubmission(SUBMISSION, ctx(), KEY, NOW);
    const b = signEnvelope({ ...a, signature: undefined } as never, KEY);
    // re-signing identical content+key yields identical signature value
    const c = signEnvelope(
      JSON.parse(JSON.stringify({ ...a, signature: { algorithm: "ed25519", key_id: KEY.keyId } })),
      KEY,
    );
    expect(c.signature.value).toBe(b.signature.value);
  });
});
