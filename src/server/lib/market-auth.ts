// EPIC-140 (SLICE-140-14): market auth/signature helpers extracted from routes/market.ts.
// Pure logic only — no HTTP routing. Imported back by routes/market.ts.
import {
  isBaseDid,
  parseBaseDid,
  EvmChainAdapter,
  BASE_SEPOLIA_ADDRESSES,
  BASE_SEPOLIA_RPC,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_EXPLORER,
  SessionRegistry,
} from "@agentbadge/evm-core";
import { ErrorCodes } from "./error-codes";

// SLICE-90-12: Check passport type for Base Sepolia DIDs
// Returns null if check passes, or a Response if it fails
export async function checkPassportType(
  did: string,
  requiredType: "CREATOR" | "EXECUTOR",
): Promise<Response | null> {
  if (!isBaseDid(did)) return null; // Only check Base Sepolia DIDs

  const parsed = parseBaseDid(did);
  if (!parsed) return null;

  const operatorKey = process.env.BASE_OPERATOR_KEY;
  if (!operatorKey) return null; // Skip if Base not configured

  const adapter = new EvmChainAdapter({
    rpcUrl: BASE_SEPOLIA_RPC,
    chainId: BASE_SEPOLIA_CHAIN_ID,
    operatorKey,
    passportNft: BASE_SEPOLIA_ADDRESSES.AgentPassport,
    escrow: BASE_SEPOLIA_ADDRESSES.TaskEscrow,
    eventLog: BASE_SEPOLIA_ADDRESSES.DIDRegistry,
    usdcAddress: BASE_SEPOLIA_ADDRESSES.MockUSDC,
    explorerUrl: BASE_SEPOLIA_EXPLORER,
  });

  const info = await adapter.getPassportInfo(parsed.nftAddress, parsed.tokenId);
  if (!info) {
    return new Response(
      JSON.stringify({ error: { code: ErrorCodes.PASSPORT_NOT_FOUND, message: "Passport not found on Base Sepolia" } }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  if (info.deleted) {
    return new Response(
      JSON.stringify({ error: { code: ErrorCodes.PASSPORT_REVOKED, message: "Passport is revoked" } }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  if (info.passportType !== requiredType) {
    return new Response(
      JSON.stringify({
        error: {
          code: ErrorCodes.PASSPORT_TYPE_MISMATCH,
          message: `Passport type ${info.passportType} does not match required type ${requiredType}`,
        },
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  return null;
}

// SLICE-90-13: Check session budget cap for Base Sepolia DIDs
// Returns null if check passes or is not applicable, or a Response if it fails
export async function checkSessionCap(
  did: string,
  amount: number,
  sessionId: number,
): Promise<Response | null> {
  if (!isBaseDid(did)) return null; // Only check Base Sepolia DIDs

  const operatorKey = process.env.BASE_OPERATOR_KEY;
  if (!operatorKey) return null; // Skip if Base not configured

  const sessionRegistryAddr = BASE_SEPOLIA_ADDRESSES.SessionRegistry;
  if (sessionRegistryAddr === "0x0000000000000000000000000000000000000000") return null; // Skip if not deployed

  if (!sessionId) return null; // No session → skip

  const registry = new SessionRegistry(sessionRegistryAddr, {
    rpcUrl: BASE_SEPOLIA_RPC,
    chainId: BASE_SEPOLIA_CHAIN_ID,
    operatorKey,
    passportNft: BASE_SEPOLIA_ADDRESSES.AgentPassport,
    escrow: BASE_SEPOLIA_ADDRESSES.TaskEscrow,
    eventLog: BASE_SEPOLIA_ADDRESSES.DIDRegistry,
    usdcAddress: BASE_SEPOLIA_ADDRESSES.MockUSDC,
    explorerUrl: BASE_SEPOLIA_EXPLORER,
  });

  const amountWei = BigInt(Math.floor(amount * 1e6)); // USDC has 6 decimals
  const check = await registry.checkSessionValid(sessionId, amountWei);
  if (!check.ok) {
    return new Response(
      JSON.stringify({
        error: {
          code: ErrorCodes.SESSION_BUDGET_EXCEEDED,
          message: `Session budget check failed: ${check.reason}`,
        },
      }),
      { status: 402, headers: { "Content-Type": "application/json" } },
    );
  }

  return null;
}
export function parseSignatureB64(signatureB64: string): Uint8Array[] {
  const sigB64Array = JSON.parse(signatureB64) as string[];
  return sigB64Array.map((s) => new Uint8Array(Buffer.from(s, "base64")));
}

