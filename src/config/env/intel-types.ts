/** Agent Surface Intelligence env config types (EPIC-262, SLICE-262-0a). */

export interface IntelEnvConfig {
  /**
   * INTEL_ENABLED — master feature flag for the /api/intel/* surface.
   * Off → intel routes are not mounted at all (ARC_VENUE_ENABLED
   * precedent: flag off = zero behavior change).
   */
  enabled: boolean;
  /**
   * INTEL_KEY_ID — active signing key id published in
   * /.well-known/agentbadge-keys.json. Rotation keeps old ids in the
   * registry until their signatures expire.
   */
  keyId: string;
  /**
   * INTEL_SIGNING_PRIVATE_KEY — base64 raw 32-byte Ed25519 seed.
   * Source: fly secrets (staging/prod) or .env (dev). Absent while
   * enabled → routes answer 503 intel_key_missing, never a synthetic
   * key (the well-known doc must be stable across restarts).
   */
  signingPrivateKey?: string;
  /**
   * INTEL_EVIDENCE_RETENTION_DAYS — transparent retention deadline
   * stamped as expiresAt on each stored envelope (D-262-Q8: no
   * "archive forever"). Default 400; <=0 disables expiry (dev only).
   */
  evidenceRetentionDays: number;
}
