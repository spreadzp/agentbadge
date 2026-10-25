/**
 * EPIC-173 (SLICE-173-2): signer-service entrypoint — standalone process.
 *
 *   bun run src/signer-service/index.ts
 *
 * Env (see .env.example):
 *   SIGNER_KEY | ARC_SETTLE_KEY   — the money key (required, hex)
 *   SIGNER_SOCKET_PATH           — unix socket file (default /tmp/agentbadge-signer.sock)
 *   SIGNER_ALLOW_TO              — csv destination allowlist (empty = deny all sends)
 *   SIGNER_MAX_VALUE_WEI         — native value cap (default 0)
 *   SIGNER_MAX_GAS               — estimated-gas cap (default 500000)
 *   SIGNER_RPC_URL               — broadcast RPC (default: venue network rpcUrl)
 *   ARC_NETWORK=mainnet|testnet  — chain selection via resolveVenueNetwork
 *
 * No socket/TCP port is opened — the only surface is the socket file.
 * Start alongside the API via scripts/start-with-signer.sh (deploy entrée).
 */

import { logger } from "@agentbadge/passport/logger";
import { DEFAULT_SOCKET_PATH } from "@agentbadge/circle-payments";
import { createSignerService } from "./service";
import { loadPolicy } from "./policy";
import { resolveVenueNetwork } from "../server/lib/venue/chain";
import { arcChainFor } from "../server/lib/marketplace/chain";

const KEY_RE = /^0x[0-9a-fA-F]{64}$/;

function main(): void {
  const key = process.env.SIGNER_KEY ?? process.env.ARC_SETTLE_KEY;
  if (!key || !KEY_RE.test(key)) {
    logger.error("signer-service: SIGNER_KEY/ARC_SETTLE_KEY missing or invalid — refusing to start");
    process.exit(1);
  }

  const net = resolveVenueNetwork();
  const chain = arcChainFor(net.chain.caip2);
  const rpcUrl = process.env.SIGNER_RPC_URL ?? net.chain.rpcUrl;
  const socketPath = process.env.SIGNER_SOCKET_PATH ?? DEFAULT_SOCKET_PATH;
  const policy = loadPolicy();

  const service = createSignerService({
    key: key as `0x${string}`,
    socketPath,
    policy,
    rpcUrl,
    chain,
  });

  void service.listen().then(() => {
    logger.info("signer-service listening", {
      socketPath,
      address: service.address,
      network: net.name,
      allowTo: policy.allowTo === "any" ? "*" : policy.allowTo.size,
      maxGas: policy.maxGas.toString(),
      rpcUrl: rpcUrl ? "set" : "sign-only",
    });
  });

  const shutdown = () => {
    void service.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
