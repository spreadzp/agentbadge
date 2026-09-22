// ─── Marketplace types (EPIC-140, SLICE-140-22) ────────────────

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

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };
