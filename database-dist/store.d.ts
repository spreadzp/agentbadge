import type { Models } from "./prisma/contract.d.js";
export type Event = Models.public_Event;
export type EventCreate = {
    type: string;
    payload: Event["payload"];
    source?: string | null;
    id?: string;
};
export type EventUpdate = Partial<Omit<EventCreate, "id">>;
export interface Store {
    findById(id: string): Promise<Event | null>;
    list(opts?: {
        limit?: number;
        offset?: number;
        type?: string;
    }): Promise<Event[]>;
    create(data: EventCreate): Promise<Event>;
    update(id: string, data: EventUpdate): Promise<Event | null>;
    delete(id: string): Promise<boolean>;
}
export declare class InMemoryStore implements Store {
    private readonly events;
    findById(id: string): Promise<Event | null>;
    list(opts?: {
        limit?: number;
        offset?: number;
        type?: string;
    }): Promise<Event[]>;
    create(data: EventCreate): Promise<Event>;
    update(id: string, data: EventUpdate): Promise<Event | null>;
    delete(id: string): Promise<boolean>;
}
export type ScanResult = Models.public_ScanResult;
export type ScanResultCreate = {
    domain: string;
    url: string;
    report: ScanResult["report"];
    score?: number | null;
    rulesetVersion?: string | null;
    id?: string;
};
export type ScanResultUpdate = Partial<Omit<ScanResultCreate, "id">>;
export interface ScanResultStore {
    findById(id: string): Promise<ScanResult | null>;
    list(opts?: {
        limit?: number;
        offset?: number;
    }): Promise<ScanResult[]>;
    create(data: ScanResultCreate): Promise<ScanResult>;
    update(id: string, data: ScanResultUpdate): Promise<ScanResult | null>;
    delete(id: string): Promise<boolean>;
    latestByDomain(domain: string): Promise<ScanResult | null>;
    listByDomain(domain: string, opts?: {
        limit?: number;
        offset?: number;
    }): Promise<ScanResult[]>;
}
export declare class InMemoryScanResultStore implements ScanResultStore {
    private readonly rows;
    findById(id: string): Promise<ScanResult | null>;
    list(opts?: {
        limit?: number;
        offset?: number;
    }): Promise<ScanResult[]>;
    create(data: ScanResultCreate): Promise<ScanResult>;
    update(id: string, data: ScanResultUpdate): Promise<ScanResult | null>;
    delete(id: string): Promise<boolean>;
    latestByDomain(domain: string): Promise<ScanResult | null>;
    listByDomain(domain: string, opts?: {
        limit?: number;
        offset?: number;
    }): Promise<ScanResult[]>;
}
export type ChatSubscription = Models.public_ChatSubscription;
export type ChatSubscriptionCreate = {
    chatId: ChatSubscription["chatId"];
    username: string;
    id?: string;
};
export type ChatSubscriptionUpdate = Partial<Omit<ChatSubscriptionCreate, "id">>;
export interface ChatSubscriptionStore {
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
export declare class InMemoryChatSubscriptionStore implements ChatSubscriptionStore {
    private readonly rows;
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
