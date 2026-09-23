const tagKey = (tag) => `tag:${tag}`;
const keyTagsKey = (key) => `keytags:${key}`;
function warn(op, err) {
    console.warn(`[cache] ${op} failed:`, err instanceof Error ? err.message : err);
}
export class RedisCacheBase {
    redis;
    onError;
    constructor(redis, onError = warn) {
        this.redis = redis;
        this.onError = onError;
    }
    async get(key) {
        try {
            const raw = await this.redis.get(key);
            if (raw === null || raw === undefined)
                return null;
            if (typeof raw === "string")
                return JSON.parse(raw);
            return raw;
        }
        catch (err) {
            this.onError("get", err);
            return null;
        }
    }
    async set(key, value, opts) {
        try {
            await this.untag(key);
            const payload = JSON.stringify(value);
            await this.redis.set(key, payload, opts?.ttlSec !== undefined ? { ex: opts.ttlSec } : undefined);
            if (opts?.tags?.length) {
                for (const tag of new Set(opts.tags)) {
                    await this.redis.sadd(tagKey(tag), key);
                }
                await this.redis.del(keyTagsKey(key));
                await this.redis.sadd(keyTagsKey(key), ...opts.tags);
            }
        }
        catch (err) {
            this.onError("set", err);
        }
    }
    async delete(key) {
        try {
            await this.untag(key);
            return (await this.redis.del(key)) > 0;
        }
        catch (err) {
            this.onError("delete", err);
            return false;
        }
    }
    async invalidateTag(tag) {
        try {
            const keys = await this.redis.smembers(tagKey(tag));
            let removed = 0;
            for (const key of keys) {
                await this.untag(key);
                if ((await this.redis.del(key)) > 0)
                    removed++;
            }
            await this.redis.del(tagKey(tag));
            return removed;
        }
        catch (err) {
            this.onError("invalidateTag", err);
            return 0;
        }
    }
    async incr(key, ttlSec) {
        try {
            const n = await this.redis.incr(key);
            if (n === 1 && ttlSec !== undefined) {
                await this.redis.expire(key, ttlSec);
            }
            return n;
        }
        catch (err) {
            this.onError("incr", err);
            return 0;
        }
    }
    async health() {
        try {
            await this.redis.ping();
            return true;
        }
        catch {
            return false;
        }
    }
    async close() {
        try {
            await this.redis.quit?.();
        }
        catch {
        }
    }
    async untag(key) {
        const tags = await this.redis.smembers(keyTagsKey(key));
        for (const tag of tags) {
            await this.redis.srem(tagKey(tag), key);
        }
        if (tags.length)
            await this.redis.del(keyTagsKey(key));
    }
}
