// EPIC-262 (SLICE-262-1): deterministic fixture builder for the versioned
// evidence contract. Ed25519 is nonce-free → a fixed seed + fixed fields
// yield byte-identical fixtures on every regeneration, so the committed
// JSON in docs/EPICS/262-agent-surface-intelligence/spec/fixtures/ IS
// reproducible (and the fixtures test proves it stays that way).
import { resolveIntelSigningKey } from "../server/lib/intel/keys";
import {
  acceptSubmission,
  signEnvelope,
  type AuthenticatedCollectorContext,
  type CanonicalEnvelope,
  type CollectorSubmission,
} from "../server/lib/intel/evidence";

// Fixed test seed — NOT a real signing key. Key id "bk-fixture-1" marks the
// fixtures as contract samples; production keys live in fly secrets. The key
// is DERIVED from the seed (never generateSigningKey — that is random), so
// regeneration is byte-identical everywhere.
export const FIXTURE_SEED_B64 = Buffer.alloc(32, 7).toString("base64");
export const FIXTURE_KEY = resolveIntelSigningKey({
  enabled: true,
  keyId: "bk-fixture-1",
  signingPrivateKey: FIXTURE_SEED_B64,
  evidenceRetentionDays: 400,
})!;
export const FIXTURE_NOW = new Date("2026-11-23T10:00:04Z");

const ULID_BASE = "01KDX2V5Q0W6Y8Z9A1B2C3D4E"; // 25 chars + index = 26

function fixedId(index: number): string {
  return `env_${ULID_BASE}${index}`;
}

function buildEnvelope(
  submission: CollectorSubmission,
  ctx: AuthenticatedCollectorContext,
  index: number,
): CanonicalEnvelope {
  const env = acceptSubmission(submission, ctx, FIXTURE_KEY, FIXTURE_NOW);
  // pin envelope_id for determinism, then re-sign — signature binds it
  return signEnvelope({ ...env, envelope_id: fixedId(index) }, FIXTURE_KEY);
}

export interface EnvelopeFixture {
  file: string;
  envelope: CanonicalEnvelope;
}

export interface NegativeFixture {
  file: string;
  kind: "submission" | "envelope";
  expected_error: string;
  document: unknown;
}

export function buildPositiveFixtures(): EnvelopeFixture[] {
  const base: CollectorSubmission = {
    collector_id: "collector-fixture",
    scan_id: "scan_01KDX2V5Q0W6Y8Z9A1B2C3D4E5",
    site_ref: "site_42",
    collected_at: "2026-11-23T10:00:00Z",
    subject: { type: "url", url: "https://example.com/robots.txt" },
    payload: {
      type: "http_observation",
      url: "https://example.com/robots.txt",
      status: 200,
      content_hash: "a".repeat(64),
      content_type: "text/plain",
    },
    evidence_refs: [],
  };
  const ctxFor = (type: AuthenticatedCollectorContext["collector"]["type"], extra = {}) => ({
    collector: { type, id: base.collector_id, version: "1.0.0" },
    site_id: "site_42",
    ...extra,
  });

  return [
    {
      file: "external-observed.envelope.json",
      envelope: buildEnvelope(base, ctxFor("external_scan"), 0),
    },
    {
      file: "plugin-self-reported.envelope.json",
      envelope: buildEnvelope(
        {
          ...base,
          subject: { type: "wp_option", name: "blog_public" },
          payload: { type: "wp_option_read", name: "blog_public", value: "1" },
        },
        ctxFor("wp_plugin"),
        1,
      ),
    },
    {
      file: "backend-verified.envelope.json",
      envelope: buildEnvelope(
        {
          ...base,
          payload: {
            type: "verification_result",
            outcome: "confirmed",
            detail: "external re-fetch observed the same wp-json exposure",
            target_envelope_id: fixedId(1),
          },
        },
        ctxFor("backend_verifier", {
          verifier: { id: "verifier-external-refetch", check_type: "external-refetch" },
          derived_from: [fixedId(1)],
        }),
        2,
      ),
    },
    {
      file: "derived.envelope.json",
      envelope: buildEnvelope(
        {
          ...base,
          subject: { type: "site" },
          payload: {
            type: "derived_assessment",
            summary: "robots.txt allows all assessed agent crawlers",
          },
        },
        ctxFor("deriver", { derived_from: [fixedId(0)] }),
        3,
      ),
    },
  ];
}

export function buildNegativeFixtures(): NegativeFixture[] {
  const submission = JSON.parse(
    JSON.stringify({
      collector_id: "collector-fixture",
      scan_id: "scan_01KDX2V5Q0W6Y8Z9A1B2C3D4E5",
      site_ref: "site_42",
      collected_at: "2026-11-23T10:00:00Z",
      subject: { type: "url", url: "https://example.com/x" },
      payload: {
        type: "http_observation",
        url: "https://example.com/x",
        status: 200,
      },
      evidence_refs: [],
    }),
  ) as CollectorSubmission;

  const valid = buildPositiveFixtures()[0].envelope;
  const tamper = (over: Record<string, unknown>) =>
    JSON.parse(JSON.stringify({ ...valid, ...over })) as CanonicalEnvelope;

  return [
    {
      file: "spoofed-provenance.submission.json",
      kind: "submission",
      expected_error: "unrecognized_keys",
      document: { ...submission, provenance: "EXTERNAL_OBSERVED" },
    },
    {
      file: "unknown-payload-type.submission.json",
      kind: "submission",
      expected_error: "invalid_union",
      document: { ...submission, payload: { type: "exec_shell", cmd: "id" } },
    },
    {
      file: "invalid-refs.submission.json",
      kind: "submission",
      expected_error: "invalid_type",
      document: {
        ...submission,
        evidence_refs: [{ evidence_ref_id: "r1", media_type: "text/plain" }],
      },
    },
    {
      file: "invalid-signature.envelope.json",
      kind: "envelope",
      expected_error: "bad_signature",
      document: tamper({
        signature: { ...valid.signature, value: Buffer.alloc(64, 9).toString("base64") },
      }),
    },
    {
      file: "unknown-key-id.envelope.json",
      kind: "envelope",
      expected_error: "unknown_key_id",
      document: tamper({ signature: { ...valid.signature, key_id: "bk-unknown" } }),
    },
    {
      file: "unknown-schema-version.envelope.json",
      kind: "envelope",
      expected_error: "invalid_envelope",
      document: tamper({ schema_version: "9.9" }),
    },
    {
      file: "derived-without-from.envelope.json",
      kind: "envelope",
      expected_error: "invalid_envelope",
      // a DERIVED claim signed without lineage — signature is real, the
      // record is still invalid (schema superRefine wins over crypto)
      document: signEnvelope(
        (() => {
          const { derived_from: _d, ...rest } = buildPositiveFixtures()[3].envelope as
            CanonicalEnvelope & { derived_from?: string[] };
          return { ...rest, provenance: "DERIVED" as const };
        })(),
        FIXTURE_KEY,
      ),
    },
  ];
}
