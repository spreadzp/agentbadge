import type { CacheProvider } from "./provider.js";
export interface CacheConfig {
    enabled?: boolean;
    backend?: "memory" | "valkey" | "upstash";
    url?: string;
    token?: string;
}
export declare function createCache(config?: CacheConfig): CacheProvider;
