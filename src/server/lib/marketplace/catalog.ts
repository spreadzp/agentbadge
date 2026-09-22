// ─── Marketplace catalog store (D18) + validation (D10) + pinning (D16) ──
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { logger } from "@agentbadge/passport";
import { uploadToPinata } from "../../../agents/ipfs-uploader";
import { usdToBaseUnits } from "./chain";
import type {
  CatalogService,
  PassportMeta,
  ServiceMetaInput,
  ValidationResult,
} from "./types";

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

// ─── Metadata validation (D10) ─────────────────────────────────
const HTTPS_URL_RE = /^https:\/\/[^\s]+$/;
const SUB_ID_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;
const MAX_META_JSON_BYTES = 4096;
const MAX_DESCRIPTION = 500;

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
