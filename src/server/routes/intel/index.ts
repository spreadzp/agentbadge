// EPIC-262: Agent Surface Intelligence route barrel (SLICE-262-0a/3).
import type { SigningKey } from "../../../agent-readiness/integrity/key-manager";
import type { IntelRegistryService } from "../../lib/intel/registry";
import type { IntelEvidenceStore } from "../../lib/intel/evidence/store";

export interface IntelRouteDeps {
  /** null → enabled but misconfigured: handlers answer 503 intel_key_missing. */
  key: SigningKey | null;
  /**
   * SLICE-262-3 intake deps — optional so the scaffold routes keep
   * working without stores wired; POST /evidence answers 503
   * intake_unavailable when absent.
   */
  registry?: IntelRegistryService;
  evidence?: IntelEvidenceStore;
  /** retention window in days — stamped as expiresAt on each row. */
  evidenceRetentionDays?: number;
}

export const INTEL_KEY_MISSING = {
  error: "intel_key_missing",
  message:
    "INTEL_ENABLED is set but INTEL_SIGNING_PRIVATE_KEY is missing or invalid",
} as const;

export { createIntelApiRoutes } from "./api";
export { createIntelKeysRoutes } from "./keys";
