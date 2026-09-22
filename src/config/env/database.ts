/**
 * Database config section (EPIC-143, SLICE-143-4).
 * Optional — only loaded when DATABASE_ENABLED=true.
 * Off = zero behavior change (in-memory fallback everywhere).
 */

import type { DatabaseEnvConfig } from "./types";
import { booleanFlag, requiredString } from "./validators";

export function loadDatabase(
  errors: string[],
): DatabaseEnvConfig | undefined {
  if (!booleanFlag("DATABASE_ENABLED")) return undefined;

  const url = requiredString("DATABASE_URL", errors);

  return {
    enabled: true,
    url: url ?? "",
    // DIRECT_URL is consumed by CLI/migrations (packages/database), not the
    // runtime — passed through for completeness/debugging.
    directUrl: process.env.DIRECT_URL,
  };
}
