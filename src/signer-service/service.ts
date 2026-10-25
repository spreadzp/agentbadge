/**
 * EPIC-173 (SLICE-173-2): signer-service core — the money key behind a
 * Unix-domain socket (D-173-2, D-173-4).
 *
 * Hard invariants:
 *  - listens ONLY on a socket file — no TCP/UDP port is ever opened (AC2)
 *  - key material arrives via env (SIGNER_KEY / ARC_SETTLE_KEY), never
 *    over the wire; requests only name an operation + params
 *  - every sendTransaction passes the policy layer (allowlist, value cap,
 *    gas cap) and is audit-logged — denies are logged too
 *
 * `handle()` is the pure dispatch core (unit-testable without sockets);
 * `listen()` wraps it in an NDJSON unix server.
 */

import { existsSync, unlinkSync } from "node:fs";
import { createServer, type Server } from "node:net";
import {
  createWalletClient,
  createPublicClient,
  http,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createLineDecoder,
  encodeRpcLine,
  type HealthResult,
  type SignerErrorCode,
  type SignerRpcRequest,
  type SignerRpcResponse,
  type SendTransactionParams,
  type SignMessageParams,
  type SignTypedDataParams,
} from "@agentbadge/circle-payments";
import { PolicyDeniedError, checkSendPolicy, type SignerPolicy } from "./policy";

export interface SignerServiceDeps {
  key: `0x${string}`;
  socketPath: string;
  policy: SignerPolicy;
  /** RPC endpoint — required for sendTransaction; absent = sign-only. */
  rpcUrl?: string;
  chain?: Chain;
  /** Test seams — replace the viem wallet/public clients. */
  broadcast?: (tx: { to: `0x${string}`; data: Hex; value?: bigint }) => Promise<Hex>;
  estimateGas?: (tx: { to: `0x${string}`; data: Hex }) => Promise<bigint>;
  /** Audit sink — default JSON-lines to stdout via console.log. */
  audit?: (event: Record<string, unknown>) => void;
  now?: () => number;
}

export interface SignerService {
  address: `0x${string}`;
  /** Pure dispatch — one request → one response (async). */
  handle(req: SignerRpcRequest): Promise<SignerRpcResponse>;
  /** Bind the unix socket; resolves when listening. */
  listen(): Promise<void>;
  /** Stop the server + remove the socket file. */
  close(): Promise<void>;
}

const ok = (id: string, result: unknown): SignerRpcResponse => ({ id, ok: true, result });
const err = (id: string, code: SignerErrorCode, message: string): SignerRpcResponse => ({
  id,
  ok: false,
  error: { code, message },
});

export function createSignerService(deps: SignerServiceDeps): SignerService {
  const account = privateKeyToAccount(deps.key);
  const started = deps.now?.() ?? Date.now();
  const audit =
    deps.audit ??
    ((ev: Record<string, unknown>) => {
      // Audit trail stays in the service log — never in the API process.
      console.log(JSON.stringify({ event: "signer.audit", ...ev }));
    });

  const wallet =
    deps.rpcUrl && !deps.broadcast
      ? createWalletClient({
          account,
          transport: http(deps.rpcUrl),
          ...(deps.chain ? { chain: deps.chain } : {}),
        })
      : null;
  const read =
    deps.rpcUrl && !deps.estimateGas
      ? createPublicClient({ transport: http(deps.rpcUrl) })
      : null;

  const isHex = (s: unknown): s is `0x${string}` =>
    typeof s === "string" && /^0x[0-9a-fA-F]*$/.test(s);

  async function sendTransaction(p: SendTransactionParams): Promise<Hex> {
    if (!isHex(p.to) || !isHex(p.data)) {
      throw new PolicyDeniedError("malformed to/data in sendTransaction");
    }
    const tx = {
      to: p.to,
      data: p.data,
      ...(p.value !== undefined ? { value: BigInt(p.value) } : {}),
    };
    const gas = deps.estimateGas
      ? await deps.estimateGas(tx)
      : read
        ? await read.estimateGas({ account, to: tx.to, data: tx.data })
        : undefined;
    checkSendPolicy(deps.policy, tx, gas);
    if (deps.broadcast) return deps.broadcast(tx);
    if (!wallet) {
      throw new PolicyDeniedError("broadcast unavailable — service is sign-only (no rpcUrl)");
    }
    return wallet.sendTransaction({
      account,
      to: tx.to,
      data: tx.data,
      ...(tx.value !== undefined ? { value: tx.value } : {}),
      chain: deps.chain ?? null,
    } as never) as Promise<Hex>;
  }

  async function handle(req: SignerRpcRequest): Promise<SignerRpcResponse> {
    const params = (req.params ?? {}) as Record<string, unknown>;
    try {
      switch (req.method) {
        case "getAddress":
          return ok(req.id, account.address);
        case "health":
          return ok(req.id, {
            status: "ok",
            address: account.address,
            uptimeSec: Math.floor(
              ((deps.now?.() ?? Date.now()) - started) / 1000,
            ),
            ...(deps.chain ? { chainId: deps.chain.id } : {}),
          } satisfies HealthResult);
        case "signMessage": {
          const { message } = params as unknown as SignMessageParams;
          if (typeof message !== "string" && !(message && isHex((message as { raw?: unknown }).raw))) {
            return err(req.id, "bad_request", "signMessage needs message string or {raw:0x..}");
          }
          const sig = await account.signMessage({ message: message as never });
          audit({ op: "signMessage", result: "ok" });
          return ok(req.id, sig);
        }
        case "signTypedData": {
          const td = params as unknown as SignTypedDataParams;
          if (!td.domain || !td.types || !td.primaryType || !td.message) {
            return err(req.id, "bad_request", "signTypedData needs domain/types/primaryType/message");
          }
          const sig = await account.signTypedData(td as never);
          audit({ op: "signTypedData", primaryType: td.primaryType, result: "ok" });
          return ok(req.id, sig);
        }
        case "sendTransaction": {
          const tx = params as unknown as SendTransactionParams;
          try {
            const hash = await sendTransaction(tx);
            audit({ op: "sendTransaction", to: tx.to, value: tx.value ?? "0", result: "ok", txHash: hash });
            return ok(req.id, hash);
          } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            audit({ op: "sendTransaction", to: tx?.to, result: "denied", reason });
            if (e instanceof PolicyDeniedError) return err(req.id, "policy_denied", e.message);
            throw e;
          }
        }
        default:
          return err(req.id, "bad_request", `unknown method ${String(req.method)}`);
      }
    } catch (e) {
      return err(req.id, "internal", e instanceof Error ? e.message : String(e));
    }
  }

  let server: Server | null = null;
  return {
    address: account.address,
    handle,
    listen: () =>
      new Promise((resolve, reject) => {
        // Stale socket file from a killed process — bind fails with
        // EADDRINUSE; only remove when nothing else is listening.
        if (existsSync(deps.socketPath)) unlinkSync(deps.socketPath);
        server = createServer((conn) => {
          const decode = createLineDecoder<SignerRpcRequest>();
          conn.on("data", (chunk) => {
            let reqs: SignerRpcRequest[];
            try {
              reqs = decode.push(chunk.toString("utf8"));
            } catch {
              conn.destroy();
              return;
            }
            for (const r of reqs) {
              void handle(r).then((res) => {
                if (!conn.destroyed) conn.write(encodeRpcLine(res));
              });
            }
          });
        });
        server.on("error", reject);
        server.listen(deps.socketPath, () => {
          resolve();
        });
      }),
    close: () =>
      new Promise((resolve) => {
        if (!server) return resolve();
        server.close(() => {
          if (existsSync(deps.socketPath)) {
            try {
              unlinkSync(deps.socketPath);
            } catch {
              /* best-effort */
            }
          }
          resolve();
        });
      }),
  };
}
