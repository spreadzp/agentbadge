import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BASE_DOMAIN,
  BUYER_ADDRESS,
  CCTP_MESSAGE_TRANSMITTER,
  CCTP_TOKEN_MESSENGER,
  MAX_FEE_MINOR,
  MIN_FINALITY_THRESHOLD,
  NET_FLOOR_MINOR,
  OPERATOR_ADDRESS,
  USDC_ARC,
  USDC_BASE,
  buildDepositForBurnArgs,
  classifyAttestation,
  computeMaxFee,
  assertNetFloor,
  assertSigner,
  defaultFundingStatePath,
  loadFundingState,
  parseCctpMessage,
  verifyAttestedMessage,
  parseUsdcAmount,
  saveFundingState,
  acquireLock,
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

describe("buildDepositForBurnArgs (post-H1: permissionless destinationCaller)", () => {
  it("targets Base domain 6, burnToken USDC@Arc, fast finality", () => {
    const args = buildDepositForBurnArgs(3_600_000n, BUYER_ADDRESS);
    expect(args[0]).toBe(3_600_000n);
    expect(args[1]).toBe(BASE_DOMAIN);
    expect(args[3]).toBe(USDC_ARC);
    expect(args[6]).toBe(MIN_FINALITY_THRESHOLD);
  });
  it("audit H1: destinationCaller = bytes32(0) — no single-key lock-in", () => {
    const args = buildDepositForBurnArgs(1_000_000n, BUYER_ADDRESS);
    expect(args[4]).toBe(`0x${"0".repeat(64)}`); // permissionless relay
    // mintRecipient still pinned to the buyer — funds can't be diverted
    expect(args[2].toLowerCase()).toBe(`0x${"0".repeat(24)}${BUYER_ADDRESS.slice(2).toLowerCase()}`);
  });
  it("maxFee default keeps the ≥3.5 net floor on 3.6 burn", () => {
    const args = buildDepositForBurnArgs(3_600_000n, BUYER_ADDRESS);
    expect(args[0] - args[5]).toBeGreaterThanOrEqual(3_500_000n);
  });
});

describe("fee helpers (audit nit: live fee + buffer, net floor)", () => {
  it("computeMaxFee adds 20% over the quote", () => {
    expect(computeMaxFee(10_000n)).toBe(12_000n);
    expect(computeMaxFee(0n)).toBe(0n);
  });
  it("assertNetFloor throws when fee would drop net below 3.5", () => {
    expect(() => assertNetFloor(3_600_000n, 50_000n)).not.toThrow();
    expect(() => assertNetFloor(3_600_000n, 150_000n)).toThrow(/net floor/);
    expect(() => assertNetFloor(3_600_000n, 100_001n)).toThrow(/net floor/);
  });
});

describe("assertSigner (audit C4)", () => {
  it("passes on match, throws on mismatch with both addresses in the message", () => {
    expect(() => assertSigner(BUYER_ADDRESS, BUYER_ADDRESS, "buyer")).not.toThrow();
    expect(() => assertSigner(BUYER_ADDRESS, "0x0000000000000000000000000000000000000001", "buyer"))
      .toThrow(/buyer signer mismatch/);
    expect(() => assertSigner(OPERATOR_ADDRESS, BUYER_ADDRESS, "Arc operator"))
      .toThrow(/Arc operator signer mismatch/);
  });
});

describe("classifyAttestation (audit M2: iris statuses pending|complete)", () => {
  it("ready only when status=complete AND message+real attestation hex present", () => {
    expect(classifyAttestation({ status: "complete", message: "0xabc", attestation: "0xdef" })).toBe("ready");
  });
  it("complete without hex attestation stays pending", () => {
    expect(classifyAttestation({ status: "complete", message: "0xabc", attestation: "PENDING" })).toBe("pending");
    expect(classifyAttestation({ status: "complete", message: "0xabc", attestation: "0x" })).toBe("pending");
    expect(classifyAttestation({ status: "pending_confirmations" })).toBe("pending");
    expect(classifyAttestation(undefined)).toBe("pending");
  });
  it("FAILED aborts — must never mint", () => {
    expect(classifyAttestation({ status: "failed" })).toBe("failed");
    expect(classifyAttestation({ status: "FAILED", message: "0xabc" })).toBe("failed");
  });
});

describe("CCTP V2 message decode + verify (audit M2)", () => {
  // Synthetic V2 message: header@0..148, BurnMessageV2 body@148.
  // sourceDomain=26@4, destDomain=6@8, destCaller=0@108, burnToken@152,
  // mintRecipient@184, amount@216.
  function buildMsg(over: Partial<{
    src: number; dst: number; rec: string; caller: string; amt: bigint;
    token: string; unpadRec: boolean;
  }> = {}): `0x${string}` {
    const buf = Buffer.alloc(376);
    buf.writeUInt32BE(over.src ?? 26, 4);
    buf.writeUInt32BE(over.dst ?? 6, 8);
    const tok = (over.token ?? USDC_ARC).slice(2).toLowerCase();
    buf.write(tok, 152 + 12, "hex"); // last 20 bytes of bytes32 @152
    const rec = (over.rec ?? BUYER_ADDRESS).slice(2).toLowerCase();
    if (over.unpadRec) {
      buf.write(rec, 184, "hex"); // left-aligned — high 12 bytes non-zero
    } else {
      buf.write(rec, 184 + 12, "hex"); // last 20 bytes of bytes32 @184
    }
    if (over.caller) buf.write(over.caller.slice(2).toLowerCase(), 108 + 12, "hex");
    const amt = over.amt ?? 3_600_000n;
    buf.write(amt.toString(16).padStart(64, "0"), 216, "hex");
    return `0x${buf.toString("hex")}` as `0x${string}`;
  }
  const expected = {
    recipient: BUYER_ADDRESS,
    sourceDomain: 26,
    destinationDomain: 6,
    amountMinor: "3600000",
  };
  it("decodes domains, caller, recipient, amount", () => {
    const d = parseCctpMessage(buildMsg())!;
    expect(d.sourceDomain).toBe(26);
    expect(d.destinationDomain).toBe(6);
    expect(d.destinationCaller).toBe("0x0000000000000000000000000000000000000000");
    expect(d.mintRecipient.toLowerCase()).toBe(BUYER_ADDRESS.toLowerCase());
    expect(d.amount).toBe(3_600_000n);
  });
  it("verifyAttestedMessage passes for the recorded burn", () => {
    expect(verifyAttestedMessage(buildMsg(), expected)).toEqual([]);
  });
  it("flags wrong recipient, domain, caller, amount", () => {
    const other = "0x000000000000000000000000000000000000dead";
    expect(verifyAttestedMessage(buildMsg({ rec: other }), expected).join(";")).toMatch(/mintRecipient/);
    expect(verifyAttestedMessage(buildMsg({ src: 10 }), expected).join(";")).toMatch(/sourceDomain/);
    expect(verifyAttestedMessage(buildMsg({ dst: 10 }), expected).join(";")).toMatch(/destinationDomain/);
    expect(verifyAttestedMessage(buildMsg({ caller: BUYER_ADDRESS }), expected).join(";")).toMatch(/destinationCaller/);
    expect(verifyAttestedMessage(buildMsg({ amt: 9_999_999n }), expected).join(";")).toMatch(/amount/);
  });
  it("audit N-10/N-11: flags wrong burnToken and unpadded byte32 words", () => {
    const usdcBase = USDC_BASE; // correct shape, wrong token
    expect(verifyAttestedMessage(buildMsg({ token: usdcBase }), expected).join(";")).toMatch(/burnToken/);
    expect(verifyAttestedMessage(buildMsg({ unpadRec: true }), expected).join(";")).toMatch(/non-zero upper 12 bytes/);
  });
  it("returns null on short/malformed payloads → verify reports decode failure", () => {
    expect(parseCctpMessage("0x1234" as `0x${string}`)).toBeNull();
    expect(verifyAttestedMessage("0x1234" as `0x${string}`, expected).join(";")).toMatch(/cannot decode/);
  });
});

describe("funding state file (audit C2: fail-closed + atomic)", () => {
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
  it("audit C2: corrupt JSON aborts instead of resetting to {}", () => {
    const dir = mkdtempSync(join(tmpdir(), "fund-"));
    const p = join(dir, "state.json");
    try {
      writeFileSync(p, "{corrupt", "utf8");
      expect(() => loadFundingState(p)).toThrow(/unreadable/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
  it("default path is absolute and lands in the 209 evidence dir", () => {
    expect(defaultFundingStatePath()).toContain("209-gec-buyer-route");
    expect(defaultFundingStatePath()).toContain("funding-state.json");
    expect(defaultFundingStatePath().startsWith("/")).toBe(true);
  });
});

describe("acquireLock (audit H6)", () => {
  it("serializes concurrent runs; releases cleanly", () => {
    const dir = mkdtempSync(join(tmpdir(), "fund-"));
    const p = join(dir, "state.json");
    try {
      const r1 = acquireLock(p);
      expect(() => acquireLock(p)).toThrow(/concurrently/);
      r1();
      const r2 = acquireLock(p); // released → can take again
      r2();
      expect(existsSync(`${p}.lock`)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("verified constants (evidence/cctp-addresses.md)", () => {
  it("Circle reference addresses are the only ones used", () => {
    expect(CCTP_TOKEN_MESSENGER).toBe("0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d");
    expect(CCTP_MESSAGE_TRANSMITTER).toBe("0x81D40F21F12A8F0E3252Bccb954D722d4c464B64");
    expect(USDC_ARC).toBe("0x3600000000000000000000000000000000000000");
    expect(USDC_BASE).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(BUYER_ADDRESS).toBe("0x3bF7bf14c839AC615F87cDeDe344dF01B9cFb89f");
    expect(OPERATOR_ADDRESS).toBe("0xcdd23d104AA4C10DE65F4DD0571eDfeC0458699d");
    expect(NET_FLOOR_MINOR).toBe(3_500_000n);
    expect(MAX_FEE_MINOR).toBe(50_000n);
  });
});
