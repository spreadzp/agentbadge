import { Repository } from "../repository.js";
export class ChatSubscriptionRepository extends Repository {
    db;
    constructor(db) {
        super();
        this.db = db;
    }
    async findById(id) {
        return this.db.orm.public.ChatSubscription.where({ id }).first();
    }
    async list(opts) {
        let q = this.db.orm.public.ChatSubscription.orderBy((s) => s.createdAt.asc());
        if (opts?.offset !== undefined)
            q = q.offset(opts.offset);
        if (opts?.limit !== undefined)
            q = q.limit(opts.limit);
        return q.all();
    }
    async create(data) {
        return this.db.orm.public.ChatSubscription.create(data);
    }
    async update(id, data) {
        return this.db.orm.public.ChatSubscription.where({ id }).update(data);
    }
    async delete(id) {
        return ((await this.db.orm.public.ChatSubscription.where({ id }).delete()) !==
            null);
    }
    async upsert(chatId, username) {
        return this.db.orm.public.ChatSubscription.upsert({
            create: { chatId, username },
            update: { chatId, username },
            conflictOn: { chatId },
        });
    }
    async findByUsername(username) {
        return this.db.orm.public.ChatSubscription.where({ username }).first();
    }
}
