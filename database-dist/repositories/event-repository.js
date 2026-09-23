import { Repository } from "../repository.js";
export class EventRepository extends Repository {
    db;
    constructor(db) {
        super();
        this.db = db;
    }
    async findById(id) {
        return this.db.orm.public.Event.where({ id }).first();
    }
    async list(opts) {
        let q = this.db.orm.public.Event.orderBy((e) => e.createdAt.desc());
        if (opts?.type !== undefined) {
            q = q.where({ type: opts.type });
        }
        if (opts?.offset !== undefined)
            q = q.offset(opts.offset);
        if (opts?.limit !== undefined)
            q = q.limit(opts.limit);
        return q.all();
    }
    async create(data) {
        return this.db.orm.public.Event.create(data);
    }
    async update(id, data) {
        return this.db.orm.public.Event.where({ id }).update(data);
    }
    async delete(id) {
        return (await this.db.orm.public.Event.where({ id }).delete()) !== null;
    }
}
