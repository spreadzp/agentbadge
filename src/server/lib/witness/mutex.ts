/**
 * SLICE-185-6 (EPIC-185 audit fix): shared per-path async mutex.
 *
 * Extracted from store-json.ts so the witness job projection
 * (jobs.ts) serializes read-modify-write the same way the main
 * store does — a plain promise chain, no deps.
 */

/** Serializes async mutations — callers hold one instance per path. */
export function createMutex(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn);
    tail = next.catch(() => {});
    return next;
  };
}

/**
 * Mutex keyed by file path — shared for every writer touching the
 * same JSON registry (jobs.ts upserts run under this).
 */
const locks = new Map<string, ReturnType<typeof createMutex>>();

export function mutexFor(path: string): <T>(fn: () => Promise<T>) => Promise<T> {
  let lock = locks.get(path);
  if (!lock) {
    lock = createMutex();
    locks.set(path, lock);
  }
  return lock;
}
