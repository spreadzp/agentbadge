import { Redis } from "ioredis";
import { RedisCacheBase } from "./redis-base.js";
export class ValkeyCache extends RedisCacheBase {
    constructor(url) {
        const normalized = url.replace(/^valkey:\/\//, "redis://");
        const client = new Redis(normalized, {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
            reconnectOnError: () => false,
        });
        client.on("error", () => { });
        super({
            get: (key) => client.get(key),
            set: (key, value, opts) => opts?.ex !== undefined
                ? client.set(key, value, "EX", opts.ex)
                : client.set(key, value),
            del: (...keys) => client.del(...keys),
            sadd: (key, ...members) => client.sadd(key, ...members),
            smembers: (key) => client.smembers(key),
            srem: (key, ...members) => client.srem(key, ...members),
            incr: (key) => client.incr(key),
            expire: (key, seconds) => client.expire(key, seconds),
            ping: () => client.ping(),
            quit: () => client.quit(),
        });
    }
}
