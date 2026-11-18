/**
 * Audit 222-7 (H-8): PAYMENTS_USDC_SELF_SERVE must never issue
 * instructions for rails the monitor cannot confirm.
 */

import { describe, expect, it, afterEach } from "vitest";
import { loadPayments } from "../../src/config/env/payments";

const ARC_TREASURY = "0x1111111111111111111111111111111111111111";
const BASE_TREASURY = "0x2222222222222222222222222222222222222222";
const USDC_ADDR = "0x3600000000000000000000000000000000000000";

const saved = { ...process.env };

function env(vars: Record<string, string | undefined>) {
  // Reset the keys this suite touches, then overlay.
  for (const k of [
    "ARC_USDC_TREASURY",
    "BASE_USDC_TREASURY",
    "CIRCLE_TREASURY_ADDRESS",
    "EVM_USDC_ADDRESS",
    "BASE_USDC_ADDRESS",
    "SOLANA_TREASURY_ADDRESS",
    "USDC_MONITOR_ENABLED",
    "ARC_RPC_URL",
    "PAYMENTS_USDC_SELF_SERVE",
  ]) {
    delete process.env[k];
  }
  Object.assign(process.env, vars);
}

afterEach(() => {
  process.env = { ...saved };
});

describe("audit-222-7 (H-8): self-serve gating", () => {
  it("self-serve WITHOUT a running monitor → config error", () => {
    env({
      ARC_USDC_TREASURY: ARC_TREASURY,
      EVM_USDC_ADDRESS: USDC_ADDR,
      PAYMENTS_USDC_SELF_SERVE: "true",
    });
    const errors: string[] = [];
    loadPayments(errors);
    expect(errors.join(" ")).toContain("unmonitored rails");
  });

  it("self-serve + monitor → only arc-labeled networks are exposed", () => {
    env({
      ARC_USDC_TREASURY: ARC_TREASURY,
      EVM_USDC_ADDRESS: USDC_ADDR,
      BASE_USDC_TREASURY: BASE_TREASURY,
      BASE_USDC_ADDRESS: USDC_ADDR,
      USDC_MONITOR_ENABLED: "true",
      ARC_RPC_URL: "https://rpc.arc.example",
      PAYMENTS_USDC_SELF_SERVE: "true",
    });
    const errors: string[] = [];
    const cfg = loadPayments(errors);
    expect(errors).toEqual([]);
    expect(cfg.usdcMonitor.enabled).toBe(true);
    const labels = Object.values(cfg.usdcNetworks).map((n) => n.label);
    expect(labels).toEqual(["arc"]);
  });

  it("self-serve OFF → all configured networks stay exposed", () => {
    env({
      ARC_USDC_TREASURY: ARC_TREASURY,
      EVM_USDC_ADDRESS: USDC_ADDR,
      BASE_USDC_TREASURY: BASE_TREASURY,
      BASE_USDC_ADDRESS: USDC_ADDR,
    });
    const errors: string[] = [];
    const cfg = loadPayments(errors);
    expect(errors).toEqual([]);
    const labels = Object.values(cfg.usdcNetworks).map((n) => n.label);
    expect(labels.sort()).toEqual(["arc", "base"]);
  });
});
