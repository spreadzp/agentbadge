import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import type { Contract } from "../prisma/contract.d.js";
import { Repository } from "../repository.js";
import type { Event, EventCreate, EventUpdate, Store } from "../store.js";
export type PrismaDb = PostgresClient<Contract>;
export declare class EventRepository extends Repository<Event, EventCreate, EventUpdate> implements Store {
    private readonly db;
    constructor(db: PrismaDb);
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
