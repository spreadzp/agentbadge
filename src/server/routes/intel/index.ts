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
import type { IntelClientReportStore } from "../../lib/intel/client-report";
import type {
  IntelPullJobStore,
  IntelSecurityEventStore,
} from "../../lib/intel/pull";

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
  /** SLICE-262-11 — client monthly reports (canonical + editorial). */
  clientReports?: IntelClientReportStore;
  /** SLICE-262-16 — pull-jobs + security events. */
  pullJobs?: IntelPullJobStore;
  securityEvents?: IntelSecurityEventStore;
  /**
   * SLICE-262-32 — tenant ids whose operators get cross-tenant
   * support diagnostics (Pryme ops). Client operators → 403
   * on /support even for their own ids — support is ops-side.
   */
  supportAdminTenantIds?: string[];
  /**
   * SLICE-262-28 — attestation store + validity window (days,
   * env INTEL_ATTESTATION_VALIDITY_DAYS, default 90).
   */
  attestations?: import("../../lib/intel/attestation").IntelAttestationStore;
  attestationValidityDays?: number;
  /**
   * SLICE-262-34 — per-site scan cooldown (seconds) bounding the
   * CI scan+diff pair. Absent → no cooldown (tests/dev).
   */
  scanCooldownSeconds?: number;
  /** SLICE-262-19b — append-only entitlement transition log. */
  entitlementEvents?: import("../../lib/intel/entitlement").IntelEntitlementEventStore;
  /** SLICE-262-21 — webhook secrets per provider; absent → 503. */
  billingSecrets?: { stripe?: string; freemius?: string };
}

export const INTEL_KEY_MISSING = {
  error: "intel_key_missing",
  message:
    "INTEL_ENABLED is set but INTEL_SIGNING_PRIVATE_KEY is missing or invalid",
} as const;

export { createIntelApiRoutes } from "./api";
export { createIntelKeysRoutes } from "./keys";
export { createIntelUiRoutes } from "./ui";
export { createIntelVerifyRoutes } from "./verify";
