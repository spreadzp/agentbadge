// ─── Marketplace chain ops (test-overridable) ──────────────────
import {
  createPublicClient,
  createWalletClient,
  http,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getConfig } from "../../../config/env";
import { arcTestnet, NFT_ABI, SPLITTER_ABI } from "./chain";
import { resetStoreForTesting } from "./catalog";
import type { MarketplaceOps } from "./types";

/** Options for a non-default (e.g. mainnet) ops instance — SLICE-151-7. */
export interface MarketplaceOpsOptions {
  /** Chain — default arcTestnet. */
  chain?: Chain;
  /** MarketplacePassNFT — default config.marketplace.nftAddress. */
  nftAddress?: string;
  /** MarketplaceSplitter — default config.marketplace.splitterAddress. */
  splitterAddress?: string;
  /** Signer key — default ACCESS_PASS_MINTER_KEY env. */
  minterKey?: string;
}

function buildOps(opts: MarketplaceOpsOptions): MarketplaceOps {
  const chain = opts.chain ?? arcTestnet;

  let _clients: {
    wallet: ReturnType<typeof createWalletClient>;
    pub: ReturnType<typeof createPublicClient>;
  } | null = null;

  const getClients = () => {
    if (_clients) return _clients;
    const key = opts.minterKey ?? process.env.ACCESS_PASS_MINTER_KEY;
    if (!key) throw new Error("ACCESS_PASS_MINTER_KEY not configured");
    const account = privateKeyToAccount(key as `0x${string}`);
    const transport = http(chain.rpcUrls.default.http[0]);
    _clients = {
      wallet: createWalletClient({ account, chain, transport }),
      pub: createPublicClient({ chain, transport }),
    };
    return _clients;
  };

  const nftAddress = (): `0x${string}` => {
    const addr = opts.nftAddress ?? getConfig().marketplace?.nftAddress;
    if (!addr) throw new Error("MARKETPLACE_NFT not configured");
    return addr as `0x${string}`;
  };

  const splitterAddress = (): `0x${string}` => {
    const addr =
      opts.splitterAddress ?? getConfig().marketplace?.splitterAddress;
    if (!addr) throw new Error("MARKETPLACE_SPLITTER not configured");
    return addr as `0x${string}`;
  };

  return {
    async mintPassport(to, metaURI, durationSec) {
      const { wallet, pub } = getClients();
      const hash = await wallet.writeContract({
        address: nftAddress(),
        abi: NFT_ABI,
        functionName: "mintPassport",
        args: [to as `0x${string}`, metaURI, BigInt(durationSec)],
        chain,
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
        chain,
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
        chain,
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
        chain,
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
}

const defaultOps: MarketplaceOps = buildOps({});

/** Additional ops instances keyed by "chainId:nft" — lazily created (151-7). */
const _opsByTarget = new Map<string, MarketplaceOps>();

let _overrideOps: MarketplaceOps | null = null;

export function getMarketplaceOps(): MarketplaceOps {
  return _overrideOps ?? defaultOps;
}

/**
 * Ops bound to a specific chain/NFT (bstock on mainnet — SLICE-151-7).
 * Instances are memoized; injected overrides still win via getMarketplaceOps.
 */
export function getMarketplaceOpsFor(
  opts: MarketplaceOpsOptions,
): MarketplaceOps {
  const key = `${opts.chain?.id ?? 0}:${opts.nftAddress ?? "env"}:${opts.minterKey ? "envkey" : "env"}`;
  let ops = _opsByTarget.get(key);
  if (!ops) {
    ops = buildOps(opts);
    _opsByTarget.set(key, ops);
  }
  return ops;
}

export function configureMarketplaceForTesting(config: {
  ops?: MarketplaceOps | null;
}) {
  _overrideOps = config.ops ?? null;
}

export function resetMarketplaceForTesting() {
  _overrideOps = null;
  _opsByTarget.clear();
  resetStoreForTesting();
}
