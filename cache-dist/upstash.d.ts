import { RedisCacheBase } from "./redis-base.js";
export declare class UpstashCache extends RedisCacheBase {
    constructor(url: string, token: string);
}
