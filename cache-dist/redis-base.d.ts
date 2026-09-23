import type { CacheProvider, CacheSetOptions } from "./provider.js";
export interface RedisCommands {
    get(key: string): Promise<unknown>;
    set(key: string, value: string, opts?: {
        ex?: number;
    }): Promise<unknown>;
    del(...keys: string[]): Promise<number>;
    sadd(key: string, ...members: string[]): Promise<number>;
    smembers(key: string): Promise<string[]>;
    srem(key: string, ...members: string[]): Promise<number>;
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
    ping(): Promise<unknown>;
    quit?(): Promise<unknown>;
}
export declare class RedisCacheBase implements CacheProvider {
    protected readonly redis: RedisCommands;
    private readonly onError;
    constructor(redis: RedisCommands, onError?: (op: string, err: unknown) => void);
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, opts?: CacheSetOptions): Promise<void>;
    delete(key: string): Promise<boolean>;
    invalidateTag(tag: string): Promise<number>;
    incr(key: string, ttlSec?: number): Promise<number>;
    health(): Promise<boolean>;
    close(): Promise<void>;
    private untag;
}
