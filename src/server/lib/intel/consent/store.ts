// EPIC-262 (SLICE-262-8): consent store contract — one row per
// (siteId, kind), upsert replaces latest state. Memory + postgres
// share identical behavior.

import type { ConsentKind, IntelConsent } from "./types";

export interface IntelConsentStore {
  backend: "memory" | "postgres";
  /** create-or-replace keyed by (siteId, kind) — idempotent */
  upsert(c: IntelConsent): Promise<IntelConsent>;
  byScope(siteId: string, kind: ConsentKind): Promise<IntelConsent | null>;
  forSite(siteId: string): Promise<IntelConsent[]>;
}
