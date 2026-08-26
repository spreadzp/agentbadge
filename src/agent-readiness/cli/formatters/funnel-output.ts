/**
 * SLICE-87-2: ASCII Funnel Renderer — renders funnel stages as CLI bars
 */

import type { FunnelResult } from "../../scoring/funnel-computer";

export function renderFunnelAscii(funnel: FunnelResult): string {
  const lines: string[] = [];
  const maxBarWidth = 24;

  for (let i = 0; i < funnel.stages.length; i++) {
    const stage = funnel.stages[i];
    const pct = Math.round(stage.score);
    const barWidth = Math.round((stage.score / 100) * maxBarWidth);
    const bar = "█".repeat(barWidth) + "░".repeat(maxBarWidth - barWidth);
    const dropOff = i > 0 ? `  ↓${funnel.dropOff[i - 1]}%` : "";
    lines.push(`  ${stage.name.padEnd(16)} ${bar}  ${pct}%${dropOff}`);
  }

  return lines.join("\n");
}
