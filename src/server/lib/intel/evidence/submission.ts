// EPIC-262 (SLICE-262-1): Collector Submission — the UNTRUSTED input DTO.
//
// Trust boundary rule (D-262-Q5/Q6): a collector can never assign provenance,
// received_at, verifier, or signature. Those fields do not exist here — and
// strictObject makes their presence a REJECT, not a silent strip. The backend
// stamps trust on the Canonical Envelope side only.
import { z } from "zod";
import { subjectSchema, payloadSchema } from "./shapes";
import { evidenceRefSchema } from "./refs";

export const collectorSubmissionSchema = z.strictObject({
  collector_id: z.string().min(1),
  scan_id: z.string().min(1),
  // collector's own reference to the site — resolved to site_id by the
  // backend from the authenticated context, never trusted verbatim
  site_ref: z.string().min(1),
  // claimed collection time — client clocks are untrusted; the envelope
  // carries it verbatim next to backend-owned received_at
  collected_at: z.string().datetime(),
  subject: subjectSchema,
  payload: payloadSchema,
  evidence_refs: z.array(evidenceRefSchema),
});

export type CollectorSubmission = z.infer<typeof collectorSubmissionSchema>;
