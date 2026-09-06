/**
 * SLICE-102-9: Auto-Attestation Hook.
 *
 * Called after monitoring scan completes. Re-attests on-chain when
 * score changes significantly or last attestation is stale.
 */

export interface AutoAttestConfig {
  trustAutoAttest: boolean;
  trustReAttestThreshold: number;
  trustReAttestMaxAge: number;
}

export interface ScanResultLike {
  domain: string;
  score?: number;
  hasVerifiedOwnership?: boolean;
  hasPassport?: boolean;
  lastAttestationAt?: string;
  lastAttestationScore?: number;
}

export interface AttestFunction {
  (domain: string): Promise<{ success: boolean; error?: string }>;
}

export type OnScanCompleteHook = (scanResult: ScanResultLike) => Promise<void>;

export function createAutoAttestHook(
  config: AutoAttestConfig,
  attestFn: AttestFunction,
  logFn: (msg: string, meta?: Record<string, unknown>) => void = console.error,
): OnScanCompleteHook {
  return async (scanResult: ScanResultLike): Promise<void> => {
    if (!config.trustAutoAttest) {
      return;
    }

    if (!scanResult.hasVerifiedOwnership) {
      return;
    }

    if (!scanResult.hasPassport) {
      return;
    }

    const currentScore = scanResult.score ?? 0;
    const lastScore = scanResult.lastAttestationScore;
    const lastAt = scanResult.lastAttestationAt;

    // Check score change threshold
    if (lastScore !== undefined) {
      const scoreDelta = Math.abs(currentScore - lastScore);
      if (scoreDelta <= config.trustReAttestThreshold) {
        // Score hasn't changed enough — check age
        if (lastAt) {
          const ageDays = (Date.now() - new Date(lastAt).getTime()) / (1000 * 60 * 60 * 24);
          if (ageDays < config.trustReAttestMaxAge) {
            return; // Recent enough, skip
          }
        }
      }
    }

    // Re-attest
    try {
      const result = await attestFn(scanResult.domain);
      if (!result.success) {
        logFn(`Auto-attestation failed for ${scanResult.domain}`, { error: result.error });
      }
    } catch (err) {
      logFn(`Auto-attestation error for ${scanResult.domain}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

export function defaultAutoAttestConfig(): AutoAttestConfig {
  return {
    trustAutoAttest: process.env.TRUST_AUTO_ATTEST === "true",
    trustReAttestThreshold: parseInt(process.env.TRUST_REATTEST_THRESHOLD ?? "5", 10),
    trustReAttestMaxAge: parseInt(process.env.TRUST_REATTEST_MAX_AGE ?? "7", 10),
  };
}
