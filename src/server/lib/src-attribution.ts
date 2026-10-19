/**
 * SLICE-201-7: ?src= attribution — article/guide/mcp → scan → audit.
 * Format: `^<channel>:<slug>$` e.g. `article:arc-c14-agent-discovery`,
 * `guide:hire-or-get-hired`, `mcp:board_get`. Shared by scan routes and
 * future surfaces (same scheme as 178-5 planning).
 */
import { auditStore } from "./keeperhub-audit-store";

const SRC_RE = /^[a-z]+:[a-z0-9_-]+$/;

/** Validated src value or null (never throws). */
export function parseSrc(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return SRC_RE.test(s) ? s : null;
}

export interface ScanAttribution {
  scanId: string;
  source: string;
}

/**
 * Record a scan-attribution audit event. Idempotent by scanId
 * (store dedupes on executionId+source). Returns null for invalid src.
 */
export async function recordScanAttribution(
  rawSrc: unknown,
  siteUrl: string,
  scanId: string,
): Promise<ScanAttribution | null> {
  const source = parseSrc(rawSrc);
  if (!source) return null;
  await auditStore.add({
    source,
    siteUrl,
    status: "recorded",
    executionId: scanId,
  });
  return { scanId, source };
}
