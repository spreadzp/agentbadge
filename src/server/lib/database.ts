/**
 * Database singleton (EPIC-143, SLICE-143-4).
 *
 * Lazy wrapper over `createDatabase()` from @agentbadge/database.
 * Importing this module never connects — the handle is built on first
 * `getDatabase()` call. When `DATABASE_ENABLED` is unset the config section
 * is absent and the factory returns an in-memory store (zero behavior
 * change).
 *
 * `close()` is called once from the server shutdown handler — never
 * per-request (shared pool).
 */

import { createDatabase, type Database } from "@agentbadge/database";

import { getConfig } from "../../config/env";

let instance: Database | null = null;

export function getDatabase(): Database {
  if (!instance) {
    const section = getConfig().database;
    instance = createDatabase({
      enabled: section?.enabled ?? false,
      url: section?.url,
    });
  }
  return instance;
}

/** Test hook — drop the cached handle so the next call rebuilds it. */
export function resetDatabaseForTests(): void {
  instance = null;
}
