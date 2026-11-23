// EPIC-262: Agent Surface Intelligence route barrel (SLICE-262-0a/3).
import type { SigningKey } from "../../../agent-readiness/integrity/key-manager";
import type {
  IntelRegistryService,
  IntelRegistryStores,
} from "../../lib/intel/registry";
import type { IntelEvidenceStore } from "../../lib/intel/evidence/store";
import type { IntelEntitlementStore } from "../../lib/intel/entitlement";
import type { IntelRuleset } from "../../lib/intel/rules";
import type { IntelScanJobStore, ScanFetch } from "../../lib/intel/scan";
import type { IntelConsentStore } from "../../lib/intel/consent";
import type { DnsResolver } from "../../lib/intel/ownership";

export interface IntelRouteDeps {
  /** null → enabled but misconfigured: handlers answer 503 intel_key_missing. */
  key: SigningKey | null;
  /**
   * SLICE-262-3 intake deps — optional so the scaffold routes keep
   * working without stores wired; POST /evidence answers 503
   * intake_unavailable when absent.
   */
  registry?: IntelRegistryService;
  /**
   * SLICE-262-7: raw stores for operator-key auth — operator ops are
   * store-level functions (service.ts is at its line budget).
   */
  registryStores?: IntelRegistryStores;
  evidence?: IntelEvidenceStore;
  /** retention window in days — stamped as expiresAt on each row. */
  evidenceRetentionDays?: number;
  /**
   * SLICE-262-6 deep-scan deps — POST /scans answers 503
   * scans_unavailable until all are wired.
   */
  entitlement?: IntelEntitlementStore;
  scanJobs?: IntelScanJobStore;
  ruleset?: IntelRuleset;
  scanFetch?: ScanFetch;
  /**
   * SLICE-262-8 — consent store (scans gate + consent routes) and
   * DNS resolver for domain_control verification.
   */
  consent?: IntelConsentStore;
  dnsResolver?: DnsResolver;
}

export const INTEL_KEY_MISSING = {
  error: "intel_key_missing",
  message:
    "INTEL_ENABLED is set but INTEL_SIGNING_PRIVATE_KEY is missing or invalid",
} as const;

export { createIntelApiRoutes } from "./api";
export { createIntelKeysRoutes } from "./keys";
