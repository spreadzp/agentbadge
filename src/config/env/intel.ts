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
  };
}
