export interface BadgeCategory {
  name: string;
  score: number;
}

export interface BadgeOptions {
  score: number;
  grade: string;
  categories: BadgeCategory[];
}

function scoreColor(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 50) return "#eab308";
  return "#ef4444";
}

export function generateBadgeSvg(opts: BadgeOptions): string {
  const color = scoreColor(opts.score);
  const w = 200;
  const barH = 12;
  const barGap = 4;
  const headerH = 60;
  const catH = opts.categories.length * (barH + barGap);
  const h = headerH + catH + 20;

  const bars = opts.categories
    .map((c, i) => {
      const y = headerH + i * (barH + barGap);
      const barW = Math.max(0, Math.min(150, (c.score / 100) * 150));
      return `  <rect x="10" y="${y}" width="150" height="${barH}" rx="2" fill="#e5e7eb"/>
  <rect x="10" y="${y}" width="${barW}" height="${barH}" rx="2" fill="${scoreColor(c.score)}"/>
  <text x="165" y="${y + barH - 2}" font-size="10" fill="#374151">${c.score}</text>
  <text x="10" y="${y - 2}" font-size="9" fill="#6b7280">${c.name}</text>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" rx="8" fill="#f9fafb" stroke="#d1d5db"/>
  <text x="100" y="25" text-anchor="middle" font-size="16" font-weight="bold" fill="#111827">Agent Readiness</text>
  <text x="100" y="48" text-anchor="middle" font-size="28" font-weight="bold" fill="${color}">${opts.score}</text>
  <text x="170" y="48" text-anchor="middle" font-size="20" font-weight="bold" fill="${color}">${opts.grade}</text>
${bars}
</svg>`;
}
