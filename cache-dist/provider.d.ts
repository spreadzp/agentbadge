export interface CacheSetOptions {
    ttlSec?: number;
    tags?: string[];
}
export interface CacheProvider {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, opts?: CacheSetOptions): Promise<void>;
    delete(key: string): Promise<boolean>;
    invalidateTag(tag: string): Promise<number>;
    incr(key: string, ttlSec?: number): Promise<number>;
    health(): Promise<boolean>;
    close(): Promise<void>;
}
