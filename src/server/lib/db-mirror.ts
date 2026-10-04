// SLICE-155-12: shared mirror + write-behind plumbing for the
// createDb*Store adapters. Same semantics as PrismaVenueStore:
// reads serve an in-memory mirror hydrated at construction;
// writes update the mirror synchronously and enqueue a serialized
// persist op that never throws (failures are logged).

import { logger } from "@agentbadge/passport";

export class DbWriteBehind {
  private writeChain: Promise<void> = Promise.resolve();
  private readonly initPromise: Promise<void>;

  constructor(
    scope: string,
    hydrate: () => Promise<void>,
  ) {
    this.initPromise = hydrate().catch((err) => {
      logger.error(`${scope}: db-store init failed`, { err: String(err) });
    });
  }

  /** Resolves when mirror hydration finished (or logged-failed). */
  ready(): Promise<void> {
    return this.initPromise;
  }

  /** Serialize a persistence op; failures are logged, never thrown. */
  enqueue(op: () => Promise<unknown>): void {
    this.writeChain = this.writeChain.then(() =>
      op().then(
        () => undefined,
        (err) =>
          logger.error("db write-behind failed", { err: String(err) }),
      ),
    );
  }

  /** Test/flush hook — resolves when all queued writes landed. */
  flush(): Promise<void> {
    return this.writeChain;
  }
}
