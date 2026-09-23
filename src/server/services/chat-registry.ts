/**
 * SLICE-145-3: Chat Registry service (D9).
 *
 * Telegram chat_id ↔ username bindings that survive deploys. Async
 * write-through to `ChatSubscription` rows + sync reads over a hydrated
 * in-memory Map (D3) — the hot path (`alertTick` every minute, webhook
 * `register`) never waits on PG.
 *
 * - `register()` — async: Map update is synchronous (immediate visibility
 *   for sync callers), then awaits hydration and writes through to the DB.
 *   Duplicate (chatId, username) → upsert, never an error.
 * - `has()` / `list()` / `findByUsername()` — sync, read the hydrated Map.
 * - `hydrate()` — loads all rows into the Map; call at bot boot (D11).
 *   `register()` also awaits it internally, so a webhook arriving before
 *   boot-hydrate finishes still sees a deterministic registry.
 * - `DATABASE_ENABLED=false` / config unavailable → pure in-memory
 *   (zero behavior change vs the old Map-only registry).
 */

import type { ChatSubscriptionStore } from "@agentbadge/database";

import { getDatabase } from "../lib/database";

export interface ChatEntry {
  chatId: number;
  username: string;
}

export class ChatRegistry {
  private readonly chats = new Map<number, string>();
  private hydratePromise: Promise<void> | null = null;

  /**
   * Bind chat_id ↔ username. The Map update is synchronous; the DB
   * write-through is awaited by async callers but never required for
   * correctness of sync readers.
   */
  async register(chatId: number, username: string): Promise<void> {
    this.chats.set(chatId, username);
    await this.ensureHydrated();
    const store = this.store();
    if (!store) return;
    try {
      await store.upsert(BigInt(chatId), username);
    } catch {
      // Durability is best-effort — the Map already serves reads.
    }
  }

  list(): ChatEntry[] {
    return [...this.chats.entries()].map(([chatId, username]) => ({
      chatId,
      username,
    }));
  }

  has(chatId: number): boolean {
    return this.chats.has(chatId);
  }

  /** Reverse lookup — username (with or without @) → chat_id. */
  findByUsername(username: string): number | undefined {
    const needle = username.replace(/^@/, "").toLowerCase();
    for (const [chatId, name] of this.chats) {
      if (name.replace(/^@/, "").toLowerCase() === needle) return chatId;
    }
    return undefined;
  }

  /**
   * Load all persisted bindings into the Map. Idempotent; safe to call at
   * boot and from `register()`. Rows already in the Map are NOT overwritten
   * — a local `register()` during boot is newer than the stored row.
   */
  async hydrate(): Promise<void> {
    const store = this.store();
    if (!store) return;
    try {
      const rows = await store.list();
      for (const row of rows) {
        const chatId = Number(row.chatId);
        if (!this.chats.has(chatId)) {
          this.chats.set(chatId, row.username);
        }
      }
    } catch {
      // DB unreachable — stay in-memory; next register() retries.
    }
  }

  /** Test hook — drop hydration state so the next access rehydrates. */
  resetForTests(): void {
    this.chats.clear();
    this.hydratePromise = null;
  }

  private ensureHydrated(): Promise<void> {
    return (this.hydratePromise ??= this.hydrate());
  }

  private store(): ChatSubscriptionStore | null {
    try {
      return getDatabase().chatSubscriptions;
    } catch {
      return null;
    }
  }
}
