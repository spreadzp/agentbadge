import { describe, it, expect } from "vitest";
import { ethers } from "ethers";

import { verifyWalletOwnership } from "@agentbadge/passport";

describe("verifyWalletOwnership", () => {
  it("returns true for a valid signature", async () => {
    const wallet = ethers.Wallet.createRandom();
    const message = `Request Passport: ${wallet.address}`;
    const sig = await wallet.signMessage(message);

    const result = await verifyWalletOwnership(wallet.address, sig);
    expect(result).toBe(true);
  });

  it("returns false for an invalid signature", async () => {
    const fakeSig = "0x" + "00".repeat(65);
    const result = await verifyWalletOwnership("0.0.7654321", fakeSig);
    expect(result).toBe(false);
  });

  it("returns false for empty signature", async () => {
    const result = await verifyWalletOwnership("0.0.7654321", "");
    expect(result).toBe(false);
  });

  it("returns false for empty accountId", async () => {
    const result = await verifyWalletOwnership("", "0x1234");
    expect(result).toBe(false);
  });
});
