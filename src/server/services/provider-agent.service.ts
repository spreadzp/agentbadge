/**
 * Medical Data Provider Agent.
 *
 * Automates the provider side of the medical data marketplace:
 * register → poll → claim → process → deliver → confirm payment.
 *
 * Demo mode: operates directly on marketplace cache (no HCS/DID verification).
 *
 * Reference: SLICE-11-5
 */

import { generateRandomMedicalData, type MedicalData } from "./medical-data.service";
import { analyzeMedicalData, type AnalysisResult } from "./medical-processor.service";
import { generateHtmlReport } from "./html-report.service";
import {
  marketUpsert as upsert,
  marketGet as getTask,
  listTasks,
  updateTaskStatus,
} from "@agentgate-hedera/passport";
import { submitTaskMessage, verifyA2ADid } from "@agentgate-hedera/hedera-core";
import type { CachedMarketTask } from "@agentgate-hedera/hedera-core";

export interface ProviderAgentConfig {
  providerDid: string;
  providerName: string;
  capabilities: string[];
  pollIntervalMs: number;
}

export const DEFAULT_PROVIDER_CONFIG: ProviderAgentConfig = {
  providerDid: "did:hcs:0.0.0:2",
  providerName: "Medical Data Analyst",
  capabilities: ["medical-analysis"],
  pollIntervalMs: 5000,
};

export interface ProcessResult {
  taskId: string;
  status: "claimed" | "processed" | "delivered";
  analysis: AnalysisResult;
  htmlReport: string;
}

export class MedicalDataProviderAgent {
  private config: ProviderAgentConfig;
  private registered = false;

  constructor(config: Partial<ProviderAgentConfig> = {}) {
    this.config = { ...DEFAULT_PROVIDER_CONFIG, ...config };
  }

  get did(): string {
    return this.config.providerDid;
  }

  get name(): string {
    return this.config.providerName;
  }

  get isRegistered(): boolean {
    return this.registered;
  }

  register(): { did: string; name: string; capabilities: string[] } {
    this.registered = true;
    return {
      did: this.config.providerDid,
      name: this.config.providerName,
      capabilities: this.config.capabilities,
    };
  }

  listenForTasks(): CachedMarketTask[] {
    if (!this.registered) {
      throw new Error("Agent must register before listening for tasks");
    }
    const { tasks } = listTasks({ capability: "medical-analysis", limit: 100 });
    return tasks.filter((t) => t.status === "posted");
  }

  async claimTask(taskId: string): Promise<CachedMarketTask> {
    if (!this.registered) {
      throw new Error("Agent must register before claiming tasks");
    }
    const task = getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== "posted") {
      throw new Error(`Task is ${task.status}, cannot claim`);
    }
    if (!task.capabilities.includes("medical-analysis")) {
      throw new Error("Task does not require medical-analysis capability");
    }

    // Passport verification (demo mode: non-blocking, continues on failure)
    try {
      const providerValid = await verifyA2ADid(this.config.providerDid);
      if (!providerValid) {
        console.warn(`[demo] Provider passport not verified: ${this.config.providerDid} — continuing in demo mode`);
      }
    } catch {
      console.warn(`[demo] Passport verification skipped for ${this.config.providerDid} — continuing in demo mode`);
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const message = {
      type: "task_claimed" as const,
      taskId,
      claimerDid: this.config.providerDid,
      timestamp,
    };
    let claimTxId: string | undefined;
    try {
      claimTxId = await submitTaskMessage(message);
    } catch {
      // HCS submit failed — continue with cache-only update for demo
    }

    updateTaskStatus(taskId, "claimed", { claimerDid: this.config.providerDid, claimTxId });
    const updated = getTask(taskId);
    return updated!;
  }

  processTask(taskId: string, medicalData: MedicalData): ProcessResult {
    if (!this.registered) {
      throw new Error("Agent must register before processing tasks");
    }
    const task = getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== "claimed") {
      throw new Error(`Task is ${task.status}, must be claimed before processing`);
    }

    const analysis = analyzeMedicalData(medicalData);
    const htmlReport = generateHtmlReport(medicalData, analysis);

    return {
      taskId,
      status: "processed",
      analysis,
      htmlReport,
    };
  }

  async deliverResult(taskId: string, htmlReport: string): Promise<CachedMarketTask> {
    if (!this.registered) {
      throw new Error("Agent must register before delivering results");
    }
    const task = getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== "claimed") {
      throw new Error(`Task is ${task.status}, must be claimed before delivering`);
    }

    // Ownership check: only the claimer can deliver
    if (task.claimerDid !== this.config.providerDid) {
      throw new Error(
        `Ownership check failed: task claimer is ${task.claimerDid}, but caller is ${this.config.providerDid}. Only the claimer can deliver.`,
      );
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const message = {
      type: "task_delivered" as const,
      taskId,
      resultBody: htmlReport.slice(0, 4000),
      timestamp,
    };
    let deliverTxId: string | undefined;
    try {
      deliverTxId = await submitTaskMessage(message);
    } catch {
      // HCS submit failed — continue with cache-only update for demo
    }

    const resultBody = htmlReport;
    const resultIpfs = undefined;

    updateTaskStatus(taskId, "delivered", { resultBody, resultIpfs, deliverTxId });
    const updated = getTask(taskId);
    return updated!;
  }

  checkPaymentStatus(taskId: string): "pending" | "completed" {
    const task = getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status === "completed") {
      return "completed";
    }
    return "pending";
  }

  async runFullWorkflow(taskId: string, medicalData?: MedicalData): Promise<ProcessResult & {
    claimedTask: CachedMarketTask;
    deliveredTask: CachedMarketTask;
    paymentStatus: "pending" | "completed";
  }> {
    const data = medicalData ?? generateRandomMedicalData();

    const claimedTask = await this.claimTask(taskId);
    const processed = this.processTask(taskId, data);
    const deliveredTask = await this.deliverResult(taskId, processed.htmlReport);
    const paymentStatus = this.checkPaymentStatus(taskId);

    return {
      ...processed,
      claimedTask,
      deliveredTask,
      paymentStatus,
    };
  }
}
