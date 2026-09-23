import { Repository } from "../repository.js";
export class ScanResultRepository extends Repository {
    db;
    constructor(db) {
        super();
        this.db = db;
    }
    async findById(id) {
        return this.db.orm.public.ScanResult.where({ id }).first();
    }
    async list(opts) {
        let q = this.db.orm.public.ScanResult.orderBy((s) => s.createdAt.desc());
        if (opts?.offset !== undefined)
            q = q.offset(opts.offset);
        if (opts?.limit !== undefined)
            q = q.limit(opts.limit);
        return q.all();
    }
    async create(data) {
        return this.db.orm.public.ScanResult.create(data);
    }
    async update(id, data) {
        return this.db.orm.public.ScanResult.where({ id }).update(data);
    }
    async delete(id) {
        return (await this.db.orm.public.ScanResult.where({ id }).delete()) !== null;
    }
    async latestByDomain(domain) {
        return this.db.orm.public.ScanResult.where({ domain })
            .orderBy((s) => s.createdAt.desc())
            .first();
    }
    async listByDomain(domain, opts) {
        let q = this.db.orm.public.ScanResult.where({ domain }).orderBy((s) => s.createdAt.desc());
        if (opts?.offset !== undefined)
            q = q.offset(opts.offset);
        if (opts?.limit !== undefined)
            q = q.limit(opts.limit);
        return q.all();
    }
}
