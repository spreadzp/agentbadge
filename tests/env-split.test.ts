/**
 * EPIC-173 SLICE-173-1: signing-authority env split.
 *
 * settleKey()  → ARC_SETTLE_KEY (money)   — ARC_EVALUATOR_KEY deprecated-map
 * opsKey()     → ARC_OPS_KEY    (ops)     — ARC_EVALUATOR_KEY deprecated-map
 * reputation   → ARC_VERDICT_SIGNER_KEY   — untouched (eaas.ts section)
 *
 * DEPLOYER_PRIVATE_KEY fallback is dead: a dev key must never resolve a
 * server authority (D-173-1, D-173-5).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  opsKey,
  settleKey,
  signerBackend,
  warnKeyOverlap,
} from "../src/server/lib/eaas/keys";
import { serverRoleAddress } from "../src/server/lib/venue/lifecycle-sign";
import { logger } from "@agentbadge/passport/logger";

const K1 = ("0x" + "11".repeat(32)) as `0x${string}`;
const K2 = ("0x" + "22".repeat(32)) as `0x${string}`;
const K3 = ("0x" + "33".repeat(32)) as `0x${string}`;
const K4 = ("0x" + "44".repeat(32)) as `0x${string}`;

const AUTH_VARS = [
  "ARC_SETTLE_KEY",
  "ARC_OPS_KEY",
  "ARC_EVALUATOR_KEY",
  "ARC_VENUE_CLIENT_KEY",
  "ARC_VENUE_PROVIDER_KEY",
  "ARC_VENUE_EVALUATOR_KEY",
  "DEPLOYER_PRIVATE_KEY",
  "SIGNER_BACKEND",
  "ARC_VENUE_SERVER_WALLETS",
] as const;

describe("EPIC-173: authority env split", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const v of AUTH_VARS) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
  });

  afterEach(() => {
    for (const v of AUTH_VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
    vi.restoreAllMocks();
  });

  it("settleKey resolves ARC_SETTLE_KEY first", () => {
    process.env.ARC_SETTLE_KEY = K1;
    process.env.ARC_EVALUATOR_KEY = K2;
    expect(settleKey()).toBe(K1);
  });

  it("settleKey falls back to deprecated ARC_EVALUATOR_KEY", () => {
    process.env.ARC_EVALUATOR_KEY = K2;
    expect(settleKey()).toBe(K2);
  });

  it("opsKey resolves ARC_OPS_KEY first", () => {
    process.env.ARC_OPS_KEY = K3;
    process.env.ARC_EVALUATOR_KEY = K2;
    expect(opsKey()).toBe(K3);
  });

  it("opsKey falls back to deprecated ARC_EVALUATOR_KEY", () => {
    process.env.ARC_EVALUATOR_KEY = K2;
    expect(opsKey()).toBe(K2);
  });

  it("DEPLOYER_PRIVATE_KEY never resolves an authority", () => {
    process.env.DEPLOYER_PRIVATE_KEY = K4;
    expect(settleKey()).toBeNull();
    expect(opsKey()).toBeNull();
    expect(serverRoleAddress("evaluator")).toBeNull();
    expect(serverRoleAddress("provider")).toBeNull();
  });

  it("returns null when no authority key is set", () => {
    expect(settleKey()).toBeNull();
    expect(opsKey()).toBeNull();
  });

  it("ignores malformed keys", () => {
    process.env.ARC_SETTLE_KEY = "not-a-key";
    process.env.ARC_OPS_KEY = "0x1234";
    expect(settleKey()).toBeNull();
    expect(opsKey()).toBeNull();
  });

  it("venue evaluator role resolves via ARC_VENUE_EVALUATOR_KEY then ops", () => {
    process.env.ARC_OPS_KEY = K3;
    const opsAddr = privateKeyToAccount(K3).address;
    expect(serverRoleAddress("evaluator")).toBe(opsAddr);
    process.env.ARC_VENUE_EVALUATOR_KEY = K2;
    expect(serverRoleAddress("evaluator")).toBe(
      privateKeyToAccount(K2).address,
    );
  });

  it("venue client/provider roles fall back to the ops authority", () => {
    process.env.ARC_OPS_KEY = K3;
    const opsAddr = privateKeyToAccount(K3).address;
    expect(serverRoleAddress("client")).toBe(opsAddr);
    expect(serverRoleAddress("provider")).toBe(opsAddr);
  });

  it("signerBackend defaults to env; socket fails fast until 173-2", () => {
    expect(signerBackend()).toBe("env");
    process.env.SIGNER_BACKEND = "socket";
    expect(() => signerBackend()).toThrow(/SLICE-173-2/);
    process.env.SIGNER_BACKEND = "bogus";
    expect(() => signerBackend()).toThrow(/Unknown SIGNER_BACKEND/);
  });

  it("warnKeyOverlap warns when settle and ops share an EOA", () => {
    const spy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    process.env.ARC_SETTLE_KEY = K1;
    process.env.ARC_OPS_KEY = K1;
    warnKeyOverlap();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("overlap"),
    );
    spy.mockClear();
    process.env.ARC_OPS_KEY = K3;
    warnKeyOverlap();
    expect(spy).not.toHaveBeenCalled();
  });
});
