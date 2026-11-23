// EPIC-262 (SLICE-262-1): provenance assignment — the ONLY source of truth
// for the classification. Provenance is a pure function of the authenticated
// collector type (D-262-Q5); nothing in the submission can raise it, and no
// amount of storage/signing/transform upgrades it later (D-262-Q6).
import type { CollectorType, Provenance } from "./envelope";

export const COLLECTOR_TYPE_PROVENANCE: Record<CollectorType, Provenance> = {
  // we observed it ourselves from the outside
  external_scan: "EXTERNAL_OBSERVED",
  // the plugin told us — no independent confirmation implied
  wp_plugin: "PLUGIN_SELF_REPORTED",
  // backend independently re-checked the fact itself
  backend_verifier: "BACKEND_VERIFIED",
  // computed from other envelopes — derived_from[] is mandatory
  deriver: "DERIVED",
};

export function provenanceForCollectorType(type: CollectorType): Provenance {
  const provenance = COLLECTOR_TYPE_PROVENANCE[type];
  if (!provenance) throw new Error(`unknown collector type: ${type}`);
  return provenance;
}
