export interface BadgeInput {
  scope: string;
  score: number;
  rulesetVersion: string;
  scannedAt: string;
  reportUrl: string;
  stale: boolean;
}

export function generateBadgeSvg(input: BadgeInput): string {
  const { scope, score, rulesetVersion, scannedAt, reportUrl, stale } = input;

  const color = scoreToColor(score);
  const scoreLabel = stale ? `${score} ⚠ stale` : `${score}/100`;
  const badgeWidth = stale ? 210 : 180;
  const ariaLabel = stale
    ? `Agent Readiness: ${score}/100 (stale)`
    : `Agent Readiness: ${score}/100`;
  const titleSuffix = stale ? " [stale]" : "";
  const dateStr = formatDate(scannedAt);
  const metaY = 42;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${badgeWidth}" height="56" role="img" aria-label="${escapeXml(ariaLabel)}">
  <title>Agent Readiness Badge — ${escapeXml(scope)}${titleSuffix}</title>
  <a href="${escapeXml(reportUrl)}">
    <rect width="100" height="28" fill="#555" rx="3"/>
    <rect x="100" width="${badgeWidth - 100}" height="28" fill="${color}" rx="3"/>
    <text x="50" y="18" fill="#fff" font-family="monospace" font-size="11" text-anchor="middle">agent-readiness</text>
    <text x="${100 + (badgeWidth - 100) / 2}" y="18" fill="#fff" font-family="monospace" font-size="11" text-anchor="middle">${escapeXml(scoreLabel)}</text>
  </a>
  <text x="4" y="${metaY}" fill="#888" font-family="monospace" font-size="9">${escapeXml(scope)}</text>
  <text x="4" y="${metaY + 11}" fill="#888" font-family="monospace" font-size="9">ruleset v${escapeXml(rulesetVersion)} · ${escapeXml(dateStr)}</text>
</svg>`;
}

export function scoreToColor(score: number): string {
  if (score >= 90) return "#4c1";
  if (score >= 70) return "#dfb317";
  return "#e05d44";
}

export function isStale(scannedAt: string, ttlDays: number): boolean {
  const scanned = new Date(scannedAt).getTime();
  const now = Date.now();
  const ageMs = now - scanned;
  return ageMs > ttlDays * 24 * 60 * 60 * 1000;
}

export function formatDate(isoString: string): string {
  const d = new Date(isoString);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
