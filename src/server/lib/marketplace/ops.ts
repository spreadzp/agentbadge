// ─── Marketplace chain ops (test-overridable) ──────────────────
import {
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getConfig } from "../../../config/env";
import { arcTestnet, NFT_ABI, SPLITTER_ABI } from "./chain";
import { resetStoreForTesting } from "./catalog";
import type { MarketplaceOps } from "./types";

let _clients: {
  wallet: ReturnType<typeof createWalletClient>;
  pub: ReturnType<typeof createPublicClient>;
} | null = null;

function getClients() {
  if (_clients) return _clients;
  const key = process.env.ACCESS_PASS_MINTER_KEY;
  if (!key) throw new Error("ACCESS_PASS_MINTER_KEY not configured");
  const account = privateKeyToAccount(key as `0x${string}`);
  const transport = http(arcTestnet.rpcUrls.default.http[0]);
  _clients = {
    wallet: createWalletClient({ account, chain: arcTestnet, transport }),
    pub: createPublicClient({ chain: arcTestnet, transport }),
  };
  return _clients;
}

function nftAddress(): `0x${string}` {
  const addr = getConfig().marketplace?.nftAddress;
  if (!addr) throw new Error("MARKETPLACE_NFT not configured");
  return addr as `0x${string}`;
}

function splitterAddress(): `0x${string}` {
  const addr = getConfig().marketplace?.splitterAddress;
  if (!addr) throw new Error("MARKETPLACE_SPLITTER not configured");
  return addr as `0x${string}`;
}

const defaultOps: MarketplaceOps = {
  async mintPassport(to, metaURI, durationSec) {
    const { wallet, pub } = getClients();
    const hash = await wallet.writeContract({
      address: nftAddress(),
      abi: NFT_ABI,
      functionName: "mintPassport",
      args: [to as `0x${string}`, metaURI, BigInt(durationSec)],
      chain: arcTestnet,
      account: wallet.account!,
    });
    await pub.waitForTransactionReceipt({ hash });
    return hash;
  },
  async registerService(passportId, subId32, priceBaseUnits, metaURI) {
    const { wallet, pub } = getClients();
    const hash = await wallet.writeContract({
      address: nftAddress(),
      abi: NFT_ABI,
      functionName: "registerService",
      args: [passportId, subId32, priceBaseUnits, metaURI],
      chain: arcTestnet,
      account: wallet.account!,
    });
    await pub.waitForTransactionReceipt({ hash });
    return hash;
  },
  async mintServicePass(to, serviceId, durationSec, agentId) {
    const { wallet, pub } = getClients();
    const hash = await wallet.writeContract({
      address: nftAddress(),
      abi: NFT_ABI,
      functionName: "mintServicePass",
      args: [to as `0x${string}`, serviceId, BigInt(durationSec), agentId],
      chain: arcTestnet,
      account: wallet.account!,
    });
    await pub.waitForTransactionReceipt({ hash });
    return hash;
  },
  async creditPayment(serviceId, amount) {
    const { wallet, pub } = getClients();
    const hash = await wallet.writeContract({
      address: splitterAddress(),
      abi: SPLITTER_ABI,
      functionName: "receivePayment",
      args: [serviceId, amount],
      chain: arcTestnet,
      account: wallet.account!,
    });
    await pub.waitForTransactionReceipt({ hash });
    return hash;
  },
  async passportOf(wallet) {
    return (await getClients().pub.readContract({
      address: nftAddress(),
      abi: NFT_ABI,
      functionName: "passportOf",
      args: [wallet as `0x${string}`],
    })) as bigint;
  },
  async passportValid(passportId) {
    return (await getClients().pub.readContract({
      address: nftAddress(),
      abi: NFT_ABI,
      functionName: "passportValid",
      args: [passportId],
    })) as boolean;
  },
  async passportOwner(passportId) {
    return (await getClients().pub.readContract({
      address: nftAddress(),
      abi: NFT_ABI,
      functionName: "ownerOf",
      args: [passportId],
    })) as string;
  },
  async getService(serviceId) {
    const [passportId, price, metaURI, active] = (await getClients().pub.readContract({
      address: nftAddress(),
      abi: NFT_ABI,
      functionName: "services",
      args: [serviceId],
    })) as [bigint, bigint, string, boolean];
    if (passportId === 0n) return null;
    return { passportId, price, metaURI, active };
  },
  async servicePassOf(wallet, serviceId) {
    return (await getClients().pub.readContract({
      address: nftAddress(),
      abi: NFT_ABI,
      functionName: "servicePassOf",
      args: [wallet as `0x${string}`, serviceId],
    })) as bigint;
  },
  async passExpiresAt(tokenId) {
    return (await getClients().pub.readContract({
      address: nftAddress(),
      abi: NFT_ABI,
      functionName: "expiresAt",
      args: [tokenId],
    })) as bigint;
  },
};

let _overrideOps: MarketplaceOps | null = null;

export function getMarketplaceOps(): MarketplaceOps {
  return _overrideOps ?? defaultOps;
}

export function configureMarketplaceForTesting(config: {
  ops?: MarketplaceOps | null;
}) {
  _overrideOps = config.ops ?? null;
}

export function resetMarketplaceForTesting() {
  _overrideOps = null;
  _clients = null;
  resetStoreForTesting();
}
