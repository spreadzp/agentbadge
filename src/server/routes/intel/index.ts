// EPIC-262: Agent Surface Intelligence route barrel (SLICE-262-0a).
import type { SigningKey } from "../../../agent-readiness/integrity/key-manager";

export interface IntelRouteDeps {
  /** null → enabled but misconfigured: handlers answer 503 intel_key_missing. */
  key: SigningKey | null;
}

export const INTEL_KEY_MISSING = {
  error: "intel_key_missing",
  message:
    "INTEL_ENABLED is set but INTEL_SIGNING_PRIVATE_KEY is missing or invalid",
} as const;

export { createIntelApiRoutes } from "./api";
export { createIntelKeysRoutes } from "./keys";
