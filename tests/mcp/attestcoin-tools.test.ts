import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  verifyCrossChainTaskHandler,
  listVerifiedTasksHandler,
  getTaskStatusHandler,
  registerAttestcoinTools,
  setAttestcoinToolConfig,
} from "../../src/mcp/attestcoin-tools";
import { createNamespace } from "@agentbadge/mcp";

const VALID_TX_HASH = "0x" + "a".repeat(64);

describe("Attestcoin MCP tools", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    setAttestcoinToolConfig({
      enabled: false,
      creditcoinRpcUrl: "http://localhost:8546",
      taskStateAddr: "0x" + "3".repeat(40),
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    setAttestcoinToolConfig({
      enabled: false,
      creditcoinRpcUrl: "http://localhost:8546",
      taskStateAddr: "0x" + "3".repeat(40),
    });
  });

  describe("when ATTESTCOIN_ENABLED=false", () => {
    it("verify_cross_chain_task returns error", async () => {
      const result = await verifyCrossChainTaskHandler({ txHash: VALID_TX_HASH });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not enabled");
    });

    it("list_verified_tasks returns error", async () => {
      const result = await listVerifiedTasksHandler({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not enabled");
    });

    it("get_task_status returns error", async () => {
      const result = await getTaskStatusHandler({ taskId: "1" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not enabled");
    });
  });

  describe("when ATTESTCOIN_ENABLED=true", () => {
    beforeEach(() => {
      setAttestcoinToolConfig({
        enabled: true,
        creditcoinRpcUrl: "http://localhost:8546",
        taskStateAddr: "0x" + "3".repeat(40),
      });
    });

    it("verify_cross_chain_task with valid txHash returns result", async () => {
      const result = await verifyCrossChainTaskHandler({ txHash: VALID_TX_HASH });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text as string);
      expect(parsed.txHash).toBe(VALID_TX_HASH);
      expect(parsed.verified).toBe(false);
      expect(parsed.taskId).toBe("0");
    });

    it("verify_cross_chain_task with invalid txHash returns validation error", async () => {
      const result = await verifyCrossChainTaskHandler({ txHash: "0xinvalid" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Validation error");
    });

    it("verify_cross_chain_task with missing txHash returns validation error", async () => {
      const result = await verifyCrossChainTaskHandler({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Validation error");
    });

    it("get_task_status with missing taskId returns validation error", async () => {
      const result = await getTaskStatusHandler({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Validation error");
    });
  });

  describe("registerAttestcoinTools", () => {
    it("registers 3 tools in a namespace", () => {
      const ns = createNamespace("test-attestcoin-" + Date.now());
      registerAttestcoinTools(ns);

      const tools = ns.listTools();
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("verify_cross_chain_task");
      expect(toolNames).toContain("list_verified_tasks");
      expect(toolNames).toContain("get_task_status");
      expect(toolNames.length).toBe(3);
    });
  });
});
