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
  /**
   * INTEL_SUPPORT_TENANT_IDS — comma-separated tenant ids whose
   * operators get cross-tenant /intel/support diagnostics
   * (SLICE-262-32, Pryme ops). Empty → support route always 403.
   */
  supportAdminTenantIds?: string[];
  /**
   * INTEL_ATTESTATION_VALIDITY_DAYS — attestation valid_until =
   * issued + N days (SLICE-262-28). Default 90.
   */
  attestationValidityDays?: number;
  /**
   * INTEL_SCAN_COOLDOWN_SECONDS — per-site minimum interval between
   * POST /scans runs (SLICE-262-34). CI "scan then diff" on every
   * push would amplify into external fetches against the client's
   * site; the cooldown caps it. Default 300; 0 disables (dev only).
   */
  scanCooldownSeconds?: number;
  /**
   * INTEL_BILLING_{STRIPE,FREEMIUS}_WEBHOOK_SECRET — provider webhook
   * secrets for POST /api/intel/billing/webhook/:provider
   * (SLICE-262-21). Absent → that provider answers 503
   * billing_unconfigured.
   */
  billingStripeSecret?: string;
  billingFreemiusSecret?: string;
}
