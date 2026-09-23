import { type PrismaDb } from "./repositories/event-repository.js";
import { type ChatSubscriptionStore, type ScanResultStore, type Store } from "./store.js";
export interface DatabaseConfig {
    url?: string;
    enabled?: boolean;
}
export interface Database {
    db: PrismaDb | null;
    events: Store;
    scanResults: ScanResultStore;
    chatSubscriptions: ChatSubscriptionStore;
    health(): Promise<boolean>;
    close(): Promise<void>;
}
export declare function createDatabase(config: DatabaseConfig): Database;
