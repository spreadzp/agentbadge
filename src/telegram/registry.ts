/**
 * Telegram chat registry (EPIC-141, SLICE-141-9).
 * DM model: bot remembers chat_id ↔ username on first message (Q30).
 * In-memory; optional file persistence can be added later.
 */

export interface ChatEntry {
  chatId: number;
  username: string;
}

export class ChatRegistry {
  private readonly chats = new Map<number, string>();

  register(chatId: number, username: string): void {
    this.chats.set(chatId, username);
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
}
