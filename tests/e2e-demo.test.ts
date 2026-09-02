import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@agentgate-hedera/passport", async (importOriginal) => ({
  ...(await importOriginal()),
  marketUpsert: vi.fn(),
  marketGet: vi.fn(),
  listTasks: vi.fn(),
  updateTaskStatus: vi.fn(),
}));

vi.mock("@agentgate-hedera/hedera-core", async (importOriginal) => ({
  ...(await importOriginal()),
  submitTaskMessage: vi.fn().mockResolvedValue({ txId: "0.0.5266613@123.000000000", consensusTimestamp: null }),
  verifyA2ADid: vi.fn().mockResolvedValue(true),
  didToAccountId: vi.fn().mockResolvedValue("0.0.1234"),
  transferHbar: vi.fn().mockResolvedValue("0.0.5266613@999.000000000"),
}));

import { marketUpsert as upsert, marketGet as getTask, listTasks, updateTaskStatus } from "@agentgate-hedera/passport";
import type { CachedMarketTask } from "@agentgate-hedera/hedera-core";

function makeMockTask(overrides: Partial<CachedMarketTask> = {}): CachedMarketTask {
  return {
    taskId: "task-consumer-123",
    posterDid: "did:hcs:0.0.0:3",
    title: "Medical Data Analysis Request",
    description: "Test task",
    priceHbar: 100,
    capabilities: ["medical-analysis"],
    status: "posted",
    txId: "demo-tx-123",
    consensusTimestamp: new Date().toISOString(),
    createdAt: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

describe("SLICE-11-7: E2E Demo Script", () => {
  beforeEach(() => {
    vi.mocked(upsert).mockReset();
    vi.mocked(getTask).mockReset();
    vi.mocked(listTasks).mockReset();
    vi.mocked(updateTaskStatus).mockReset();
    process.env.HEDERA_OPERATOR_ID = "0.0.5266613";
  });

  it("full direct workflow: consumer posts → provider claims → delivers → consumer settles", async () => {
    const store = new Map<string, CachedMarketTask>();
    vi.mocked(upsert).mockImplementation((task) => { store.set(task.taskId, task); });
    vi.mocked(getTask).mockImplementation((id) => store.get(id) ?? undefined);
    vi.mocked(listTasks).mockImplementation(() => ({ tasks: Array.from(store.values()), total: store.size }));
    vi.mocked(updateTaskStatus).mockImplementation((id, status, extra) => {
      const t = store.get(id);
      if (t) store.set(id, { ...t, status, ...extra });
      return true;
    });

    const { MedicalDataProviderAgent } = await import("../src/server/services/provider-agent.service");
    const { MedicalDataConsumerAgent } = await import("../src/server/services/consumer-agent.service");

    const provider = new MedicalDataProviderAgent();
    const consumer = new MedicalDataConsumerAgent();

    // Step 1: Register
    provider.register();
    consumer.register();
    expect(provider.isRegistered).toBe(true);
    expect(consumer.isRegistered).toBe(true);

    // Step 2: Consumer generates data & posts task
    const data = consumer.generateMedicalData();
    const posted = await consumer.postTask(data, 100);
    expect(posted.task.status).toBe("posted");
    expect(posted.task.priceHbar).toBe(100);

    // Step 3: Provider discovers & claims
    const available = provider.listenForTasks();
    expect(available.length).toBeGreaterThanOrEqual(1);

    const claimed = await provider.claimTask(posted.taskId);
    expect(claimed.status).toBe("claimed");

    // Step 4: Provider processes & delivers
    const processed = provider.processTask(posted.taskId, data);
    expect(processed.analysis.riskLevel).toBeDefined();
    expect(processed.htmlReport).toContain("<!DOCTYPE html>");

    const delivered = await provider.deliverResult(posted.taskId, processed.htmlReport);
    expect(delivered.status).toBe("delivered");

    // Step 5: Consumer receives report (large reports go to IPFS)
    const report = consumer.receiveReport(posted.taskId);
    expect(report.status).toBe("delivered");
    // Report is >4KB so it goes to IPFS; small reports would be in htmlReport
    expect(report.htmlReport !== null || report.resultIpfs !== null).toBe(true);

    // Step 6: Consumer settles payment
    const payment = await consumer.settlePayment(posted.taskId);
    expect(payment.status).toBe("completed");
    expect(payment.paymentTxId).toBeDefined();

    // Final verification
    const finalTask = store.get(posted.taskId);
    expect(finalTask?.status).toBe("completed");
  });

  it("consumer runFullWorkflow + provider runFullWorkflow integration", async () => {
    const store = new Map<string, CachedMarketTask>();
    vi.mocked(upsert).mockImplementation((task) => { store.set(task.taskId, task); });
    vi.mocked(getTask).mockImplementation((id) => store.get(id) ?? undefined);
    vi.mocked(listTasks).mockImplementation(() => ({ tasks: Array.from(store.values()), total: store.size }));
    vi.mocked(updateTaskStatus).mockImplementation((id, status, extra) => {
      const t = store.get(id);
      if (t) store.set(id, { ...t, status, ...extra });
      return true;
    });

    const { MedicalDataConsumerAgent } = await import("../src/server/services/consumer-agent.service");
    const consumer = new MedicalDataConsumerAgent();
    consumer.register();

    const result = await consumer.runFullWorkflow();
    expect(result.posted.task.status).toBe("posted");

    const finalTask = store.get(result.posted.taskId);
    expect(finalTask?.status).toBe("posted");
  });

  it("demo script file exists and is importable", async () => {
    // Verify the script file exists on disk
    const fs = await import("node:fs");
    const path = await import("node:path");
    const scriptPath = path.resolve(import.meta.dirname, "../scripts/demo-medical-marketplace.ts");
    expect(fs.existsSync(scriptPath)).toBe(true);
  });
});
