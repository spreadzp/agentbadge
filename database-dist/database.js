import postgres from "@prisma/orm-postgres/runtime";
import contractJson from "./prisma/contract.json" with { type: "json" };
import { EventRepository } from "./repositories/event-repository.js";
import { ScanResultRepository } from "./repositories/scan-result-repository.js";
import { ChatSubscriptionRepository } from "./repositories/chat-subscription-repository.js";
import { InMemoryChatSubscriptionStore, InMemoryScanResultStore, InMemoryStore, } from "./store.js";
export function createDatabase(config) {
    const enabled = config.enabled !== false && Boolean(config.url);
    if (!enabled) {
        const events = new InMemoryStore();
        return {
            db: null,
            events,
            scanResults: new InMemoryScanResultStore(),
            chatSubscriptions: new InMemoryChatSubscriptionStore(),
            health: () => Promise.resolve(false),
            close: () => Promise.resolve(),
        };
    }
    const db = postgres({ contractJson, url: config.url });
    return {
        db,
        events: new EventRepository(db),
        scanResults: new ScanResultRepository(db),
        chatSubscriptions: new ChatSubscriptionRepository(db),
        health: async () => {
            try {
                const plan = db.raw.sql `SELECT 1 AS health`.returnsRow({ health: "pg/int4@1" }).build();
                await db.runtime().query(plan);
                return true;
            }
            catch {
                return false;
            }
        },
        close: () => db.close(),
    };
}
