/**
 * SLICE-67-6: Unit tests for order fulfillment logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@agentbadge/passport", () => ({
  issuePassport: vi.fn(),
}));

import { issuePassport } from "@agentbadge/passport";
import { fulfillOrder, resetProcessedSessions } from "../src/server/lib/order-fulfillment";

const mockedIssuePassport = vi.mocked(issuePassport);

function makeSession(overrides: Partial<Record<string, unknown>> = {}): any {
  return {
    id: `cs_test_${Math.random().toString(36).slice(2, 10)}`,
    metadata: {
      productId: "passport-bronze",
      tier: "bronze",
      accountId: "0.0.12345",
      name: "Test Agent",
      capabilities: '["verification","discovery"]',
      ...overrides,
    },
    customer_email: "test@example.com",
    customer_details: { email: "test@example.com" },
  };
}

describe("fulfillOrder — idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProcessedSessions();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips duplicate session IDs", async () => {
    mockedIssuePassport.mockResolvedValue({
      tokenId: "0.0.999",
      serialNumber: 1,
      did: "did:hcs:0.0.999:1",
      tier: "bronze",
      hashScanLink: "https://hashscan.io/testnet/token/0.0.999/1",
    });

    const session = makeSession();
    await fulfillOrder(session);
    await fulfillOrder(session); // duplicate

    expect(mockedIssuePassport).toHaveBeenCalledTimes(1);
  });
});

describe("fulfillOrder — passport mint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProcessedSessions();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls issuePassport with correct params from metadata", async () => {
    mockedIssuePassport.mockResolvedValue({
      tokenId: "0.0.999",
      serialNumber: 1,
      did: "did:hcs:0.0.999:1",
      tier: "bronze",
      hashScanLink: "https://hashscan.io/testnet/token/0.0.999/1",
    });

    const session = makeSession();
    await fulfillOrder(session);

    expect(mockedIssuePassport).toHaveBeenCalledTimes(1);
    const call = mockedIssuePassport.mock.calls[0];
    expect(call[0]).toBe("0.0.12345"); // accountId
    expect(call[1]).toBe(""); // signature — empty for Stripe
    expect(call[2]).toBe("bronze"); // tier
    expect(call[3]).toBe("Test Agent"); // name
    expect(call[4]).toEqual(["verification", "discovery"]); // capabilities
  });

  it("skips fulfillment when accountId is missing", async () => {
    const session = makeSession({ accountId: undefined });
    await fulfillOrder(session);

    expect(mockedIssuePassport).not.toHaveBeenCalled();
  });

  it("skips fulfillment when tier is missing", async () => {
    const session = makeSession({ tier: undefined });
    await fulfillOrder(session);

    expect(mockedIssuePassport).not.toHaveBeenCalled();
  });

  it("throws when issuePassport throws (for webhook retry)", async () => {
    mockedIssuePassport.mockRejectedValue(new Error("Hedera mint failed"));

    const session = makeSession();
    await expect(fulfillOrder(session)).rejects.toThrow("Hedera mint failed");
  });
});

describe("fulfillOrder — directory listing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProcessedSessions();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs fulfillment for directory listing", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => { });
    const session = makeSession({
      productId: "directory-listing",
      listingId: "listing-789",
    });
    await fulfillOrder(session);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("[fulfillDirectoryListing]"),
    );
    expect(mockedIssuePassport).not.toHaveBeenCalled();
  });

  it("skips when listingId is missing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => { });
    const session = makeSession({
      productId: "directory-listing",
      listingId: undefined,
    });
    await fulfillOrder(session);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Missing listingId"),
    );
  });
});

describe("fulfillOrder — unknown product", () => {
  it("logs warning for unknown productId", async () => {
    resetProcessedSessions();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { });
    const session = makeSession({ productId: "unknown-thing" });
    await fulfillOrder(session);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unknown productId"),
    );
  });
});
