/**
 * E2E Demo Script: Medical Data Processing Marketplace
 *
 * Runs the full agent-to-agent commerce workflow:
 *   Consumer posts task → Provider claims → Provider processes & delivers → Consumer settles payment
 *
 * Usage:
 *   bun run demo:medical-marketplace
 *
 * Or with a running server (HTTP mode):
 *   bun run demo:medical-marketplace --http
 */

import { generateRandomMedicalData, type MedicalData } from "../src/server/services/medical-data.service";
import { analyzeMedicalData, type AnalysisResult } from "../src/server/services/medical-processor.service";
import { generateHtmlReport } from "../src/server/services/html-report.service";
import { MedicalDataProviderAgent } from "../src/server/services/provider-agent.service";
import { MedicalDataConsumerAgent } from "../src/server/services/consumer-agent.service";

const BASE_URL = process.env.DEMO_BASE_URL ?? "http://localhost:4021";

function log(step: string, msg: string, detail?: string) {
  console.log(`  ✓ ${msg}`);
  if (detail) console.log(`    ${detail}`);
  console.log();
}

async function runDirectDemo() {
  console.log("🏥 Medical Data Processing Marketplace — E2E Demo");
  console.log("=".repeat(55));
  console.log();

  const startTime = Date.now();

  // ─── Agents ──────────────────────────────────────────
  const provider = new MedicalDataProviderAgent();
  const consumer = new MedicalDataConsumerAgent();

  // ─── Step 1: Register agents ─────────────────────────
  console.log("Step 1: Register Agents");
  const pReg = provider.register();
  const cReg = consumer.register();
  log("register", `Provider: ${pReg.name} (${pReg.did})`);
  log("register", `Consumer: ${cReg.name} (${cReg.did})`);

  // ─── Step 2: Generate medical data ───────────────────
  console.log("Step 2: Generate Medical Data");
  const medicalData: MedicalData = consumer.generateMedicalData();
  log(
    "generate",
    `Patient: ${medicalData.patientId} (${medicalData.patientName ?? "Unknown"}, age ${medicalData.age})`,
    `HR: ${medicalData.vitalSigns.heartRate} bpm | BP: ${medicalData.vitalSigns.bloodPressure} mmHg | Temp: ${medicalData.vitalSigns.temperature}°C`,
  );

  // ─── Step 3: Consumer posts marketplace task ─────────
  console.log("Step 3: Consumer Posts Marketplace Task");
  const posted = consumer.postTask(medicalData, 100);
  log(
    "post",
    `Task: ${posted.taskId}`,
    `Title: ${posted.task.title} | Price: ${posted.task.priceHbar} HBAR | Status: ${posted.task.status}`,
  );

  // ─── Step 4: Provider discovers & claims task ────────
  console.log("Step 4: Provider Discovers & Claims Task");
  const availableTasks = provider.listenForTasks();
  log("listen", `Found ${availableTasks.length} task(s) with medical-analysis capability`);

  const claimed = provider.claimTask(posted.taskId);
  log("claim", `Provider claimed task`, `Status: ${claimed.status} | Claimer: ${claimed.claimerDid}`);

  // ─── Step 5: Provider processes medical data ─────────
  console.log("Step 5: Provider Processes Medical Data");
  const processed = provider.processTask(posted.taskId, medicalData);
  log(
    "process",
    `Analysis complete — Risk: ${processed.analysis.riskLevel}`,
    `Abnormal findings: ${processed.analysis.abnormalFindings.length} | Recommendations: ${processed.analysis.recommendations.length}`,
  );

  // ─── Step 6: Provider delivers HTML report ───────────
  console.log("Step 6: Provider Delivers HTML Report");
  const delivered = provider.deliverResult(posted.taskId, processed.htmlReport);
  log("deliver", `Report delivered`, `Size: ${processed.htmlReport.length} bytes | Status: ${delivered.status}`);

  // ─── Step 7: Consumer receives & reviews report ──────
  console.log("Step 7: Consumer Receives & Reviews Report");
  const report = consumer.receiveReport(posted.taskId);
  const hasHtml = report.htmlReport?.includes("<!DOCTYPE html>") ?? false;
  log("receive", `Report received`, `HTML valid: ${hasHtml} | Status: ${report.status}`);

  // ─── Step 8: Consumer settles payment ────────────────
  console.log("Step 8: Consumer Settles Payment");
  const payment = consumer.settlePayment(posted.taskId);
  log("settle", `Payment settled — 100 HBAR transferred`, `TxId: ${payment.paymentTxId} | Status: ${payment.status}`);

  // ─── Summary ─────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("=".repeat(55));
  console.log(`✅ Full E2E workflow completed in ${elapsed}s`);
  console.log();
  console.log("Workflow Summary:");
  console.log(`  Consumer:  ${cReg.name} (${cReg.did})`);
  console.log(`  Provider:  ${pReg.name} (${pReg.did})`);
  console.log(`  Task:      ${posted.taskId}`);
  console.log(`  Patient:   ${medicalData.patientId}`);
  console.log(`  Risk:      ${processed.analysis.riskLevel}`);
  console.log(`  Report:    ${processed.htmlReport.length} bytes`);
  console.log(`  Payment:   100 HBAR (${payment.paymentTxId})`);
  console.log(`  Final:     ${payment.status}`);
  console.log();
}

async function runHttpDemo() {
  console.log("🏥 Medical Data Processing Marketplace — E2E Demo (HTTP mode)");
  console.log(`   Server: ${BASE_URL}`);
  console.log("=".repeat(55));
  console.log();

  const startTime = Date.now();

  async function api(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", ...opts.headers },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${path} → ${res.status}: ${body}`);
    }
    return res.json();
  }

  // Step 1: Register agents
  console.log("Step 1: Register Agents");
  const pReg = await api("/api/demo/provider/register", { method: "POST" });
  const cReg = await api("/api/demo/consumer/register", { method: "POST" });
  log("register", `Provider: ${pReg.name} (${pReg.did})`);
  log("register", `Consumer: ${cReg.name} (${cReg.did})`);

  // Step 2: Seed marketplace task
  console.log("Step 2: Seed Marketplace Task");
  const seeded = await api("/api/demo/marketplace/seed", { method: "POST" });
  log("seed", `Task: ${seeded.taskId}`, `Status: ${seeded.task.status}`);

  // Step 3: Provider runs full workflow
  console.log("Step 3: Provider Runs Full Workflow");
  const providerResult = await api(`/api/demo/provider/run-workflow/${seeded.taskId}`, { method: "POST" });
  log(
    "provider",
    `Claimed → Processed → Delivered`,
    `Risk: ${providerResult.analysis.riskLevel} | Report: ${providerResult.reportLength}b | Payment: ${providerResult.paymentStatus}`,
  );

  // Step 4: Consumer settles payment
  console.log("Step 4: Consumer Settles Payment");
  const payment = await api(`/api/demo/consumer/settle-payment/${seeded.taskId}`, { method: "POST" });
  log("settle", `Payment settled`, `TxId: ${payment.paymentTxId} | Status: ${payment.status}`);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("=".repeat(55));
  console.log(`✅ Full E2E workflow completed in ${elapsed}s (HTTP mode)`);
  console.log();
}

// ─── Entry point ──────────────────────────────────────

const useHttp = process.argv.includes("--http");

if (useHttp) {
  runHttpDemo().catch((err) => {
    console.error("❌ Demo failed:", err);
    process.exit(1);
  });
} else {
  runDirectDemo().catch((err) => {
    console.error("❌ Demo failed:", err);
    process.exit(1);
  });
}
