import { Repository } from "../repository.js";
import type { ScanResult, ScanResultCreate, ScanResultStore, ScanResultUpdate } from "../store.js";
import type { PrismaDb } from "./event-repository.js";
export declare class ScanResultRepository extends Repository<ScanResult, ScanResultCreate, ScanResultUpdate> implements ScanResultStore {
    private readonly db;
    constructor(db: PrismaDb);
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
