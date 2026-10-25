/**
 * SLICE-173-2: signer-service unit tests — protocol dispatch + policy
 * denials + audit trail. No sockets, no RPC: handle() is the pure core.
 */

import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { createSignerService } from "../src/signer-service/service";
import {
  checkSendPolicy,
  loadPolicy,
  parseAllowTo,
  PolicyDeniedError,
} from "../src/signer-service/policy";
import type { SignerRpcRequest } from "@agentbadge/circle-payments";

const KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const ADDR = privateKeyToAccount(KEY).address;
const TARGET =
  "0x1111111111111111111111111111111111111111" as `0x${string}`;
const OTHER =
  "0x2222222222222222222222222222222222222222" as `0x${string}`;

const policy = {
  allowTo: parseAllowTo(TARGET),
  maxValueWei: 0n,
  maxGas: 500_000n,
};

function svc(extra: Record<string, unknown> = {}) {
  const audit = vi.fn();
  const service = createSignerService({
    key: KEY,
    socketPath: "/tmp/test-signer.sock",
    policy,
    audit,
    ...extra,
  });
  return { service, audit };
}

const rpc = (method: string, params: Record<string, unknown> = {}) =>
  ({ id: "t1", method, params }) as SignerRpcRequest;

describe("signer-service policy", () => {
  it("empty allowlist denies every send (fail closed)", () => {
    const p = { ...policy, allowTo: parseAllowTo("") };
    expect(() =>
      checkSendPolicy(p, { to: TARGET, data: "0x1234" }),
    ).toThrow(PolicyDeniedError);
  });

  it("allowlist accepts listed destination, rejects others", () => {
    checkSendPolicy(policy, { to: TARGET, data: "0x1234" });
    expect(() =>
      checkSendPolicy(policy, { to: OTHER, data: "0x1234" }),
    ).toThrow(/not in SIGNER_ALLOW_TO/);
  });

  it("value above cap denied; gas over cap denied", () => {
    expect(() =>
      checkSendPolicy(policy, { to: TARGET, data: "0x", value: 1n }),
    ).toThrow(/SIGNER_MAX_VALUE_WEI/);
    expect(() =>
      checkSendPolicy(policy, { to: TARGET, data: "0x" }, 600_000n),
    ).toThrow(/SIGNER_MAX_GAS/);
  });

  it("loadPolicy reads SIGNER_* env", () => {
    const p = loadPolicy({
      SIGNER_ALLOW_TO: `${TARGET},${OTHER}`,
      SIGNER_MAX_GAS: "1000",
      SIGNER_MAX_VALUE_WEI: "5",
    } as NodeJS.ProcessEnv);
    expect(p.allowTo !== "any" && p.allowTo.size).toBe(2);
    expect(p.maxGas).toBe(1000n);
    expect(p.maxValueWei).toBe(5n);
  });
});

describe("signer-service dispatch", () => {
  it("getAddress + health report the controlled EOA", async () => {
    const { service } = svc();
    const addr = await service.handle(rpc("getAddress"));
    expect(addr).toEqual({ id: "t1", ok: true, result: ADDR });
    const health = await service.handle(rpc("health"));
    expect(health.ok && (health as { result: { address: string } }).result.address).toBe(ADDR);
  });

  it("signMessage returns a verifiable EIP-191 signature", async () => {
    const { service, audit } = svc();
    const res = await service.handle(rpc("signMessage", { message: "hello" }));
    expect(res.ok).toBe(true);
    const sig = (res as { result: `0x${string}` }).result;
    expect(
      await verifyMessage({ address: ADDR, message: "hello", signature: sig }),
    ).toBe(true);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ op: "signMessage", result: "ok" }),
    );
  });

  it("sendTransaction to non-allowlisted address → policy_denied + audit", async () => {
    const { service, audit } = svc({ broadcast: vi.fn() });
    const res = await service.handle(
      rpc("sendTransaction", { to: OTHER, data: "0x1234" }),
    );
    expect(res.ok).toBe(false);
    expect((res as { error: { code: string } }).error.code).toBe("policy_denied");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ op: "sendTransaction", result: "denied" }),
    );
  });

  it("sendTransaction allowlisted → broadcast hash + audit ok", async () => {
    const broadcast = vi.fn(async () => "0xdead" as const);
    const { service, audit } = svc({ broadcast });
    const res = await service.handle(
      rpc("sendTransaction", { to: TARGET, data: "0x1234" }),
    );
    expect(res).toEqual({ id: "t1", ok: true, result: "0xdead" });
    expect(broadcast).toHaveBeenCalledOnce();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ op: "sendTransaction", result: "ok", txHash: "0xdead" }),
    );
  });

  it("unknown method → bad_request", async () => {
    const { service } = svc();
    const res = await service.handle(rpc("drainWallet"));
    expect(res.ok).toBe(false);
    expect((res as { error: { code: string } }).error.code).toBe("bad_request");
  });
});
