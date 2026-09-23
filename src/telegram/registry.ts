/**
 * Telegram chat registry (EPIC-141, SLICE-141-9; moved in SLICE-145-3).
 * Barrel re-export — implementation lives in services/chat-registry.ts (D9:
 * stateful stores live under services/). Imports from this module keep
 * working unchanged.
 */

export { ChatRegistry } from "../server/services/chat-registry";
export type { ChatEntry } from "../server/services/chat-registry";
