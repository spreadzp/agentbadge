/**
 * EPIC-173 (SLICE-173-4): seam-interchangeability e2e.
 *
 * ONE scenario suite running against BOTH signer backends proves the
 * ArcSigner seam: the API's paid path cannot tell env-key apart from
 * socket-service — same address, same signatures, same writes.
 *
 * The socket side is a real unix-socket NDJSON round-trip whose stub
 * delegates signing to an EnvKeySigner — signatures are real, so both
 * legs verify against the same recovered EOA.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage, verifyTypedData, type Hex } from "viem";
import {
  createEnvKeySigner,
  createLineDecoder,
  createSocketSigner,
  encodeRpcLine,
  type ArcSigner,
  type SignerRpcRequest,
} from "@agentbadge/circle-payments";

const KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const ADDR = privateKeyToAccount(KEY).address;
const MSG = "seam-interchangeability";

const TYPED = {
  domain: {
    name: "AgentBadge",
    version: "1",
    chainId: 5042002,
    verifyingContract: "0x0000000000000000000000000000000000000001",
  },
  types: {
    Verdict: [
      { name: "jobId", type: "uint256" },
      { name: "kind", type: "string" },
    ],
  },
  primaryType: "Verdict",
  message: { jobId: 42n, kind: "approve" },
} as const;

// ── unix-socket stub backed by a real EnvKeySigner ──────────────────
const tmp = mkdtempSync(join(tmpdir(), "signer-seam-"));
const sockPath = join(tmp, "s.sock");
const backing = createEnvKeySigner(KEY);
const conns = new Set<net.Socket>();
const server = net.createServer((conn) => {
  conns.add(conn);
  conn.on("close", () => conns.delete(conn));
  const dec = createLineDecoder<SignerRpcRequest>();
  conn.on("data", (chunk) => {
    void (async () => {
      for (const req of dec.push(chunk.toString("utf8"))) {
        let result: unknown;
        switch (req.method) {
          case "getAddress":
            result = backing.address;
            break;
          case "health":
            result = { status: "ok", address: backing.address, uptimeSec: 1 };
            break;
          case "signMessage":
            result = await backing.signMessage(
              (req.params as { message: string }).message,
            );
            break;
          case "signTypedData":
            result = await backing.signTypedData!(
              req.params as never,
            );
            break;
          default:
            result = null;
        }
        conn.write(encodeRpcLine({ id: req.id, ok: true, result }));
      }
    })();
  });
});
await new Promise<void>((res) => server.listen(sockPath, res));

const sockets: { close(): void }[] = [];
afterAll(async () => {
  for (const s of sockets.splice(0)) s.close();
  for (const c of conns) c.destroy();
  await new Promise<void>((res) => server.close(() => res()));
  rmSync(tmp, { recursive: true, force: true });
});

/** Both backends behind the same ArcSigner surface. */
async function backendSigners(): Promise<{ name: string; signer: ArcSigner }[]> {
  const socket = createSocketSigner({
    socketPath: sockPath,
    requestTimeoutMs: 2_000,
  });
  sockets.push(socket);
  await socket.ping(); // connect → lazy address resolves
  return [
    { name: "env-key", signer: backing },
    { name: "socket", signer: socket },
  ];
}

describe.each(await backendSigners())(
  "seam suite — $name backend",
  ({ signer }) => {
    it("address is the shared EOA", () => {
      expect(signer.address).toBe(ADDR);
    });

    it("EIP-191 signature recovers to the shared EOA", async () => {
      const sig = await signer.signMessage(MSG);
      expect(await verifyMessage({ address: ADDR, message: MSG, signature: sig }))
        .toBe(true);
    });

    it("EIP-712 signature recovers to the shared EOA", async () => {
      const sig = await signer.signTypedData!({
        domain: { ...TYPED.domain },
        types: { Verdict: [...TYPED.types.Verdict] },
        primaryType: TYPED.primaryType,
        message: { ...TYPED.message, jobId: "42" },
      });
      expect(
        await verifyTypedData({
          address: ADDR,
          domain: TYPED.domain,
          types: TYPED.types,
          primaryType: TYPED.primaryType,
          message: { jobId: 42n, kind: "approve" },
          signature: sig as Hex,
        }),
      ).toBe(true);
    });
  },
);
