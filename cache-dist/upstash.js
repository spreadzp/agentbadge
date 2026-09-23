import { Redis } from "@upstash/redis";
import { RedisCacheBase } from "./redis-base.js";
export class UpstashCache extends RedisCacheBase {
    constructor(url, token) {
        const client = new Redis({ url, token });
        super({
            get: (key) => client.get(key),
            set: (key, value, opts) => client.set(key, value, opts?.ex !== undefined ? { ex: opts.ex } : undefined),
            del: (...keys) => client.del(...keys),
            sadd: (key, ...members) => client.sadd(key, ...members),
            smembers: async (key) => {
                const members = await client.smembers(key);
                return members.map(String);
            },
            srem: (key, ...members) => client.srem(key, ...members),
            incr: (key) => client.incr(key),
            expire: (key, seconds) => client.expire(key, seconds),
            ping: () => client.ping(),
        });
    }
}
