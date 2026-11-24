/**
 * Agent Surface Intelligence config section (EPIC-262, SLICE-262-0a).
 * Always loaded — carries the feature flag + signing-key locator, not a
 * required block (like requestInbox). Flag off → wireIntel no-ops.
 */

import { booleanFlag } from "./validators";
import type { IntelEnvConfig } from "./intel-types";

export function loadIntel(): IntelEnvConfig {
  return {
    enabled: booleanFlag("INTEL_ENABLED"),
    keyId: process.env.INTEL_KEY_ID ?? "intel-dev-1",
    signingPrivateKey: process.env.INTEL_SIGNING_PRIVATE_KEY || undefined,
    evidenceRetentionDays: (() => {
      const raw = process.env.INTEL_EVIDENCE_RETENTION_DAYS;
      const n = raw === undefined ? 400 : Number(raw);
      return Number.isFinite(n) ? n : 400;
    })(),
    supportAdminTenantIds: (process.env.INTEL_SUPPORT_TENANT_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    attestationValidityDays: (() => {
      const raw = process.env.INTEL_ATTESTATION_VALIDITY_DAYS;
      const n = raw === undefined ? 90 : Number(raw);
      return Number.isFinite(n) && n > 0 ? n : 90;
    })(),
    scanCooldownSeconds: (() => {
      const raw = process.env.INTEL_SCAN_COOLDOWN_SECONDS;
      const n = raw === undefined ? 300 : Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : 300;
    })(),
  };
}
