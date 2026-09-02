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
}));

import { marketUpsert as upsert, marketGet as getTask, listTasks, updateTaskStatus } from "@agentbadge/passport";
import { MedicalDataProviderAgent } from "../src/server/services/provider-agent.service";
import { generateRandomMedicalData } from "../src/server/services/medical-data.service";
import type { CachedMarketTask } from "@agentbadge/hedera-core";

function makeMockTask(overrides: Partial<CachedMarketTask> = {}): CachedMarketTask {
  return {
    taskId: "task-medical-123",
    posterDid: "did:hcs:0.0.0:1",
    title: "Medical Data Analysis Service",
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

describe("SLICE-11-5: MedicalDataProviderAgent", () => {
  beforeEach(() => {
    vi.mocked(upsert).mockReset();
    vi.mocked(getTask).mockReset();
    vi.mocked(listTasks).mockReset();
    vi.mocked(updateTaskStatus).mockReset();
  });

  describe("register()", () => {
    it("registers agent with correct metadata", () => {
      const agent = new MedicalDataProviderAgent();
      const result = agent.register();
      expect(agent.isRegistered).toBe(true);
      expect(result.did).toBe("did:hcs:0.0.0:2");
      expect(result.name).toBe("Medical Data Analyst");
      expect(result.capabilities).toContain("medical-analysis");
    });

    it("accepts custom config", () => {
      const agent = new MedicalDataProviderAgent({
        providerDid: "did:hcs:0.0.999:5",
        providerName: "Custom Analyst",
      });
      const result = agent.register();
      expect(result.did).toBe("did:hcs:0.0.999:5");
      expect(result.name).toBe("Custom Analyst");
    });
  });

  describe("listenForTasks()", () => {
    it("returns posted tasks with medical-analysis capability", () => {
      const agent = new MedicalDataProviderAgent();
      agent.register();
      const mockTasks = [makeMockTask({ status: "posted" }), makeMockTask({ taskId: "task-2", status: "posted" })];
      vi.mocked(listTasks).mockReturnValue({ tasks: mockTasks, total: 2 });

      const tasks = agent.listenForTasks();
      expect(tasks).toHaveLength(2);
      expect(tasks[0].capabilities).toContain("medical-analysis");
    });

    it("throws if not registered", () => {
      const agent = new MedicalDataProviderAgent();
      expect(() => agent.listenForTasks()).toThrow("must register");
    });

    it("filters out non-posted tasks", () => {
      const agent = new MedicalDataProviderAgent();
      agent.register();
      const mockTasks = [
        makeMockTask({ status: "posted" }),
        makeMockTask({ taskId: "task-2", status: "claimed" }),
      ];
      vi.mocked(listTasks).mockReturnValue({ tasks: mockTasks, total: 2 });
      const tasks = agent.listenForTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe("posted");
    });
  });

  describe("claimTask()", () => {
    it("claims a posted task and updates status to claimed", async () => {
      const agent = new MedicalDataProviderAgent();
      agent.register();
      const mockTask = makeMockTask({ status: "posted" });
      vi.mocked(getTask).mockReturnValue(mockTask);

      const claimed = await agent.claimTask("task-medical-123");
      expect(updateTaskStatus).toHaveBeenCalledWith("task-medical-123", "claimed", {
        claimerDid: "did:hcs:0.0.0:2",
      });
    });

    it("throws for non-existent task", async () => {
      const agent = new MedicalDataProviderAgent();
      agent.register();
      vi.mocked(getTask).mockReturnValue(undefined);
      await expect(() => agent.claimTask("nonexistent")).rejects.toThrow("not found");
    });

    it("throws for already claimed task", async () => {
      const agent = new MedicalDataProviderAgent();
      agent.register();
      vi.mocked(getTask).mockReturnValue(makeMockTask({ status: "claimed" }));
      await expect(() => agent.claimTask("task-medical-123")).rejects.toThrow("cannot claim");
    });

    it("throws for task without medical-analysis capability", async () => {
      const agent = new MedicalDataProviderAgent();
      agent.register();
      vi.mocked(getTask).mockReturnValue(makeMockTask({ capabilities: ["other"] }));
      await expect(() => agent.claimTask("task-medical-123")).rejects.toThrow("does not require");
    });

    it("throws if not registered", async () => {
      const agent = new MedicalDataProviderAgent();
      await expect(() => agent.claimTask("task-1")).rejects.toThrow("must register");
    });
  });

  describe("processTask()", () => {
    it("processes claimed task and returns analysis + HTML report", () => {
      const agent = new MedicalDataProviderAgent();
      agent.register();
      vi.mocked(getTask).mockReturnValue(makeMockTask({ status: "claimed" }));

      const data = generateRandomMedicalData();
      const result = agent.processTask("task-medical-123", data);
      expect(result.taskId).toBe("task-medical-123");
      expect(result.status).toBe("processed");
      expect(result.analysis.riskLevel).toBeDefined();
      expect(result.htmlReport).toContain("<!DOCTYPE html>");
    });

    it("throws for non-claimed task", () => {
      const agent = new MedicalDataProviderAgent();
      agent.register();
      vi.mocked(getTask).mockReturnValue(makeMockTask({ status: "posted" }));
      expect(() => agent.processTask("task-1", generateRandomMedicalData())).toThrow("must be claimed");
    });

    it("throws if not registered", () => {
      const agent = new MedicalDataProviderAgent();
      expect(() => agent.processTask("task-1", generateRandomMedicalData())).toThrow("must register");
    });
  });

  describe("deliverResult()", () => {
    it("delivers result and updates status to delivered", async () => {
      const agent = new MedicalDataProviderAgent();
      agent.register();
      vi.mocked(getTask).mockReturnValue(makeMockTask({ status: "claimed", claimerDid: "did:hcs:0.0.0:2" }));

      await agent.deliverResult("task-medical-123", "<html>report</html>");
      expect(updateTaskStatus).toHaveBeenCalledWith("task-medical-123", "delivered", {
        resultBody: "<html>report</html>",
        resultIpfs: undefined,
      });
    });

    it("stores full HTML report in resultBody for large reports", async () => {
      const agent = new MedicalDataProviderAgent();
      agent.register();
      vi.mocked(getTask).mockReturnValue(makeMockTask({ status: "claimed", claimerDid: "did:hcs:0.0.0:2" }));

      const largeReport = "x".repeat(5000);
      await agent.deliverResult("task-medical-123", largeReport);
      expect(updateTaskStatus).toHaveBeenCalledWith("task-medical-123", "delivered", {
        resultBody: largeReport,
        resultIpfs: undefined,
      });
    });

    it("throws for non-claimed task", async () => {
      const agent = new MedicalDataProviderAgent();
      agent.register();
      vi.mocked(getTask).mockReturnValue(makeMockTask({ status: "posted" }));
      await expect(() => agent.deliverResult("task-1", "<html></html>")).rejects.toThrow("must be claimed");
    });
  });

  describe("checkPaymentStatus()", () => {
    it("returns completed for completed task", () => {
      const agent = new MedicalDataProviderAgent();
      vi.mocked(getTask).mockReturnValue(makeMockTask({ status: "completed" }));
      expect(agent.checkPaymentStatus("task-1")).toBe("completed");
    });

    it("returns pending for delivered task", () => {
      const agent = new MedicalDataProviderAgent();
      vi.mocked(getTask).mockReturnValue(makeMockTask({ status: "delivered" }));
      expect(agent.checkPaymentStatus("task-1")).toBe("pending");
    });

    it("throws for non-existent task", () => {
      const agent = new MedicalDataProviderAgent();
      vi.mocked(getTask).mockReturnValue(undefined);
      expect(() => agent.checkPaymentStatus("task-1")).toThrow("not found");
    });
  });

  describe("runFullWorkflow()", () => {
    it("runs claim → process → deliver in sequence", async () => {
      const agent = new MedicalDataProviderAgent();
      agent.register();

      const postedTask = makeMockTask({ status: "posted" });
      const claimedTask = makeMockTask({ status: "claimed", claimerDid: "did:hcs:0.0.0:2" });
      const deliveredTask = makeMockTask({ status: "delivered", claimerDid: "did:hcs:0.0.0:2" });

      vi.mocked(getTask)
        .mockReturnValueOnce(postedTask)      // claimTask: check
        .mockReturnValueOnce(claimedTask)     // claimTask: get updated
        .mockReturnValueOnce(claimedTask)     // processTask: check
        .mockReturnValueOnce(claimedTask)     // deliverResult: check
        .mockReturnValueOnce(deliveredTask)   // deliverResult: get updated
        .mockReturnValueOnce(deliveredTask);  // checkPaymentStatus

      const result = await agent.runFullWorkflow("task-medical-123");
      expect(result.claimedTask.status).toBe("claimed");
      expect(result.deliveredTask.status).toBe("delivered");
      expect(result.analysis.riskLevel).toBeDefined();
      expect(result.htmlReport).toContain("<!DOCTYPE html>");
      expect(result.paymentStatus).toBe("pending");
      expect(updateTaskStatus).toHaveBeenCalledTimes(2);
    });

    it("auto-generates medical data if not provided", async () => {
      const agent = new MedicalDataProviderAgent();
      agent.register();

      const posted = makeMockTask({ status: "posted" });
      const claimed = makeMockTask({ status: "claimed", claimerDid: "did:hcs:0.0.0:2" });
      const delivered = makeMockTask({ status: "delivered", claimerDid: "did:hcs:0.0.0:2" });

      vi.mocked(getTask)
        .mockReturnValueOnce(posted)      // claimTask: check
        .mockReturnValueOnce(claimed)     // claimTask: get updated
        .mockReturnValueOnce(claimed)     // processTask: check
        .mockReturnValueOnce(claimed)     // deliverResult: check
        .mockReturnValueOnce(delivered)   // deliverResult: get updated
        .mockReturnValueOnce(delivered);  // checkPaymentStatus

      const result = await agent.runFullWorkflow("task-medical-123");
      expect(result.analysis.patientId).toBeDefined();
    });
  });
});
