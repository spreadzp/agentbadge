// EPIC-262 (SLICE-262-0a/3): intel surface wiring.
// INTEL_ENABLED off → nothing mounts (zero surface, ARC_VENUE_ENABLED
// precedent). Enabled without a key → routes mount but 503 honestly.
import type { Hono } from "hono";
import { logger } from "@agentbadge/passport/logger";
import { getConfig } from "../../config/env";
import { getDatabase } from "../lib/database";
import { resolveIntelSigningKey } from "../lib/intel/keys";
import {
  pickIntelRegistryStores,
  createIntelRegistryService,
} from "../lib/intel/registry";
import { pickIntelEvidenceStore } from "../lib/intel/evidence/db-stores";
import { pickIntelEntitlementStore } from "../lib/intel/entitlement";
import { pickIntelConsentStore } from "../lib/intel/consent";
import { createNodeDnsResolver } from "../lib/intel/ownership";
import { pickIntelClientReportStore } from "../lib/intel/client-report";
import {
  pickIntelPullJobStore,
  pickIntelSecurityEventStore,
} from "../lib/intel/pull/db-stores";
import { pickIntelAttestationStore } from "../lib/intel/attestation/db-stores";
import { pickIntelEntitlementEventStore } from "../lib/intel/entitlement";
import { pickIntelBillingEventStore } from "../lib/intel/billing";
import { INTEL_WP_PROFILE_V1 } from "../lib/intel/rules";
import {
  createSafeScanFetch,
  pickIntelScanJobStore,
} from "../lib/intel/scan";
import {
  createIntelApiRoutes,
  createIntelKeysRoutes,
  createIntelUiRoutes,
  createIntelVerifyRoutes,
} from "../routes/intel";

export function wireIntel(app: Hono): void {
  const cfg = getConfig().intel;
  if (!cfg?.enabled) return;

  const key = resolveIntelSigningKey(cfg);
  const db = getDatabase();
  const registryStores = pickIntelRegistryStores(db);
  const registry = createIntelRegistryService(registryStores);
  const evidence = pickIntelEvidenceStore(db);
  const entitlement = pickIntelEntitlementStore(db);
  const consent = pickIntelConsentStore(db);
  const scanJobs = pickIntelScanJobStore(db);
  const clientReports = pickIntelClientReportStore(db);
  const pullJobs = pickIntelPullJobStore(db);
  const securityEvents = pickIntelSecurityEventStore(db);
  const attestations = pickIntelAttestationStore(db);
  app.route(
    "/api/intel",
    createIntelApiRoutes({
      key,
      registry,
      registryStores,
      evidence,
      evidenceRetentionDays: cfg.evidenceRetentionDays,
      entitlement,
      scanJobs,
      ruleset: INTEL_WP_PROFILE_V1,
      scanFetch: createSafeScanFetch(),
      consent,
      dnsResolver: createNodeDnsResolver(),
      clientReports: clientReports.store,
      pullJobs,
      securityEvents,
      attestations,
      attestationValidityDays: cfg.attestationValidityDays,
      scanCooldownSeconds: cfg.scanCooldownSeconds,
      entitlementEvents: pickIntelEntitlementEventStore(db),
      billingEvents: pickIntelBillingEventStore(db),
      billingSecrets: {
        stripe: cfg.billingStripeSecret,
        freemius: cfg.billingFreemiusSecret,
      },
    }),
  );
  app.route("/", createIntelKeysRoutes({ key }));
  app.route(
    "/",
    createIntelVerifyRoutes({ key, consent, attestations }),
  );
  app.route(
    "/intel",
    createIntelUiRoutes({
      key,
      registry,
      registryStores,
      evidence,
      evidenceRetentionDays: cfg.evidenceRetentionDays,
      entitlement,
      scanJobs,
      ruleset: INTEL_WP_PROFILE_V1,
      scanFetch: createSafeScanFetch(),
      consent,
      dnsResolver: createNodeDnsResolver(),
      clientReports: clientReports.store,
      pullJobs,
      securityEvents,
      supportAdminTenantIds: cfg.supportAdminTenantIds,
    }),
  );
  logger.info("Intel routes registered", {
    keyId: cfg.keyId,
    keyResolved: key !== null,
    registryBackend: "wired",
    evidenceBackend: evidence.backend,
    pullJobsBackend: pullJobs.backend,
    securityEventsBackend: securityEvents.backend,
    attestationsBackend: attestations.backend,
  });
}
