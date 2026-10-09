// EPIC-184: self-serve agent registration wiring.
// SLICE-184-2: store + routes mounted always (handlers self-gate so a
// missing flag/key answers honest 503, not a bare 404). Mint signer is the
// dedicated ARC_OPS_KEY — never the evaluator/master key (D-184-6).

import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Hono } from "hono";
import { logger } from "@agentbadge/passport";
import { createErc8004 } from "@agentbadge/circle-payments";

import { getConfig } from "../../config/env";
import {
  createJsonAgentRegistrationStore,
  createMemoryAgentRegistrationStore,
} from "../lib/agent-registration/store";
import { gasCappedWallet } from "../lib/eaas/settle";
import { resolveVenueNetwork, publicClient } from "../lib/venue/chain";
import { createAgentRegisterRoutes } from "../routes/agents-register-api";

export function wireAgentRegistration(app: Hono): void {
  const cfg = getConfig().agentRegistration;
  const net = resolveVenueNetwork();
  const read = publicClient(net);

  const store =
    cfg?.store === "memory"
      ? createMemoryAgentRegistrationStore()
      : createJsonAgentRegistrationStore();

  // Ops signer — ARC_OPS_KEY. Enabled-but-missing key: routes still mount,
  // POST answers 503 (fail honest, fail closed).
  let mint:
    | ((agentUri: string) => Promise<{ agentId: bigint; txHash: `0x${string}` }>)
    | undefined;
  if (cfg?.enabled && cfg.opsKey) {
    const account = privateKeyToAccount(cfg.opsKey);
    const rawWallet = createWalletClient({
      account,
      chain: net.chain as never,
      transport: http(net.chain.rpcUrl),
    });
    // Gas-cap decorator (settle.ts pattern) — refuse mints over the cap.
    const wallet = gasCappedWallet(
      rawWallet as never,
      account.address,
      async (args) =>
        read.estimateContractGas({
          ...args,
          abi: args.abi as never,
        } as never),
      BigInt(cfg.gasCap),
    );
    const erc8004 = createErc8004({
      read: read as never,
      // canonical per-network registry (ARC_MAINNET_CONTRACTS /
      // ARC_CONTRACTS picked by ARC_NETWORK via resolveVenueNetwork).
      identity: net.identityRegistry,
    });
    mint = (agentUri) => erc8004.registerMirror(wallet, agentUri);
  } else if (cfg?.enabled) {
    logger.warn(
      "AGENT_REGISTER_ENABLED but ARC_OPS_KEY missing — register route serves 503",
    );
  }

  app.route(
    "/",
    createAgentRegisterRoutes({
      enabled: cfg?.enabled === true,
      store,
      ...(mint ? { mint } : {}),
      chainId: net.chain.chainId,
      registryAddress: net.identityRegistry,
      keyRpm: cfg?.keyRpm ?? 10,
      dailyLimit: cfg?.dailyLimit ?? 20,
    }),
  );
}
