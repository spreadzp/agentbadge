import { Repository } from "../repository.js";
import type { PrismaDb } from "./event-repository.js";
import type { ChatSubscription, ChatSubscriptionCreate, ChatSubscriptionStore, ChatSubscriptionUpdate } from "../store.js";
export declare class ChatSubscriptionRepository extends Repository<ChatSubscription, ChatSubscriptionCreate, ChatSubscriptionUpdate> implements ChatSubscriptionStore {
    private readonly db;
    constructor(db: PrismaDb);
    findById(id: string): Promise<ChatSubscription | null>;
    list(opts?: {
        limit?: number;
        offset?: number;
    }): Promise<ChatSubscription[]>;
    create(data: ChatSubscriptionCreate): Promise<ChatSubscription>;
    update(id: string, data: ChatSubscriptionUpdate): Promise<ChatSubscription | null>;
    delete(id: string): Promise<boolean>;
    upsert(chatId: ChatSubscription["chatId"], username: string): Promise<ChatSubscription>;
    findByUsername(username: string): Promise<ChatSubscription | null>;
}
