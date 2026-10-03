// SLICE-155-5: agent wallet balance mirror.
// Primary: `circle wallet balance` CLI (owner-side read path).
// Fallback: direct RPC — ERC-20 balanceOf (6 dec) + native
// eth_getBalance (18 dec on Arc where USDC is native gas token —
// dual view of ONE balance, not two rows).
// Gateway: optional Circle Gateway /balances probe (depositor+domain).

import { createPublicClient, http, formatUnits, erc20Abi } from "viem";
import type { CircleCliClient } from "@agentbadge/circle-payments";

export interface WalletBalance {
  chain: string;
  /** Canonical USDC balance (ERC-20 6-dec view), decimal string. */
  usdc: string;
  /** Native-gas USDC view (18 dec) — Arc dual view, informational. */
  nativeUsdc?: string;
  gateway?: { available: string; withdrawing: string; withdrawable: string } | null;
  source: "cli" | "rpc" | "unavailable";
}

export interface BalanceDeps {
  cli?: CircleCliClient;
  /** Chain key for CLI calls (AGENT_WALLET_CHAIN). */
  chain: string;
  rpcUrl?: string;
  usdcAddress?: `0x${string}`;
  /** Circle Gateway API base (X402_GATEWAY_API_URL) — optional. */
  gatewayApiUrl?: string;
  /** CCTP/Gateway domain id for the chain — skip gateway if unset. */
  domain?: number;
  /** Test seams. */
  readContract?: (args: {
    address: `0x${string}`;
    wallet: `0x${string}`;
  }) => Promise<bigint>;
  getBalance?: (wallet: `0x${string}`) => Promise<bigint>;
  fetchFn?: typeof fetch;
}

/** Read the wallet USDC balance — CLI primary, RPC fallback. */
export async function readWalletBalance(
  address: `0x${string}`,
  deps: BalanceDeps,
): Promise<WalletBalance> {
  const out: WalletBalance = {
    chain: deps.chain,
    usdc: "0",
    gateway: null,
    source: "unavailable",
  };

  // 1) CLI primary — CliUnavailableError / any throw → fall through.
  if (deps.cli) {
    try {
      const v = await deps.cli.balance(address, deps.chain);
      if (v !== "unavailable") {
        out.usdc = v;
        out.source = "cli";
      }
    } catch {
      /* CLI down → rpc */
    }
  }

  // 2) RPC fallback — balanceOf (6 dec) + getBalance (18 dec view).
  if (out.source === "unavailable" && deps.usdcAddress) {
    const read =
      deps.readContract ??
        (deps.rpcUrl
          ? async (a: { address: `0x${string}`; wallet: `0x${string}` }) => {
              const client = createPublicClient({ transport: http(deps.rpcUrl) });
              return (await client.readContract({
                address: a.address,
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [a.wallet],
              })) as bigint;
            }
          : undefined);
    if (read) {
      try {
        const raw = await read({ address: deps.usdcAddress, wallet: address });
        out.usdc = formatUnits(raw, 6);
        out.source = "rpc";
      } catch {
        /* leave unavailable */
      }
    }
    // Native (18 dec) view — same USDC on Arc, informational.
    const getBal =
      deps.getBalance ??
        (deps.rpcUrl
          ? async (w: `0x${string}`) => {
              const client = createPublicClient({ transport: http(deps.rpcUrl) });
              return await client.getBalance({ address: w });
            }
          : undefined);
    if (getBal) {
      try {
        const native = await getBal(address);
        out.nativeUsdc = formatUnits(native, 18);
      } catch {
        /* informational only */
      }
    }
  }

  // 3) Gateway balances — depositor+domain probe (optional).
  if (deps.gatewayApiUrl && deps.domain !== undefined) {
    const fetcher = deps.fetchFn ?? fetch;
    try {
      const resp = await fetcher(`${deps.gatewayApiUrl}/balances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: "USDC",
          sources: [{ depositor: address, domain: deps.domain }],
        }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as {
          balances?: {
            balance?: string;
            withdrawing?: string;
            withdrawable?: string;
          }[];
        };
        const row = data.balances?.[0];
        if (row) {
          out.gateway = {
            available: row.balance ?? "0",
            withdrawing: row.withdrawing ?? "0",
            withdrawable: row.withdrawable ?? "0",
          };
        }
      }
    } catch {
      /* gateway optional */
    }
  }

  return out;
}
