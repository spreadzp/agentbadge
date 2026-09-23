import type { CacheProvider, CacheSetOptions } from "./provider.js";
export interface InMemoryCacheOptions {
    maxEntries?: number;
    sweepIntervalMs?: number;
}
export declare class InMemoryCache implements CacheProvider {
    private readonly map;
    private readonly tagIndex;
    private readonly keyTags;
    private readonly maxEntries;
    private readonly sweepTimer;
    constructor(opts?: InMemoryCacheOptions);
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, opts?: CacheSetOptions): Promise<void>;
    delete(key: string): Promise<boolean>;
    invalidateTag(tag: string): Promise<number>;
    incr(key: string, ttlSec?: number): Promise<number>;
    health(): Promise<boolean>;
    close(): Promise<void>;
    size(): number;
    private isExpired;
    private removeKey;
    private evictIfNeeded;
    private sweep;
}
