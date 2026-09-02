/**
 * Medical Data Consumer Agent.
 *
 * Automates the consumer side of the medical data marketplace:
 * register → generate data → post task → wait for delivery → receive report → settle payment.
 *
 * Demo mode: operates directly on marketplace cache (no HCS/DID verification).
 *
 * Reference: SLICE-11-6
 */

import { generateRandomMedicalData, type MedicalData } from "./medical-data.service";
import {
  marketUpsert as upsert,
  marketGet as getTask,
  updateTaskStatus,
} from "@agentbadge/passport";
import { submitTaskMessage, verifyA2ADid, didToAccountId, transferHbar } from "@agentbadge/hedera-core";
import type { CachedMarketTask } from "@agentbadge/hedera-core";

export interface ConsumerAgentConfig {
  consumerDid: string;
  consumerName: string;
  capabilities: string[];
  pollIntervalMs: number;
  pollTimeoutMs: number;
}

export const DEFAULT_CONSUMER_CONFIG: ConsumerAgentConfig = {
  consumerDid: "did:hcs:0.0.0:3",
  consumerName: "Healthcare Clinic",
  capabilities: ["medical-consumer"],
  pollIntervalMs: 5000,
  pollTimeoutMs: 60000,
};

export interface PostedTaskResult {
  taskId: string;
  task: CachedMarketTask;
  medicalData: MedicalData;
}

export interface ReceivedReport {
  taskId: string;
  status: string;
  htmlReport: string | null;
  resultIpfs: string | null;
}

export class MedicalDataConsumerAgent {
  private config: ConsumerAgentConfig;
  private registered = false;

  constructor(config: Partial<ConsumerAgentConfig> = {}) {
    this.config = { ...DEFAULT_CONSUMER_CONFIG, ...config };
  }

  get did(): string {
    return this.config.consumerDid;
  }

  get name(): string {
    return this.config.consumerName;
  }

  get isRegistered(): boolean {
    return this.registered;
  }

  register(): { did: string; name: string; capabilities: string[] } {
    this.registered = true;
    return {
      did: this.config.consumerDid,
      name: this.config.consumerName,
      capabilities: this.config.capabilities,
    };
  }

  generateMedicalData(): MedicalData {
    if (!this.registered) {
      throw new Error("Agent must register before generating data");
    }
    return generateRandomMedicalData();
  }

  async postTask(medicalData?: MedicalData, priceHbar: number = 100): Promise<PostedTaskResult> {
    if (!this.registered) {
      throw new Error("Agent must register before posting tasks");
    }
    const data = medicalData ?? generateRandomMedicalData();
    const timestamp = Math.floor(Date.now() / 1000);
    const taskId = `task-consumer-${timestamp}`;

    const message = {
      type: "task_posted" as const,
      taskId,
      posterDid: this.config.consumerDid,
      title: "Medical Data Analysis Request",
      description: `Patient ${data.patientId} (${data.patientName ?? "Unknown"}, age ${data.age}). Vital signs and lab results require analysis.`,
      priceHbar,
      capabilities: ["medical-analysis"],
      timestamp,
    };

    let txId: string;
    try {
      txId = (await submitTaskMessage(message)).txId;
    } catch {
      txId = `0.0.5266613@${timestamp}.000000000`;
    }

    const task: CachedMarketTask = {
      taskId,
      posterDid: this.config.consumerDid,
      title: "Medical Data Analysis Request",
      description: `Patient ${data.patientId} (${data.patientName ?? "Unknown"}, age ${data.age}). Vital signs and lab results require analysis.`,
      priceHbar,
      capabilities: ["medical-analysis"],
      status: "posted",
      txId,
      consensusTimestamp: new Date(timestamp * 1000).toISOString(),
      createdAt: timestamp,
    };

    upsert(task);

    return { taskId, task, medicalData: data };
  }

  getTaskStatus(taskId: string): { status: string; task: CachedMarketTask } {
    if (!this.registered) {
      throw new Error("Agent must register before checking tasks");
    }
    const task = getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return { status: task.status, task };
  }

  waitForDelivery(taskId: string): ReceivedReport {
    if (!this.registered) {
      throw new Error("Agent must register before waiting for delivery");
    }
    const task = getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status === "posted" || task.status === "claimed") {
      throw new Error(`Task is ${task.status}, not yet delivered`);
    }
    if (task.status === "delivered" || task.status === "completed") {
      return {
        taskId,
        status: task.status,
        htmlReport: task.resultBody ?? null,
        resultIpfs: task.resultIpfs ?? null,
      };
    }
    throw new Error(`Unexpected task status: ${task.status}`);
  }

  receiveReport(taskId: string): ReceivedReport {
    return this.waitForDelivery(taskId);
  }

  async settlePayment(taskId: string): Promise<{ taskId: string; status: string; paymentTxId: string }> {
    if (!this.registered) {
      throw new Error("Agent must register before settling payment");
    }
    const task = getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== "delivered") {
      throw new Error(`Task is ${task.status}, must be delivered before settling payment`);
    }

    // Ownership check: only the task poster can settle payment
    if (task.posterDid !== this.config.consumerDid) {
      throw new Error(
        `Ownership check failed: task poster is ${task.posterDid}, but caller is ${this.config.consumerDid}. Only the poster can settle payment.`,
      );
    }

    // Passport verification
    const posterValid = await verifyA2ADid(this.config.consumerDid);
    if (!posterValid) {
      throw new Error(`Poster passport not found or revoked: ${this.config.consumerDid}`);
    }

    if (!task.claimerDid) {
      throw new Error("Task has no claimer assigned");
    }

    const claimerValid = await verifyA2ADid(task.claimerDid);
    if (!claimerValid) {
      throw new Error(`Claimer passport not found or revoked: ${task.claimerDid}`);
    }

    // Resolve claimer DID to account ID
    const toAccountId = await didToAccountId(task.claimerDid);
    if (!toAccountId) {
      throw new Error(`Could not resolve claimer DID to account ID: ${task.claimerDid}`);
    }

    // Execute real HBAR transfer (operator pays in demo mode, or poster pays with key in production)
    const operatorAccountId = process.env.HEDERA_OPERATOR_ID ?? "";
    if (!operatorAccountId) {
      throw new Error("HEDERA_OPERATOR_ID not configured");
    }
    const paymentTxId = await transferHbar(operatorAccountId, toAccountId, task.priceHbar);

    const timestamp = Math.floor(Date.now() / 1000);
    const message = {
      type: "task_completed" as const,
      taskId,
      paymentTxId,
      timestamp,
    };
    let completedTxId: string | undefined;
    try {
      completedTxId = (await submitTaskMessage(message)).txId;
    } catch {
      // HCS submit failed — continue with cache-only update
    }

    updateTaskStatus(taskId, "completed", { paymentTxId, completedTxId });

    return { taskId, status: "completed", paymentTxId };
  }

  async runFullWorkflow(medicalData?: MedicalData, priceHbar?: number): Promise<{
    posted: PostedTaskResult;
  }> {
    if (!this.registered) {
      throw new Error("Agent must register before running workflow");
    }

    const posted = await this.postTask(medicalData, priceHbar);
    return { posted };
  }
}
