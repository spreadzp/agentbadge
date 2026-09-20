/**
 * Marketplace backend lib (EPIC-138, SLICE-138-3).
 *
 * Chain ops against MarketplacePassNFT + MarketplaceSplitter on Arc Testnet
 * (all writes via our signer — D13), off-chain catalog store (D18),
 * metadata validation (D10) + pinning (D16), and the x402 afterSettle
 * hook that credits the splitter + mints the buyer's service pass.
 *
 * Payment flow for service purchases:
 *   buyer → x402 settle (USDC → MarketplaceSplitter on Arc) →
 *   afterSettle hook → splitter.receivePayment(serviceId, amount) →
 *   nft.mintServicePass(buyer, serviceId, durationSec)
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  keccak256,
  encodePacked,
  stringToHex,
  isAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { logger } from "@agentbadge/passport";
import { getConfig } from "../../config/env";
import { uploadToPinata } from "../../agents/ipfs-uploader";

// ─── Chain ─────────────────────────────────────────────────────
const arcTestnet = defineChain({
  id: 5042002,
  name: "arc-testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.ARC_RPC_URL ?? "https://rpc.blockdaemon.testnet.arc.network",
      ],
    },
  },
});

const NFT_ABI = [
  {
    name: "mintPassport",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "metaURI", type: "string" },
      { name: "durationSec", type: "uint64" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "registerService",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "passportId", type: "uint256" },
      { name: "subId", type: "bytes32" },
      { name: "price", type: "uint256" },
      { name: "metaURI", type: "string" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "mintServicePass",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "serviceId", type: "bytes32" },
      { name: "durationSec", type: "uint64" },
      { name: "agentId_", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "passportOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "w", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "passportValid",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "passportId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "services",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "serviceId", type: "bytes32" }],
    outputs: [
      { name: "passportId", type: "uint256" },
      { name: "price", type: "uint256" },
      { name: "metaURI", type: "string" },
      { name: "active", type: "bool" },
    ],
  },
  {
    name: "servicePassOf",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "w", type: "address" },
      { name: "serviceId", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "expiresAt",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint64" }],
  },
] as const;

const SPLITTER_ABI = [
  {
    name: "receivePayment",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "serviceId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/** Deterministic serviceId — mirrors keccak256(passportId, subId) on-chain. */
export function serviceIdFor(
  passportId: bigint,
  subId: `0x${string}`,
): `0x${string}` {
  return keccak256(encodePacked(["uint256", "bytes32"], [passportId, subId]));
}

/** subId string ("api", "mcp") → bytes32 (right-padded, readable on-chain). */
export function subIdToBytes32(subId: string): `0x${string}` {
  return stringToHex(subId, { size: 32 });
}

/** USDC decimal string ("5", "5.50") → base units (6 dec). */
export function usdToBaseUnits(usd: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(usd.trim());
  if (!m) throw new Error(`Invalid USDC amount: ${usd}`);
  const frac = (m[2] ?? "").padEnd(6, "0");
  return BigInt(m[1]) * 1_000_000n + BigInt(frac || "0");
}

// ─── Chain ops (test-overridable) ──────────────────────────────
export interface MarketplaceOps {
  mintPassport(to: string, metaURI: string, durationSec: number): Promise<string>;
  registerService(
    passportId: bigint,
    subId32: `0x${string}`,
    priceBaseUnits: bigint,
    metaURI: string,
  ): Promise<string>;
  mintServicePass(
    to: string,
    serviceId: `0x${string}`,
    durationSec: number,
    agentId: bigint,
  ): Promise<string>;
  creditPayment(serviceId: `0x${string}`, amount: bigint): Promise<string>;
  passportOf(wallet: string): Promise<bigint>;
  passportValid(passportId: bigint): Promise<boolean>;
  passportOwner(passportId: bigint): Promise<string>;
  getService(
    serviceId: `0x${string}`,
  ): Promise<{
    passportId: bigint;
    price: bigint;
    metaURI: string;
    active: boolean;
  } | null>;
  servicePassOf(wallet: string, serviceId: `0x${string}`): Promise<bigint>;
  passExpiresAt(tokenId: bigint): Promise<bigint>;
}

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

// ─── Catalog store (D18: off-chain index, JSON file) ───────────
export interface CatalogService {
  serviceId: string;
  passportId: string;
  owner: string;
  subId: string;
  name: string;
  description: string;
  category?: string;
  docsUrl?: string;
  endpointUrl?: string;
  priceUsd: string;
  priceBaseUnits: string;
  durationDays: number;
  /** Canonical pass lifetime in seconds (SLICE-139-3). Absent in pre-139 catalog entries — derive from durationDays. */
  durationSec?: number;
  metaURI: string;
  createdAt: string;
}

interface MarketplaceStore {
  services: Record<string, CatalogService>;
  /** sha256 hex → metadata JSON (local pin fallback). */
  meta: Record<string, unknown>;
}

const STORE_PATH = join(process.cwd(), ".data", "marketplace.json");
let _memStore: MarketplaceStore | null = null; // test override

function emptyStore(): MarketplaceStore {
  return { services: {}, meta: {} };
}

function loadStore(): MarketplaceStore {
  if (_memStore) return _memStore;
  try {
    if (existsSync(STORE_PATH)) {
      return JSON.parse(readFileSync(STORE_PATH, "utf8")) as MarketplaceStore;
    }
  } catch (err) {
    logger.warn("marketplace: store read failed, starting empty", {
      err: String(err),
    });
  }
  return emptyStore();
}

function saveStore(store: MarketplaceStore): void {
  if (_memStore) {
    _memStore = store;
    return;
  }
  try {
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  } catch (err) {
    logger.error("marketplace: store write failed", { err: String(err) });
  }
}

export function upsertService(svc: CatalogService): void {
  const store = loadStore();
  store.services[svc.serviceId.toLowerCase()] = svc;
  saveStore(store);
}

export function getService(serviceId: string): CatalogService | undefined {
  return loadStore().services[serviceId.toLowerCase()];
}

export function listServices(filter?: {
  category?: string;
  q?: string;
}): CatalogService[] {
  let all = Object.values(loadStore().services);
  if (filter?.category) {
    const cat = filter.category.toLowerCase();
    all = all.filter((s) => s.category?.toLowerCase() === cat);
  }
  if (filter?.q) {
    const q = filter.q.toLowerCase();
    all = all.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function putMeta(json: unknown): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(json))
    .digest("hex");
  const store = loadStore();
  store.meta[hash] = json;
  saveStore(store);
  return hash;
}

export function getMeta(hash: string): unknown | undefined {
  return loadStore().meta[hash.toLowerCase()];
}

/** Test hook: swap the JSON-file store for an in-memory one. */
export function useMemoryStoreForTesting() {
  _memStore = emptyStore();
}

export function resetStoreForTesting() {
  _memStore = null;
}

// ─── Metadata validation (D10) + pinning (D16) ─────────────────
const HTTPS_URL_RE = /^https:\/\/[^\s]+$/;
const SUB_ID_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;
const MAX_META_JSON_BYTES = 4096;
const MAX_DESCRIPTION = 500;

export interface PassportMeta {
  name: string;
  endpointUrl: string;
  category: string;
  description: string;
  docsUrl: string;
}

export interface ServiceMetaInput {
  passportTokenId: string;
  subId: string;
  name: string;
  priceUsd: string;
  durationDays: number;
  /** Canonical duration in seconds — durationSec input wins over durationDays (SLICE-139-3). */
  durationSec: number;
  description?: string;
  category?: string;
  docsUrl?: string;
  endpointUrl?: string;
}

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max
    ? v.trim()
    : null;
}

export function validatePassportMeta(
  body: unknown,
): ValidationResult<PassportMeta> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Body must be a JSON object" };
  }
  if (JSON.stringify(body).length > MAX_META_JSON_BYTES) {
    return { ok: false, error: "Metadata JSON exceeds 4KB" };
  }
  const b = body as Record<string, unknown>;
  const name = str(b.name, 100);
  const endpointUrl = str(b.endpointUrl, 500);
  const category = str(b.category, 50);
  const description = str(b.description, MAX_DESCRIPTION);
  const docsUrl = str(b.docsUrl, 500);
  if (!name) return { ok: false, error: "name required (1-100 chars)" };
  if (!endpointUrl || !HTTPS_URL_RE.test(endpointUrl)) {
    return { ok: false, error: "endpointUrl must be a valid https:// URL" };
  }
  if (!category) return { ok: false, error: "category required (1-50 chars)" };
  if (!description) {
    return { ok: false, error: "description required (≤500 chars)" };
  }
  if (!docsUrl || !HTTPS_URL_RE.test(docsUrl)) {
    return { ok: false, error: "docsUrl must be a valid https:// URL" };
  }
  return { ok: true, value: { name, endpointUrl, category, description, docsUrl } };
}

export function validateServiceMeta(
  body: unknown,
): ValidationResult<ServiceMetaInput> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Body must be a JSON object" };
  }
  if (JSON.stringify(body).length > MAX_META_JSON_BYTES) {
    return { ok: false, error: "Metadata JSON exceeds 4KB" };
  }
  const b = body as Record<string, unknown>;

  const passportTokenId = str(b.passportTokenId, 40);
  if (!passportTokenId || !/^\d+$/.test(passportTokenId)) {
    return { ok: false, error: "passportTokenId required (decimal string)" };
  }
  const subId = str(b.subId, 31);
  if (!subId || !SUB_ID_RE.test(subId)) {
    return {
      ok: false,
      error: "subId required: /^[a-z0-9][a-z0-9-]{0,30}$/",
    };
  }
  const name = str(b.name, 100);
  if (!name) return { ok: false, error: "name required (1-100 chars)" };

  const priceUsd = str(b.priceUsd, 20);
  let priceBase: bigint;
  try {
    priceBase = usdToBaseUnits(priceUsd ?? "");
  } catch {
    return { ok: false, error: "priceUsd must be a decimal string (e.g. \"5.00\")" };
  }
  if (priceBase < 1_000_000n) {
    return { ok: false, error: "priceUsd below $1.00 minimum" };
  }

  // Duration: durationSec (60s–1y) wins; otherwise durationDays 1-365 (SLICE-139-3).
  let durationDays: number;
  let durationSec: number;
  if (b.durationSec != null) {
    durationSec = Number(b.durationSec);
    if (
      !Number.isInteger(durationSec) ||
      durationSec < 60 ||
      durationSec > 31_536_000
    ) {
      return { ok: false, error: "durationSec must be an integer 60-31536000" };
    }
    durationDays =
      b.durationDays != null ? Number(b.durationDays) : Math.ceil(durationSec / 86_400);
    if (
      !Number.isInteger(durationDays) ||
      durationDays < 1 ||
      durationDays > 365
    ) {
      return { ok: false, error: "durationDays must be an integer 1-365" };
    }
  } else {
    durationDays = Number(b.durationDays);
    if (
      !Number.isInteger(durationDays) ||
      durationDays < 1 ||
      durationDays > 365
    ) {
      return { ok: false, error: "durationDays must be an integer 1-365" };
    }
    durationSec = durationDays * 86_400;
  }

  const optStr = (v: unknown, max: number): string | undefined =>
    v == null ? undefined : (str(v, max) ?? undefined);

  const description = optStr(b.description, MAX_DESCRIPTION);
  if (b.description != null && description === undefined) {
    return { ok: false, error: "description must be non-empty, ≤500 chars" };
  }
  const category = optStr(b.category, 50);
  const docsUrl = optStr(b.docsUrl, 500);
  if (b.docsUrl != null && (docsUrl === undefined || !HTTPS_URL_RE.test(docsUrl))) {
    return { ok: false, error: "docsUrl must be https://" };
  }
  const endpointUrl = optStr(b.endpointUrl, 500);
  if (
    b.endpointUrl != null &&
    (endpointUrl === undefined || !HTTPS_URL_RE.test(endpointUrl))
  ) {
    return { ok: false, error: "endpointUrl must be https://" };
  }

  return {
    ok: true,
    value: {
      passportTokenId,
      subId,
      name,
      priceUsd: priceUsd!,
      durationDays,
      durationSec,
      description,
      category,
      docsUrl,
      endpointUrl,
    },
  };
}

/**
 * Pin metadata JSON → metaURI. Pinata when IPFS_API_KEY configured (D16),
 * otherwise content-addressed local store served via /api/market/meta/:hash.
 */
export async function pinMarketplaceMetadata(meta: unknown): Promise<string> {
  if (process.env.IPFS_API_KEY && process.env.MOCK_IPFS !== "true") {
    try {
      return await uploadToPinata(meta);
    } catch (err) {
      logger.warn("marketplace: Pinata pin failed, falling back to local", {
        err: String(err),
      });
    }
  }
  const hash = putMeta(meta);
  const base = process.env.BASE_URL ?? "https://agentbadge.xyz";
  return `${base}/api/market/meta/${hash}`;
}

// ─── x402 afterSettle hook: credit splitter + mint pass ────────
interface SettleResultLike {
  success: boolean;
  payer?: string;
  amount?: string;
  transaction?: string;
}

interface SettleContextLike {
  result: SettleResultLike;
  requirements?: { amount?: string };
  transportContext?: unknown;
}

const BUY_PATH_RE = /\/api\/market\/buy\/(0x[a-fA-F0-9]{64})/;

/** Extract serviceId from the request path in transportContext. */
function serviceIdFromContext(ctx: SettleContextLike): `0x${string}` | null {
  const tc = ctx.transportContext as
    | { request?: { path?: string } }
    | undefined;
  const m = tc?.request?.path ? BUY_PATH_RE.exec(tc.request.path) : null;
  return m ? (m[1].toLowerCase() as `0x${string}`) : null;
}

/**
 * AfterSettleHook for the marketplace resource server.
 * On settled buy: credit the splitter (90/10 bookkeeping) then mint/extend
 * the payer's service pass. Failures are logged, never rethrown — the
 * payment is already settled (same pattern as access-pass-minter, D10).
 */
export function createMarketplaceMintOnSettleHook() {
  return async (ctx: SettleContextLike): Promise<void> => {
    const payer = ctx.result?.payer;
    if (!ctx.result?.success || !payer) {
      if (ctx.result?.success) {
        logger.warn("marketplace-mint: settled but no payer — skipping");
      }
      return;
    }
    const serviceId = serviceIdFromContext(ctx);
    if (!serviceId) {
      logger.error("marketplace-mint: no serviceId in request path", {
        payer,
        paymentTx: ctx.result.transaction,
      });
      return;
    }
    const svc = getService(serviceId);
    if (!svc) {
      logger.error("marketplace-mint: serviceId not in catalog", {
        serviceId,
        payer,
        paymentTx: ctx.result.transaction,
      });
      return;
    }
    const ops = getMarketplaceOps();
    const amount = ctx.result.amount ?? ctx.requirements?.amount ?? "0";
    const durationSec = svc.durationSec ?? svc.durationDays * 86_400;

    try {
      const creditTx = await ops.creditPayment(serviceId, BigInt(amount));
      logger.info("marketplace-mint: splitter credited", {
        serviceId,
        amount,
        creditTx,
      });
    } catch (err) {
      logger.error("marketplace-mint: splitter credit failed", {
        serviceId,
        amount,
        err: String(err),
        paymentTx: ctx.result.transaction,
      });
    }

    try {
      const mintTx = await ops.mintServicePass(payer, serviceId, durationSec, 0n);
      logger.info("marketplace-mint: service pass minted/extended", {
        payer,
        serviceId,
        durationSec,
        mintTx,
        paymentTx: ctx.result.transaction,
      });
    } catch (err) {
      logger.error("marketplace-mint: mint failed after settle", {
        payer,
        serviceId,
        err: String(err),
        paymentTx: ctx.result.transaction,
      });
    }
  };
}

export { isAddress };
