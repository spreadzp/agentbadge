import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createScheduledTransfer,
  signScheduledTransaction,
  deleteScheduledTransaction,
  getScheduleInfo,
  resetMockState,
} from "@agentgate-hedera/hedera-core";

const OPERATOR_ID = "0.0.5266613";
const OPERATOR_KEY =
  "302e020100300506032b6570042204207a1808c14f6e11817bc7c1b3ab9aa86bef1883e7da58046f8ab84021c30bfce7";

describe("SLICE-24-12: mock-hedera escrow counterparts", () => {
  beforeEach(() => {
    vi.stubEnv("MOCK_HEDERA", "true");
    vi.stubEnv("HEDERA_OPERATOR_ID", OPERATOR_ID);
    vi.stubEnv("HEDERA_OPERATOR_KEY", OPERATOR_KEY);
    vi.stubEnv("MARKET_TOPIC_ID", "0.0.888");
    vi.clearAllMocks();
    resetMockState();
  });

  describe("mock createScheduledTransfer", () => {
    it("returns valid scheduleId format", async () => {
      const result = await createScheduledTransfer("0.0.1001", "0.0.2002", 10);

      expect(result.scheduleId).toMatch(/^0\.0\.\d+$/);
      expect(result.scheduleTxId).toContain("@");
    });

    it("returns unique scheduleId on each call", async () => {
      const a = await createScheduledTransfer("0.0.1001", "0.0.2002", 5);
      const b = await createScheduledTransfer("0.0.1001", "0.0.2002", 5);

      expect(a.scheduleId).not.toBe(b.scheduleId);
    });

    it("scheduleTxId contains sender account", async () => {
      const result = await createScheduledTransfer("0.0.1001", "0.0.2002", 10);

      expect(result.scheduleTxId).toContain("0.0.1001");
    });
  });

  describe("mock signScheduledTransaction", () => {
    it("returns executed=true", async () => {
      const { scheduleId } = await createScheduledTransfer("0.0.1001", "0.0.2002", 10);
      const result = await signScheduledTransaction(scheduleId, OPERATOR_KEY);

      expect(result.executed).toBe(true);
      expect(result.txId).toContain("@");
    });

    it("throws on invalid scheduleId", async () => {
      await expect(signScheduledTransaction("", OPERATOR_KEY)).rejects.toThrow();
    });
  });

  describe("mock deleteScheduledTransaction", () => {
    it("returns deleted=true", async () => {
      const { scheduleId } = await createScheduledTransfer("0.0.1001", "0.0.2002", 10);
      const result = await deleteScheduledTransaction(scheduleId);

      expect(result.deleted).toBe(true);
      expect(result.scheduleId).toBe(scheduleId);
    });

    it("throws on invalid scheduleId", async () => {
      await expect(deleteScheduledTransaction("")).rejects.toThrow();
    });
  });

  describe("mock getScheduleInfo", () => {
    it("returns pending schedule by default", async () => {
      const { scheduleId } = await createScheduledTransfer("0.0.1001", "0.0.2002", 10);
      const info = await getScheduleInfo(scheduleId);

      expect(info).not.toBeNull();
      expect(info!.executed).toBe(false);
      expect(info!.deleted).toBe(false);
      expect(info!.signers).toEqual([]);
    });

    it("returns memo in schedule info", async () => {
      const { scheduleId } = await createScheduledTransfer("0.0.1001", "0.0.2002", 10);
      const info = await getScheduleInfo(scheduleId);

      expect(info!.memo).toBeTruthy();
    });
  });

  describe("resetMockState clears schedule counter", () => {
    it("scheduleId counter resets", async () => {
      const a = await createScheduledTransfer("0.0.1001", "0.0.2002", 10);
      const aNum = Number(a.scheduleId.split(".")[2]);

      resetMockState();

      const b = await createScheduledTransfer("0.0.1001", "0.0.2002", 10);
      const bNum = Number(b.scheduleId.split(".")[2]);

      expect(bNum).toBeLessThanOrEqual(aNum);
    });
  });
});
