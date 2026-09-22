/**
 * Telegram subscriptions (EPIC-141, SLICE-141-10).
 *
 * DM model (Q30): an agent subscribes a Telegram username via MCP tool;
 * the server binds agent-token → username → chat_id. The chat_id is only
 * known once the user has written to the bot (ChatRegistry). Alerts go
 * only to subscribed chats. In-memory — no DB.
 */

import type { ChatRegistry } from "./registry";

export interface Subscription {
  username: string;
  chatId: number;
}

export class TelegramSubscriptions {
  /** agentId → subscription */
  private readonly subs = new Map<string, Subscription>();

  constructor(private readonly registry: ChatRegistry) {}

  /**
   * Bind agent → username → chat_id.
   * Returns null when the username is unknown (user never wrote to the bot).
   */
  subscribe(agentId: string, username: string): Subscription | null {
    const chatId = this.registry.findByUsername(username);
    if (chatId === undefined) return null;
    const sub = { username, chatId };
    this.subs.set(agentId, sub);
    return sub;
  }

  unsubscribe(agentId: string): boolean {
    return this.subs.delete(agentId);
  }

  status(agentId: string): Subscription | null {
    return this.subs.get(agentId) ?? null;
  }

  /** Chat ids that currently receive alerts/digests. */
  subscribedChatIds(): number[] {
    return [...this.subs.values()].map((s) => s.chatId);
  }
}
