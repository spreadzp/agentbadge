import { InMemoryCache } from "./memory.js";
import { ValkeyCache } from "./valkey.js";
import { UpstashCache } from "./upstash.js";
export function createCache(config = {}) {
    if (!config.enabled)
        return new InMemoryCache();
    try {
        switch (config.backend) {
            case "valkey":
                if (!config.url)
                    return new InMemoryCache();
                return new ValkeyCache(config.url);
            case "upstash":
                if (!config.url || !config.token)
                    return new InMemoryCache();
                return new UpstashCache(config.url, config.token);
            case "memory":
            default:
                return new InMemoryCache();
        }
    }
    catch {
        return new InMemoryCache();
    }
}
