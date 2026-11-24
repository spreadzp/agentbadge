// EPIC-262 (SLICE-262-28): attestation store contract.
import type { IntelAttestation } from "./types";

export interface IntelAttestationStore {
  backend?: string;
  insert(a: IntelAttestation): Promise<IntelAttestation>;
  byId(id: string): Promise<IntelAttestation | null>;
  forSite(siteId: string): Promise<IntelAttestation[]>;
  update(a: IntelAttestation): Promise<IntelAttestation>;
}
