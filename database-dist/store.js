import { randomUUID } from "node:crypto";
export class InMemoryStore {
    events = new Map();
    async findById(id) {
        return this.events.get(id) ?? null;
    }
    async list(opts) {
        let all = [...this.events.values()].reverse();
        if (opts?.type !== undefined) {
            all = all.filter((e) => e.type === opts.type);
        }
        const offset = opts?.offset ?? 0;
        const limit = opts?.limit ?? all.length;
        return all.slice(offset, offset + limit);
    }
    async create(data) {
        const now = new Date().toISOString();
        const event = {
            id: data.id ?? randomUUID(),
            type: data.type,
            payload: data.payload,
            source: data.source ?? null,
            createdAt: now,
            updatedAt: now,
        };
        this.events.set(event.id, event);
        return event;
    }
    async update(id, data) {
        const existing = this.events.get(id);
        if (!existing)
            return null;
        const updated = {
            ...existing,
            ...(data.type !== undefined ? { type: data.type } : {}),
            ...(data.payload !== undefined ? { payload: data.payload } : {}),
            ...(data.source !== undefined ? { source: data.source } : {}),
            updatedAt: new Date().toISOString(),
        };
        this.events.set(id, updated);
        return updated;
    }
    async delete(id) {
        return this.events.delete(id);
    }
}
export class InMemoryScanResultStore {
    rows = new Map();
    async findById(id) {
        return this.rows.get(id) ?? null;
    }
    async list(opts) {
        const all = [...this.rows.values()].reverse();
        const offset = opts?.offset ?? 0;
        const limit = opts?.limit ?? all.length;
        return all.slice(offset, offset + limit);
    }
    async create(data) {
        const now = new Date().toISOString();
        const row = {
            id: data.id ?? randomUUID(),
            domain: data.domain,
            url: data.url,
            score: data.score ?? null,
            report: data.report,
            rulesetVersion: data.rulesetVersion ?? null,
            createdAt: now,
            updatedAt: now,
        };
        this.rows.set(row.id, row);
        return row;
    }
    async update(id, data) {
        const existing = this.rows.get(id);
        if (!existing)
            return null;
        const updated = {
            ...existing,
            ...(data.domain !== undefined ? { domain: data.domain } : {}),
            ...(data.url !== undefined ? { url: data.url } : {}),
            ...(data.score !== undefined ? { score: data.score } : {}),
            ...(data.report !== undefined ? { report: data.report } : {}),
            ...(data.rulesetVersion !== undefined
                ? { rulesetVersion: data.rulesetVersion }
                : {}),
            updatedAt: new Date().toISOString(),
        };
        this.rows.set(id, updated);
        return updated;
    }
    async delete(id) {
        return this.rows.delete(id);
    }
    async latestByDomain(domain) {
        const [latest] = await this.listByDomain(domain, { limit: 1 });
        return latest ?? null;
    }
    async listByDomain(domain, opts) {
        const matching = [...this.rows.values()]
            .filter((r) => r.domain === domain)
            .reverse()
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const offset = opts?.offset ?? 0;
        const limit = opts?.limit ?? matching.length;
        return matching.slice(offset, offset + limit);
    }
}
export class InMemoryChatSubscriptionStore {
    rows = new Map();
    async findById(id) {
        return this.rows.get(id) ?? null;
    }
    async list(opts) {
        const all = [...this.rows.values()];
        const offset = opts?.offset ?? 0;
        const limit = opts?.limit ?? all.length;
        return all.slice(offset, offset + limit);
    }
    async create(data) {
        const now = new Date().toISOString();
        const row = {
            id: data.id ?? randomUUID(),
            chatId: data.chatId,
            username: data.username,
            createdAt: now,
            updatedAt: now,
        };
        this.rows.set(row.id, row);
        return row;
    }
    async update(id, data) {
        const existing = this.rows.get(id);
        if (!existing)
            return null;
        const updated = {
            ...existing,
            ...(data.chatId !== undefined ? { chatId: data.chatId } : {}),
            ...(data.username !== undefined ? { username: data.username } : {}),
            updatedAt: new Date().toISOString(),
        };
        this.rows.set(id, updated);
        return updated;
    }
    async delete(id) {
        return this.rows.delete(id);
    }
    async upsert(chatId, username) {
        const existing = [...this.rows.values()].find((r) => r.chatId === chatId || r.username === username);
        if (existing) {
            const updated = {
                ...existing,
                chatId,
                username,
                updatedAt: new Date().toISOString(),
            };
            this.rows.set(existing.id, updated);
            return updated;
        }
        return this.create({ chatId, username });
    }
    async findByUsername(username) {
        return ([...this.rows.values()].find((r) => r.username === username) ?? null);
    }
}
