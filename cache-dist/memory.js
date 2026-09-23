const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
export class InMemoryCache {
    map = new Map();
    tagIndex = new Map();
    keyTags = new Map();
    maxEntries;
    sweepTimer;
    constructor(opts = {}) {
        this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
        const sweepIntervalMs = opts.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
        this.sweepTimer =
            sweepIntervalMs > 0
                ? setInterval(() => this.sweep(Date.now()), sweepIntervalMs)
                : null;
        this.sweepTimer?.unref?.();
    }
    async get(key) {
        const entry = this.map.get(key);
        if (!entry)
            return null;
        if (this.isExpired(entry, Date.now())) {
            this.removeKey(key);
            return null;
        }
        this.map.delete(key);
        this.map.set(key, entry);
        return entry.value;
    }
    async set(key, value, opts) {
        if (this.map.has(key))
            this.removeKey(key);
        const entry = { value };
        if (opts?.ttlSec !== undefined) {
            entry.expiresAt = Date.now() + opts.ttlSec * 1000;
        }
        this.map.set(key, entry);
        if (opts?.tags?.length) {
            const tags = new Set(opts.tags);
            this.keyTags.set(key, tags);
            for (const tag of tags) {
                let keys = this.tagIndex.get(tag);
                if (!keys) {
                    keys = new Set();
                    this.tagIndex.set(tag, keys);
                }
                keys.add(key);
            }
        }
        this.evictIfNeeded();
    }
    async delete(key) {
        if (!this.map.has(key))
            return false;
        this.removeKey(key);
        return true;
    }
    async invalidateTag(tag) {
        const keys = this.tagIndex.get(tag);
        if (!keys || keys.size === 0)
            return 0;
        const now = Date.now();
        let removed = 0;
        for (const key of [...keys]) {
            const entry = this.map.get(key);
            if (!entry)
                continue;
            this.removeKey(key);
            if (!this.isExpired(entry, now))
                removed++;
        }
        this.tagIndex.delete(tag);
        return removed;
    }
    async incr(key, ttlSec) {
        const now = Date.now();
        const existing = this.map.get(key);
        if (existing && this.isExpired(existing, now)) {
            this.removeKey(key);
        }
        else if (existing) {
            const current = typeof existing.value === "number" ? existing.value : 0;
            const next = current + 1;
            existing.value = next;
            this.map.delete(key);
            this.map.set(key, existing);
            return next;
        }
        const entry = { value: 1 };
        if (ttlSec !== undefined)
            entry.expiresAt = now + ttlSec * 1000;
        this.map.set(key, entry);
        this.evictIfNeeded();
        return 1;
    }
    async health() {
        return true;
    }
    async close() {
        if (this.sweepTimer)
            clearInterval(this.sweepTimer);
    }
    size() {
        return this.map.size;
    }
    isExpired(entry, now) {
        return entry.expiresAt !== undefined && entry.expiresAt <= now;
    }
    removeKey(key) {
        this.map.delete(key);
        const tags = this.keyTags.get(key);
        if (tags) {
            for (const tag of tags) {
                const keys = this.tagIndex.get(tag);
                if (keys) {
                    keys.delete(key);
                    if (keys.size === 0)
                        this.tagIndex.delete(tag);
                }
            }
            this.keyTags.delete(key);
        }
    }
    evictIfNeeded() {
        if (this.map.size <= this.maxEntries)
            return;
        this.sweep(Date.now());
        while (this.map.size > this.maxEntries) {
            const oldest = this.map.keys().next().value;
            if (oldest === undefined)
                break;
            this.removeKey(oldest);
        }
    }
    sweep(now) {
        for (const [key, entry] of this.map) {
            if (this.isExpired(entry, now))
                this.removeKey(key);
        }
    }
}
