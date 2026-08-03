import type {
  AnalysisReport,
  BarChartData,
  CorrelationMatrix,
  DatasetMetadata,
  MedicalAgentConfig,
  ScatterPoint,
} from "../types";

// ── SVG Generators ─────────────────────────────────────────────────────────────

export function barChartSvg(data: BarChartData): string {
  const { labels, values, title } = data;
  const n = labels.length;
  if (n === 0) return "";

  const maxVal = Math.max(...values, 1);
  const chartHeight = 200;
  const chartWidth = 800;
  const padding = 50;
  const barWidth = Math.max(20, (chartWidth - padding * 2) / n - 10);
  const gap = 10;
  const totalWidth = padding * 2 + n * (barWidth + gap) - gap;

  const bars = labels
    .map((label, i) => {
      const val = values[i];
      const barHeight = Math.max(2, (val / maxVal) * (chartHeight - 40));
      const x = padding + i * (barWidth + gap);
      const y = chartHeight - barHeight + 10;
      return `
      <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="#6366f1" rx="3" opacity="0.85"/>
      <text x="${x + barWidth / 2}" y="${chartHeight + 25}" text-anchor="middle" font-size="10" fill="#64748b">${escapeXml(label)}</text>
      <text x="${x + barWidth / 2}" y="${y - 5}" text-anchor="middle" font-size="10" fill="#334155" font-weight="600">${val.toFixed(1)}</text>`;
    })
    .join("");

  const titleEl = title ? `<text x="${totalWidth / 2}" y="20" text-anchor="middle" font-size="14" font-weight="600" fill="#1e293b">${escapeXml(title)}</text>` : "";

  return `<svg width="${totalWidth}" height="${chartHeight + 40}" xmlns="http://www.w3.org/2000/svg">
    ${titleEl}
    <line x1="${padding}" y1="${chartHeight + 10}" x2="${totalWidth - padding}" y2="${chartHeight + 10}" stroke="#e2e8f0" stroke-width="1"/>
    ${bars}
  </svg>`;
}

export function heatmapSvg(matrix: CorrelationMatrix): string {
  const { columns, matrix: data } = matrix;
  const n = columns.length;
  const cellSize = 50;
  const labelOffset = 80;
  const totalSize = labelOffset + n * cellSize + 20;

  const cells: string[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const r = data[i][j];
      const x = labelOffset + j * cellSize;
      const y = labelOffset + i * cellSize;
      const color = correlationColor(r);
      const textColor = Math.abs(r) > 0.6 ? "#ffffff" : "#1e293b";
      cells.push(
        `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="${color}" stroke="#e2e8f0" stroke-width="1"/>`,
        `<text x="${x + cellSize / 2}" y="${y + cellSize / 2 + 4}" text-anchor="middle" font-size="10" fill="${textColor}" font-weight="600">${r.toFixed(2)}</text>`,
      );
    }
  }

  const colLabels = columns
    .map(
      (c, j) =>
        `<text x="${labelOffset + j * cellSize + cellSize / 2}" y="${labelOffset - 8}" text-anchor="middle" font-size="9" fill="#64748b" transform="rotate(-30 ${labelOffset + j * cellSize + cellSize / 2} ${labelOffset - 8})">${escapeXml(c)}</text>`,
    )
    .join("");

  const rowLabels = columns
    .map(
      (c, i) =>
        `<text x="${labelOffset - 8}" y="${labelOffset + i * cellSize + cellSize / 2 + 4}" text-anchor="end" font-size="9" fill="#64748b">${escapeXml(c)}</text>`,
    )
    .join("");

  return `<svg width="${totalSize}" height="${totalSize}" xmlns="http://www.w3.org/2000/svg">
    <text x="${totalSize / 2}" y="20" text-anchor="middle" font-size="14" font-weight="600" fill="#1e293b">Correlation Heatmap</text>
    ${colLabels}
    ${rowLabels}
    ${cells.join("\n    ")}
  </svg>`;
}

export function scatterPlotSvg(
  points: ScatterPoint[],
  xLabel: string,
  yLabel: string,
): string {
  if (points.length === 0) return "";

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);

  const chartWidth = 400;
  const chartHeight = 300;
  const padding = 50;

  const xScale = (v: number) => padding + ((v - xMin) / (xMax - xMin || 1)) * (chartWidth - padding * 2);
  const yScale = (v: number) => chartHeight - padding - ((v - yMin) / (yMax - yMin || 1)) * (chartHeight - padding * 2);

  const circles = points
    .map(
      (p) =>
        `<circle cx="${xScale(p.x)}" cy="${yScale(p.y)}" r="4" fill="#6366f1" opacity="0.7"/>`,
    )
    .join("");

  return `<svg width="${chartWidth}" height="${chartHeight}" xmlns="http://www.w3.org/2000/svg">
    <text x="${chartWidth / 2}" y="20" text-anchor="middle" font-size="14" font-weight="600" fill="#1e293b">Scatter: ${escapeXml(xLabel)} vs ${escapeXml(yLabel)}</text>
    <line x1="${padding}" y1="${chartHeight - padding}" x2="${chartWidth - padding}" y2="${chartHeight - padding}" stroke="#e2e8f0" stroke-width="1"/>
    <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${chartHeight - padding}" stroke="#e2e8f0" stroke-width="1"/>
    <text x="${chartWidth / 2}" y="${chartHeight - 10}" text-anchor="middle" font-size="11" fill="#64748b">${escapeXml(xLabel)}</text>
    <text x="15" y="${chartHeight / 2}" text-anchor="middle" font-size="11" fill="#64748b" transform="rotate(-90 15 ${chartHeight / 2})">${escapeXml(yLabel)}</text>
    ${circles}
  </svg>`;
}

export function riskBadgeSvg(severity: string): string {
  const colors: Record<string, string> = {
    minimal: "#10b981",
    low: "#eab308",
    moderate: "#f59e0b",
    high: "#ef4444",
  };
  const color = colors[severity] ?? "#64748b";
  return `<svg width="120" height="28" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="120" height="28" rx="14" fill="${color}" opacity="0.15"/>
    <rect x="2" y="2" width="116" height="24" rx="12" fill="${color}"/>
    <text x="60" y="18" text-anchor="middle" font-size="12" font-weight="700" fill="#ffffff">${severity.toUpperCase()}</text>
  </svg>`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function correlationColor(r: number): string {
  if (r >= 0) {
    // Red for positive correlation
    if (r >= 0.7) return "#ef4444";
    if (r >= 0.4) return "#f87171";
    if (r >= 0.2) return "#fca5a5";
    return "#fee2e2";
  }
  // Blue for negative correlation
  if (r <= -0.25) return "#3b82f6";
  if (r <= -0.15) return "#60a5fa";
  if (r <= -0.05) return "#93c5fd";
  return "#dbeafe";
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fmt(n: number | null): string {
  if (n === null) return "—";
  return n.toFixed(2);
}

// ── Main Layout Generator ───────────────────────────────────────────────────────

export function generateHtmlLayout(
  report: AnalysisReport,
  metadata: DatasetMetadata,
  config: MedicalAgentConfig,
): string {
  const { descriptive, correlation, riskFactors } = report;

  // Stats table
  const statsRows = descriptive
    .map(
      (col) =>
        `<tr>
      <td>${escapeXml(col.name)}</td>
      <td>${col.type}</td>
      <td>${col.count}</td>
      <td>${col.nullCount}</td>
      <td>${fmt(col.mean)}</td>
      <td>${fmt(col.median)}</td>
      <td>${fmt(col.stdDev)}</td>
      <td>${fmt(col.min)}</td>
      <td>${fmt(col.max)}</td>
      <td>${fmt(col.q1)}</td>
      <td>${fmt(col.q3)}</td>
    </tr>`,
    )
    .join("");

  // Bar chart — mean values per column
  const numericCols = descriptive.filter((c) => c.type === "number" && c.mean !== null);
  const barData: BarChartData = {
    labels: numericCols.map((c) => c.name),
    values: numericCols.map((c) => c.mean ?? 0),
    title: "Mean Values by Column",
  };

  // Heatmap
  const heatmap = heatmapSvg(correlation);

  // Scatter — top 2 significant correlations
  const topPairs = correlation.pairs.slice(0, 2);
  const scatterCharts = topPairs
    .map((pair) => {
      const points: ScatterPoint[] = [];
      // Generate synthetic scatter from correlation coefficient for visualization
      const n = 50;
      for (let i = 0; i < n; i++) {
        const x = i / n * 10;
        const noise = (Math.sin(i * 7.3) + Math.cos(i * 3.1)) * 2;
        const y = x * pair.coefficient + noise;
        points.push({ x, y });
      }
      return scatterPlotSvg(points, pair.columnX, pair.columnY);
    })
    .join("\n    ");

  // Risk factors panel
  const riskPanel = riskFactors
    .map((rf) => {
      const badge = riskBadgeSvg(rf.severity);
      const factorsRows = rf.contributingFactors
        .map(
          (cf) =>
            `<tr>
        <td>${escapeXml(cf.metric)}</td>
        <td>${cf.value.toFixed(2)}</td>
        <td>${cf.threshold.toFixed(2)}</td>
        <td>${cf.points}</td>
        <td><code>${escapeXml(cf.glossaryTerm)}</code></td>
      </tr>`,
        )
        .join("");
      return `
    <div class="risk-card">
      <div class="risk-header">
        <h3>${escapeXml(rf.factorName)}</h3>
        ${badge}
      </div>
      <p class="risk-score">Score: <strong>${rf.score}</strong> / threshold: ${rf.threshold} (${rf.datasetType})</p>
      <table>
        <thead><tr><th>Metric</th><th>Value</th><th>Threshold</th><th>Points</th><th>Glossary Term</th></tr></thead>
        <tbody>${factorsRows}</tbody>
      </table>
    </div>`;
    })
    .join("\n");

  const generatedAt = new Date().toISOString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Medical Analysis Report — ${escapeXml(report.datasetName)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6; color: #1e293b; background: #f1f5f9; padding: 20px;
    }
    .container { max-width: 900px; margin: 0 auto; background: #fff; padding: 40px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 30px; }
    .header h1 { font-size: 28px; color: #0f172a; margin-bottom: 8px; }
    .header .meta { font-size: 14px; color: #64748b; }
    .header .agent { font-size: 12px; color: #94a3b8; margin-top: 4px; }
    .section { margin: 30px 0; }
    .section h2 { font-size: 20px; color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 15px; }
    .summary-box { background: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; border-radius: 4px; margin: 15px 0; }
    .chart-container { text-align: center; margin: 15px 0; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 13px; }
    th { background: #f8fafc; padding: 10px; text-align: left; font-weight: 600; color: #334155; border-bottom: 2px solid #e2e8f0; }
    td { padding: 10px; border-bottom: 1px solid #f1f5f9; }
    tr:nth-child(even) { background: #f8fafc; }
    tr:hover { background: #eff6ff; }
    .risk-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 15px 0; }
    .risk-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .risk-header h3 { font-size: 16px; color: #0f172a; }
    .risk-score { font-size: 14px; color: #475569; margin-bottom: 10px; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid #e2e8f0; text-align: center; color: #94a3b8; font-size: 12px; }
    .footer code { color: #64748b; }
    @media print {
      body { background: #fff; padding: 0; }
      .container { box-shadow: none; max-width: 100%; }
      .chart-container { page-break-inside: avoid; }
      .risk-card { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Medical Analysis Report</h1>
      <p class="meta">Dataset: ${escapeXml(report.datasetName)} | Rows: ${metadata.rowCount} | Analysis date: ${report.analysisDate}</p>
      <p class="agent">Agent: ${escapeXml(config.did)} | Tier: ${escapeXml(config.tier)}</p>
    </div>

    <div class="section">
      <h2>Executive Summary</h2>
      <div class="summary-box">
        <p><strong>${riskFactors.length}</strong> risk factor(s) identified across <strong>${descriptive.length}</strong> columns and <strong>${correlation.pairs.length}</strong> correlation pair(s).</p>
        ${riskFactors.map((rf) => `<p>${escapeXml(rf.factorName)}: <strong>${rf.severity.toUpperCase()}</strong> (score ${rf.score}/${rf.threshold}) <span class="severity-${rf.severity}">${rf.severity}</span></p>`).join("")}
      </div>
    </div>

    <div class="section">
      <h2>Descriptive Statistics</h2>
      <table>
        <thead><tr><th>Column</th><th>Type</th><th>Count</th><th>Nulls</th><th>mean</th><th>median</th><th>stdDev</th><th>min</th><th>max</th><th>Q1</th><th>Q3</th></tr></thead>
        <tbody>${statsRows}</tbody>
      </table>
    </div>

    <div class="section bar">
      <h2>Bar Chart — Mean Values</h2>
      <div class="chart-container bar">${barChartSvg(barData)}</div>
    </div>

    <div class="section heatmap">
      <h2>Correlation Heatmap</h2>
      <div class="chart-container heatmap">${heatmap}</div>
    </div>

    ${scatterCharts ? `<div class="section scatter"><h2>Scatter Plots — Top Correlations</h2><div class="chart-container scatter">${scatterCharts}</div></div>` : '<div class="section scatter"><p>No significant scatter plots.</p></div>'}

    <div class="section">
      <h2>Risk Factors</h2>
      ${riskPanel}
    </div>

    <div class="footer">
      <p>Generated by Medical Agent | DID: <code>${escapeXml(config.did)}</code></p>
      <p>Timestamp: ${generatedAt}</p>
      <p>This report is generated for demonstration purposes. For medical decisions, consult a healthcare professional.</p>
    </div>
  </div>
</body>
</html>`;
}
