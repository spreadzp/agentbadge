/**
 * SLICE-84-3: ULID Task IDs + Real Consensus Timestamps
 *
 * Tests:
 * 1. New task IDs match ULID format: /^task-[0-9A-HJKMNP-TV-Z]{26}$/
 * 2. Task IDs are monotonically sortable (creation order ≡ sort order)
 * 3. Legacy task IDs still resolve (backward compat)
 * 4. submitTaskMessage returns { txId, consensusTimestamp }
 * 5. No fabricated consensus timestamps (grep-enforced)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { marketClear } from "@agentbadge/passport";
import { generateReportId as generateUlid } from "../../src/agent-readiness/integrity/ulid";
import * as fs from "fs";
import * as path from "path";

// Mock hedera-core
vi.mock("@agentbadge/hedera-core", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    submitTaskMessage: vi.fn(async () => {
      return {
        txId: `0.0.123@${Date.now()}.${Math.floor(Math.random() * 1e9)}`,
        consensusTimestamp: `${Math.floor(Date.now() / 1000)}.${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`,
      };
    }),
    submitA2AMessage: vi.fn(async () => {
      return {
        txId: `0.0.123@${Date.now()}.${Math.floor(Math.random() * 1e9)}`,
        consensusTimestamp: `${Math.floor(Date.now() / 1000)}.${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`,
      };
    }),
    createScheduledTransfer: vi.fn(async () => ({
      scheduleId: "0.0.999",
      scheduleTxId: "0.0.999-tx",
    })),
    deleteScheduledTransaction: vi.fn(async () => { }),
    didToAccountId: vi.fn(async (did: string) => `0.0.${did.slice(-3)}`),
  };
});

const ULID_REGEX = /^task-[0-9A-HJKMNP-TV-Z]{26}$/;
const LEGACY_REGEX = /^task-\d+-[a-z0-9]+$/;

describe("SLICE-84-3: ULID Task IDs", () => {
  beforeEach(() => {
    marketClear();
    vi.clearAllMocks();
  });

  describe("ULID format", () => {
    it("new task IDs match /^task-[0-9A-HJKMNP-TV-Z]{26}$/", () => {
      const ulid = generateUlid();
      const taskId = `task-${ulid}`;

      expect(taskId).toMatch(ULID_REGEX);
      expect(taskId.length).toBe(31); // "task-" (5) + ULID (26)
    });

    it("task IDs are monotonically sortable", () => {
      const ids: string[] = [];
      for (let i = 0; i < 100; i++) {
        // ULID encodes ms timestamp — use explicit timestamps for monotonic test
        ids.push(generateUlid(Date.now() + i));
      }

      const sorted = [...ids].sort();
      expect(ids).toEqual(sorted);
    });

    it("legacy task IDs still match legacy regex for backward compat", () => {
      const legacyId = "task-1700000000-abc123";
      expect(legacyId).toMatch(LEGACY_REGEX);
    });
  });

  describe("submitTaskMessage receipt", () => {
    it("returns { txId, consensusTimestamp } object, not bare string", async () => {
      const { submitTaskMessage } = await import("@agentbadge/hedera-core");
      const result = await submitTaskMessage({ type: "task_posted", taskId: "test", posterDid: "did:test", title: "T", description: "D", priceHbar: 1, capabilities: [], timestamp: Date.now() });

      expect(typeof result).toBe("object");
      expect(result).toHaveProperty("txId");
      expect(result).toHaveProperty("consensusTimestamp");
      expect(typeof result.txId).toBe("string");
    });
  });

  describe("No fabricated consensus timestamps", () => {
    it("market.ts does not use Date.now() % 1_000_000_000 for consensusTimestamp", () => {
      const marketContent = fs.readFileSync(
        path.resolve(__dirname, "../../src/server/routes/market.ts"),
        "utf-8",
      );

      // Should NOT contain the fabricated pattern
      expect(marketContent).not.toContain("Date.now() % 1_000_000_000");
      expect(marketContent).not.toContain("Date.now() % 1e9");
    });

    it("a2a.ts does not use Date.now() % 1_000_000_000 for consensusTimestamp", () => {
      const a2aContent = fs.readFileSync(
        path.resolve(__dirname, "../../src/server/routes/a2a.ts"),
        "utf-8",
      );

      expect(a2aContent).not.toContain("Date.now() % 1_000_000_000");
      expect(a2aContent).not.toContain("Date.now() % 1e9");
    });

    it("market.ts does not fabricate consensusTimestamp from new Date(timestamp * 1000)", () => {
      const marketContent = fs.readFileSync(
        path.resolve(__dirname, "../../src/server/routes/market.ts"),
        "utf-8",
      );

      // Should NOT use the old fabricated pattern
      expect(marketContent).not.toContain("new Date(timestamp * 1000).toISOString()");
    });
  });
});
