// EPIC-262 (SLICE-262-1): the trust boundary — the only place a Collector
// Submission becomes a Canonical Envelope.
//
// Contract invariants enforced here (D-262-Q5/Q6):
//  - trust fields come ONLY from the authenticated context, never the wire
//  - provenance = f(collector.type) — declared, not negotiated
//  - collector_id claimed in the submission must equal the authenticated id
//  - BACKEND_VERIFIED needs a concrete check_type (what was re-checked)
//  - DERIVED needs derived_from[] — also backend-supplied, not submitted
//  - subject is normalized, secrets redacted, then the envelope is signed
import { generateReportId } from "../../../../agent-readiness/integrity/ulid";
import type { SigningKey } from "../../../../agent-readiness/integrity/key-manager";
import {
  INTEL_ENVELOPE_SCHEMA_VERSION,
  type CanonicalEnvelope,
  type CollectorType,
} from "./envelope";
import { provenanceForCollectorType } from "./provenance";
import { collectorSubmissionSchema } from "./submission";
import { normalizeSubject, redactSecrets } from "./redact";
import { signEnvelope } from "./sign";
import type { Payload } from "./shapes";

// What the authenticated channel asserts — filled by the intake layer
// (SLICE-262-3) from site_key auth / job context, never from the body.
export interface AuthenticatedCollectorContext {
  collector: { type: CollectorType; id: string; version: string };
  site_id: string;
  // required for backend_verifier: who re-checked and WHAT check ran
  verifier?: { id: string; check_type: string };
  // required for deriver; allowed elsewhere (verifier linkage)
  derived_from?: string[];
}

// Default verifier for unverified classes: "we checked schema + channel",
// honestly describing what the boundary itself guarantees.
const BOUNDARY_VERIFIER = {
  id: "agentbadge-backend",
  check_type: "schema-and-channel",
} as const;

export function acceptSubmission(
  submission: unknown,
  ctx: AuthenticatedCollectorContext,
  key: SigningKey,
  now: Date = new Date(),
): CanonicalEnvelope {
  const parsed = collectorSubmissionSchema.parse(submission); // boundary reject
  if (parsed.collector_id !== ctx.collector.id) {
    throw new Error(
      `collector mismatch: submission claims "${parsed.collector_id}" ` +
        `but authenticated collector is "${ctx.collector.id}"`,
    );
  }
  const provenance = provenanceForCollectorType(ctx.collector.type);
  if (provenance === "BACKEND_VERIFIED" && !ctx.verifier) {
    throw new Error(
      "BACKEND_VERIFIED requires ctx.verifier naming the independent check",
    );
  }
  if (provenance === "DERIVED" && (!ctx.derived_from || ctx.derived_from.length === 0)) {
    throw new Error("DERIVED provenance requires non-empty ctx.derived_from[]");
  }

  return signEnvelope(
    {
      schema_version: INTEL_ENVELOPE_SCHEMA_VERSION,
      envelope_id: `env_${generateReportId(now.getTime())}`,
      scan_id: parsed.scan_id,
      site_id: ctx.site_id,
      collector: { ...ctx.collector },
      verifier: ctx.verifier ?? { ...BOUNDARY_VERIFIER },
      provenance,
      collected_at: parsed.collected_at,
      received_at: now.toISOString(),
      subject: normalizeSubject(parsed.subject),
      payload: redactSecrets(parsed.payload) as Payload,
      evidence_refs: parsed.evidence_refs,
      ...(ctx.derived_from ? { derived_from: [...ctx.derived_from] } : {}),
    },
    key,
  );
}
