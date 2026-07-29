/**
 * SLICE-18-2: OG Image generator
 *
 * Generates public/icons/og-image.png (1200×630) from an SVG template.
 * Uses @resvg/resvg-js for SVG → PNG rasterization.
 *
 * Run: bun run scripts/generate-og-image.ts
 */

import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const OUTPUT_PATH = join(__dirname, "..", "public", "icons", "og-image.png");
const LOGO_PATH = join(__dirname, "..", "public", "icons", "favicon-180.png");

function buildSvg(): string {
  let logoDataUri = "";
  if (existsSync(LOGO_PATH)) {
    const buf = readFileSync(LOGO_PATH);
    logoDataUri = `data:image/png;base64,${buf.toString("base64")}`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <!-- Background: slate-950 -->
  <rect width="1200" height="630" fill="#020617"/>

  <!-- Decorative grid pattern -->
  <defs>
    <pattern id="grid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#0f172a" stroke-width="1"/>
    </pattern>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#10b981" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#020617" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#grid)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>

  <!-- Logo (180×180, centered top) -->
  ${logoDataUri ? `<image href="${logoDataUri}" x="510" y="60" width="180" height="180" />` : ""}

  <!-- Headline -->
  <text x="600" y="340" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="56" font-weight="700" fill="#f8fafc">
    On-chain Identity for AI Agents
  </text>

  <!-- Subline -->
  <text x="600" y="400" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="400" fill="#10b981">
    Hedera HTS Passports · HCS Directory · A2A Messaging
  </text>

  <!-- Bottom accent line -->
  <rect x="0" y="625" width="1200" height="5" fill="#10b981"/>

  <!-- Domain -->
  <text x="600" y="560" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="400" fill="#64748b">
    agent-passport-hedera.fly.dev
  </text>
</svg>`;
}

function main(): void {
  const svg = buildSvg();
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
  });
  const png = resvg.render().asPng();
  writeFileSync(OUTPUT_PATH, png);

  const sizeKB = (png.length / 1024).toFixed(1);
  console.log(`✓ Generated ${OUTPUT_PATH} (${sizeKB} KB, 1200×630)`);
}

main();
