import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BASE_DOMAIN,
  BUYER_ADDRESS,
  CCTP_MESSAGE_TRANSMITTER,
  CCTP_TOKEN_MESSENGER,
  MAX_FEE_MINOR,
  MIN_FINALITY_THRESHOLD,
  USDC_ARC,
  buildDepositForBurnArgs,
  classifyAttestation,
  defaultFundingStatePath,
  loadFundingState,
  parseUsdcAmount,
  saveFundingState,
  type FundingState,
} from "../scripts/gec-funding-cctp.mts";

describe("parseUsdcAmount", () => {
  it("parses the planned 3.6 USDC burn → 3,600,000 microUSDC", () => {
    expect(parseUsdcAmount("3.6")).toBe(3_600_000n);
  });
  it("rejects over the 4.0 USDC hard cap (D-209-4)", () => {
    expect(() => parseUsdcAmount("4.000001")).toThrow(/hard cap/);
    expect(() => parseUsdcAmount("5")).toThrow(/hard cap/);
  });
  it("accepts exactly the cap", () => {
    expect(parseUsdcAmount("4.0")).toBe(4_000_000n);
  });
  it("rejects zero, negative, junk", () => {
    expect(() => parseUsdcAmount("0")).toThrow(/> 0/);
    expect(() => parseUsdcAmount("-1")).toThrow(/bad USDC/);
    expect(() => parseUsdcAmount("abc")).toThrow(/bad USDC/);
    expect(() => parseUsdcAmount("1.1234567")).toThrow(/bad USDC/); // >6 decimals
  });
});

describe("buildDepositForBurnArgs", () => {
  it("targets Base domain 6, burnToken USDC@Arc, fast finality", () => {
    const args = buildDepositForBurnArgs(3_600_000n, BUYER_ADDRESS);
    expect(args[0]).toBe(3_600_000n);
    expect(args[1]).toBe(BASE_DOMAIN);
    expect(args[3]).toBe(USDC_ARC);
    expect(args[5]).toBe(MAX_FEE_MINOR);
    expect(args[6]).toBe(MIN_FINALITY_THRESHOLD);
  });
  it("destinationCaller = recipient (buyer-only mint — no third-party interference)", () => {
    const args = buildDepositForBurnArgs(1_000_000n, BUYER_ADDRESS);
    // bytes32-left-padded 20-byte address
    expect(args[2].toLowerCase()).toBe(`0x${"0".repeat(24)}${BUYER_ADDRESS.slice(2).toLowerCase()}`);
    expect(args[4]).toBe(args[2]);
    expect(args[4]).not.toBe(`0x${"0".repeat(64)}`); // NOT anyone-can-mint
  });
  it("maxFee stays within the fee-calc budget (net ≥3.5 on 3.6 burn)", () => {
    const args = buildDepositForBurnArgs(3_600_000n, BUYER_ADDRESS);
    expect(args[0] - args[5]).toBeGreaterThanOrEqual(3_500_000n);
  });
});

describe("classifyAttestation", () => {
  it("ready only when message+real attestation hex present", () => {
    expect(classifyAttestation({ status: "complete", message: "0xabc", attestation: "0xdef" })).toBe("ready");
  });
  it("PENDING attestation stays pending", () => {
    expect(classifyAttestation({ status: "complete", message: "0xabc", attestation: "PENDING" })).toBe("pending");
    expect(classifyAttestation({ status: "pending_confirmations" })).toBe("pending");
    expect(classifyAttestation(undefined)).toBe("pending");
  });
  it("FAILED aborts — must never mint", () => {
    expect(classifyAttestation({ status: "failed" })).toBe("failed");
    expect(classifyAttestation({ status: "FAILED", message: "0xabc" })).toBe("failed");
  });
});

describe("funding state file", () => {
  it("missing file → empty state; roundtrips burn/mint txs", () => {
    const dir = mkdtempSync(join(tmpdir(), "fund-"));
    const p = join(dir, "state.json");
    try {
      expect(loadFundingState(p)).toEqual({});
      const s: FundingState = {
        burn_tx: "0x" + "a".repeat(64),
        amount_minor: "3600000",
        recipient: BUYER_ADDRESS,
      };
      saveFundingState(p, s);
      const back = loadFundingState(p);
      expect(back.burn_tx).toBe(s.burn_tx);
      expect(back.amount_minor).toBe("3600000");
      expect(back.mint_tx).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
  it("default path lands in the 209 evidence dir", () => {
    expect(defaultFundingStatePath()).toContain("209-gec-buyer-route");
    expect(defaultFundingStatePath()).toContain("funding-state.json");
  });
});

describe("verified constants (evidence/cctp-addresses.md)", () => {
  it("Circle reference addresses are the only ones used", () => {
    expect(CCTP_TOKEN_MESSENGER).toBe("0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d");
    expect(CCTP_MESSAGE_TRANSMITTER).toBe("0x81D40F21F12A8F0E3252Bccb954D722d4c464B64");
    expect(USDC_ARC).toBe("0x3600000000000000000000000000000000000000");
    expect(BUYER_ADDRESS).toBe("0x3bF7bf14c839AC615F87cDeDe344dF01B9cFb89f");
  });
});
