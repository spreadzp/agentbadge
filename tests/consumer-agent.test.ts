import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@agentbadge/passport", async (importOriginal) => ({
  ...(await importOriginal()),
  marketUpsert: vi.fn(),
  marketGet: vi.fn(),
  listTasks: vi.fn(),
  updateTaskStatus: vi.fn(),
}));

vi.mock("@agentbadge/hedera-core", async (importOriginal) => ({
  ...(await importOriginal()),
  submitTaskMessage: vi.fn().mockResolvedValue({ txId: "0.0.5266613@123.000000000", consensusTimestamp: null }),
  verifyA2ADid: vi.fn().mockResolvedValue(true),
  didToAccountId: vi.fn().mockResolvedValue("0.0.1234"),
  transferHbar: vi.fn().mockResolvedValue("0.0.5266613@999.000000000"),
}));

import { marketUpsert as upsert, marketGet as getTask, updateTaskStatus } from "@agentbadge/passport";
import { MedicalDataConsumerAgent } from "../src/server/services/consumer-agent.service";
import { generateRandomMedicalData } from "../src/server/services/medical-data.service";
import type { CachedMarketTask } from "@agentbadge/hedera-core";

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

describe("SLICE-11-6: MedicalDataConsumerAgent", () => {
  beforeEach(() => {
    vi.mocked(upsert).mockReset();
    vi.mocked(getTask).mockReset();
    vi.mocked(updateTaskStatus).mockReset();
    process.env.HEDERA_OPERATOR_ID = "0.0.5266613";
  });

  describe("register()", () => {
    it("registers agent with correct metadata", () => {
      const agent = new MedicalDataConsumerAgent();
      const result = agent.register();
      expect(agent.isRegistered).toBe(true);
      expect(result.did).toBe("did:hcs:0.0.0:3");
      expect(result.name).toBe("Healthcare Clinic");
      expect(result.capabilities).toContain("medical-consumer");
    });

    it("accepts custom config", () => {
      const agent = new MedicalDataConsumerAgent({
        consumerDid: "did:hcs:0.0.999:10",
        consumerName: "Custom Clinic",
      });
      const result = agent.register();
      expect(result.did).toBe("did:hcs:0.0.999:10");
      expect(result.name).toBe("Custom Clinic");
    });
  });

  describe("generateMedicalData()", () => {
    it("generates random medical data", () => {
      const agent = new MedicalDataConsumerAgent();
      agent.register();
      const data = agent.generateMedicalData();
      expect(data.patientId).toBeDefined();
      expect(data.vitalSigns).toBeDefined();
      expect(data.labResults).toBeDefined();
    });

    it("throws if not registered", () => {
      const agent = new MedicalDataConsumerAgent();
      expect(() => agent.generateMedicalData()).toThrow("must register");
    });
  });

  describe("postTask()", () => {
    it("posts a task with medical data and 100 HBAR price", async () => {
      const agent = new MedicalDataConsumerAgent();
      agent.register();
      const data = generateRandomMedicalData();
      const result = await agent.postTask(data, 100);
      expect(result.taskId).toMatch(/^task-consumer-/);
      expect(result.task.priceHbar).toBe(100);
      expect(result.task.capabilities).toContain("medical-analysis");
      expect(result.task.status).toBe("posted");
      expect(result.task.posterDid).toBe("did:hcs:0.0.0:3");
      expect(result.medicalData.patientId).toBe(data.patientId);
      expect(upsert).toHaveBeenCalledTimes(1);
    });

    it("auto-generates medical data if not provided", async () => {
      const agent = new MedicalDataConsumerAgent();
      agent.register();
      const result = await agent.postTask();
      expect(result.medicalData.patientId).toBeDefined();
    });

    it("throws if not registered", async () => {
      const agent = new MedicalDataConsumerAgent();
      await expect(() => agent.postTask()).rejects.toThrow("must register");
    });
  });

  describe("getTaskStatus()", () => {
    it("returns status and task", () => {
      const agent = new MedicalDataConsumerAgent();
      agent.register();
      vi.mocked(getTask).mockReturnValue(makeMockTask({ status: "claimed" }));
      const result = agent.getTaskStatus("task-1");
      expect(result.status).toBe("claimed");
    });

    it("throws for non-existent task", () => {
      const agent = new MedicalDataConsumerAgent();
      agent.register();
      vi.mocked(getTask).mockReturnValue(undefined);
      expect(() => agent.getTaskStatus("nonexistent")).toThrow("not found");
    });
  });

  describe("waitForDelivery() / receiveReport()", () => {
    it("returns HTML report for delivered task", () => {
      const agent = new MedicalDataConsumerAgent();
      agent.register();
      vi.mocked(getTask).mockReturnValue(makeMockTask({
        status: "delivered",
        resultBody: "<html>report</html>",
      }));
      const report = agent.receiveReport("task-1");
      expect(report.status).toBe("delivered");
      expect(report.htmlReport).toBe("<html>report</html>");
    });

    it("returns null htmlReport for IPFS-only delivery", () => {
      const agent = new MedicalDataConsumerAgent();
      agent.register();
      vi.mocked(getTask).mockReturnValue(makeMockTask({
        status: "delivered",
        resultBody: undefined,
        resultIpfs: "ipfs://abc",
      }));
      const report = agent.receiveReport("task-1");
      expect(report.htmlReport).toBeNull();
      expect(report.resultIpfs).toBe("ipfs://abc");
    });

    it("throws for non-delivered task", () => {
      const agent = new MedicalDataConsumerAgent();
      agent.register();
      vi.mocked(getTask).mockReturnValue(makeMockTask({ status: "posted" }));
      expect(() => agent.receiveReport("task-1")).toThrow("not yet delivered");
    });

    it("throws for non-existent task", () => {
      const agent = new MedicalDataConsumerAgent();
      agent.register();
      vi.mocked(getTask).mockReturnValue(undefined);
      expect(() => agent.receiveReport("task-1")).toThrow("not found");
    });
  });

  describe("settlePayment()", () => {
    it("settles payment for delivered task", async () => {
      const agent = new MedicalDataConsumerAgent();
      agent.register();
      vi.mocked(getTask).mockReturnValue(makeMockTask({
        status: "delivered",
        claimerDid: "did:hcs:0.0.0:2",
      }));
      const result = await agent.settlePayment("task-1");
      expect(result.status).toBe("completed");
      expect(result.paymentTxId).toBeDefined();
      expect(updateTaskStatus).toHaveBeenCalledWith("task-1", "completed", expect.objectContaining({
        paymentTxId: expect.any(String),
      }));
    });

    it("throws for non-delivered task", async () => {
      const agent = new MedicalDataConsumerAgent();
      agent.register();
      vi.mocked(getTask).mockReturnValue(makeMockTask({ status: "posted" }));
      await expect(() => agent.settlePayment("task-1")).rejects.toThrow("must be delivered");
    });

    it("throws when caller is not the poster", async () => {
      const agent = new MedicalDataConsumerAgent();
      agent.register();
      vi.mocked(getTask).mockReturnValue(makeMockTask({
        status: "delivered",
        posterDid: "did:hcs:0.0.0:99",
        claimerDid: "did:hcs:0.0.0:2",
      }));
      await expect(() => agent.settlePayment("task-1")).rejects.toThrow("Ownership check failed");
    });

    it("throws for non-existent task", async () => {
      const agent = new MedicalDataConsumerAgent();
      agent.register();
      vi.mocked(getTask).mockReturnValue(undefined);
      await expect(() => agent.settlePayment("task-1")).rejects.toThrow("not found");
    });
  });

  describe("runFullWorkflow()", () => {
    it("posts a task to the marketplace", async () => {
      const agent = new MedicalDataConsumerAgent();
      agent.register();

      const store = new Map<string, CachedMarketTask>();
      vi.mocked(upsert).mockImplementation((task) => { store.set(task.taskId, task); });
      vi.mocked(getTask).mockImplementation((id) => store.get(id) ?? undefined);
      vi.mocked(updateTaskStatus).mockImplementation((id, status, extra) => {
        const t = store.get(id);
        if (t) store.set(id, { ...t, status, ...extra });
        return true;
      });

      const result = await agent.runFullWorkflow();
      expect(result.posted.taskId).toMatch(/^task-consumer-/);
      expect(result.posted.task.status).toBe("posted");
    });

    it("accepts custom medical data", async () => {
      const agent = new MedicalDataConsumerAgent();
      agent.register();

      const store = new Map<string, CachedMarketTask>();
      vi.mocked(upsert).mockImplementation((task) => { store.set(task.taskId, task); });
      vi.mocked(getTask).mockImplementation((id) => store.get(id) ?? undefined);
      vi.mocked(updateTaskStatus).mockImplementation((id, status, extra) => {
        const t = store.get(id);
        if (t) store.set(id, { ...t, status, ...extra });
        return true;
      });

      const data = generateRandomMedicalData();
      const result = await agent.runFullWorkflow(data);
      expect(result.posted.medicalData.patientId).toBe(data.patientId);
    });

    it("throws if not registered", async () => {
      const agent = new MedicalDataConsumerAgent();
      await expect(() => agent.runFullWorkflow()).rejects.toThrow("must register");
    });
  });
});
