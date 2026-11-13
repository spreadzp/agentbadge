/**
 * Audit 222-7 / H-8: self-serve USDC must fail closed unless the Arc
 * on-chain monitor is enabled+configured, and must expose arc-only
 * networks (Base/Solana instructions are unmonitored money).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadPayments } from "../../src/config/env/payments";

const ARC_TREASURY = "0x1000000000000000000000000000000000000aaa";
const BASE_TREASURY = "0x2000000000000000000000000000000000000bbb";
const USDC_ADDR = "0x3600000000000000000000000000000000000000";

function baseEnv() {
  delete process.env.ARC_USDC_TREASURY;
  delete process.env.EVM_USDC_ADDRESS;
  delete process.env.BASE_USDC_TREASURY;
  delete process.env.BASE_USDC_ADDRESS;
  delete process.env.SOLANA_TREASURY_ADDRESS;
  delete process.env.SOLANA_USDC_MINT;
  delete process.env.USDC_MONITOR_ENABLED;
  delete process.env.ARC_RPC_URL;
  delete process.env.PAYMENTS_USDC_SELF_SERVE;
}

function withArc() {
  process.env.ARC_USDC_TREASURY = ARC_TREASURY;
  process.env.EVM_USDC_ADDRESS = USDC_ADDR;
}

function withMonitor() {
  process.env.USDC_MONITOR_ENABLED = "true";
  process.env.ARC_RPC_URL = "https://rpc.arc.example";
}

describe("audit-222-7 H-8: self-serve gating", () => {
  const orig = { ...process.env };
  beforeEach(() => baseEnv());
  afterEach(() => {
    process.env = { ...orig };
  });

  it("SELF_SERVE without monitor → config error, no instructions exposed", () => {
    withArc();
    process.env.PAYMENTS_USDC_SELF_SERVE = "true";
    const errors: string[] = [];
    loadPayments(errors);
    expect(errors.some((e) => e.includes("PAYMENTS_USDC_SELF_SERVE"))).toBe(
      true,
    );
  });

  it("SELF_SERVE + monitor + arc network → enabled, no error", () => {
    withArc();
    withMonitor();
    process.env.PAYMENTS_USDC_SELF_SERVE = "true";
    const errors: string[] = [];
    const cfg = loadPayments(errors);
    expect(errors.some((e) => e.includes("PAYMENTS_USDC_SELF_SERVE"))).toBe(
      false,
    );
    expect(cfg.usdcSelfServeEnabled).toBe(true);
    expect(cfg.usdcMonitor.enabled).toBe(true);
  });

  it("SELF_SERVE filters exposed networks to arc-labeled only", () => {
    withArc();
    withMonitor();
    process.env.BASE_USDC_TREASURY = BASE_TREASURY;
    process.env.BASE_USDC_ADDRESS = USDC_ADDR;
    process.env.SOLANA_TREASURY_ADDRESS = "SoLTreasury111111111111111111111111";
    process.env.PAYMENTS_USDC_SELF_SERVE = "true";
    const errors: string[] = [];
    const cfg = loadPayments(errors);
    const labels = Object.values(cfg.usdcNetworks).map((n) => n.label);
    expect(labels).toEqual(["arc"]);
  });

  it("non-self-serve keeps all configured networks", () => {
    withArc();
    process.env.BASE_USDC_TREASURY = BASE_TREASURY;
    process.env.BASE_USDC_ADDRESS = USDC_ADDR;
    const errors: string[] = [];
    const cfg = loadPayments(errors);
    const labels = Object.values(cfg.usdcNetworks)
      .map((n) => n.label)
      .sort();
    expect(labels).toEqual(["arc", "base"]);
  });
});
