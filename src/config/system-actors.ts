/**
 * SLICE-236-1: System actor registry (D-235-30).
 *
 * Version-controlled configuration of platform-internal principals that
 * appear as raw `actor` strings in econ-ledger events. Every entry maps
 * (source, rawActor) → ActorRef {type: "SYSTEM"} via the pure matcher in
 * process-contracts (`resolveActor`).
 *
 * NOT env: these values shape interpretation of history — they need code
 * review + git history, not deploy-time config.
 *
 * Audit (2026-11-28, `actor:` literals that reach the ledger stream):
 *
 *   (board, "ops")            board/create.ts — createdByPassportId fallback
 *   (board, "sweeper")        board/bug-sweep.ts ×2, board/claim-sweep.ts ×3
 *   (board, "qa")             board/bug-loop.ts qa entry, board/qa.ts fallback
 *   (x402, "x402-gateway")    econ-ledger/x402-fulfillment.ts
 *
 * Non-ledger literal actors deliberately OUT of scope (different stores,
 * no econ-ledger projection): bounty transitions ("ops"/"system"/"sweeper"/
 * "evaluator"), payments ("stripe-webhook"), intel ("system:transfer"),
 * ai ("budget-guard"), knowledge gaps ("system"). If a new literal actor
 * starts emitting into the ledger stream, add a record here — the
 * (source, rawActor) pair must stay unique or the server refuses to start.
 *
 * SYSTEM ≠ SERVICE: all entries are platform-internal automation/ops, i.e.
 * SYSTEM. A future background *service-participant* gets its own record
 * with actorType "SERVICE" — do not reuse these principals.
 */

export interface SystemActorRecord {
  /** econ-ledger event source (`board`, `x402`, `supply_chain`, …). */
  readonly source: string;
  /** Raw actor string exactly as it appears in the event. */
  readonly rawActor: string;
  /** ActorRef.type — platform-internal principals are SYSTEM. */
  readonly actorType: "SYSTEM" | "SERVICE";
  /**
   * Canonical platform principal — becomes
   * `{namespace:"agentbadge:system", referenceType:"principal", value}`.
   */
  readonly principal: string;
  /** Where this actor is emitted — audit trail for reviewers. */
  readonly note: string;
}

export const SYSTEM_ACTORS: readonly SystemActorRecord[] = [
  {
    source: "board",
    rawActor: "ops",
    actorType: "SYSTEM",
    principal: "ops",
    note: "board/create.ts — operator card create without passportId",
  },
  {
    source: "board",
    rawActor: "sweeper",
    actorType: "SYSTEM",
    principal: "sweeper",
    note: "board/bug-sweep.ts, board/claim-sweep.ts — lease/deadline automation",
  },
  {
    source: "board",
    rawActor: "qa",
    actorType: "SYSTEM",
    principal: "qa",
    note: "board/bug-loop.ts qa entry; board/qa.ts `req.actor ?? \"qa\"` fallback",
  },
  {
    source: "x402",
    rawActor: "x402-gateway",
    actorType: "SYSTEM",
    principal: "x402-gateway",
    note: "econ-ledger/x402-fulfillment.ts — payment fulfillment emit",
  },
] as const;

/**
 * Startup guard — a duplicate (source, rawActor) makes resolution
 * order-dependent. Called at module load: a bad registry crashes the
 * server at boot rather than corrupting projections. Also exported so
 * tests can assert the check itself.
 */
export function assertSystemActorsUnique(
  records: readonly SystemActorRecord[] = SYSTEM_ACTORS,
): void {
  const seen = new Set<string>();
  for (const r of records) {
    const key = `${r.source}${r.rawActor}`;
    if (seen.has(key)) {
      throw new Error(
        `system-actors: duplicate (source, rawActor)=(${r.source}, ${r.rawActor})`,
      );
    }
    seen.add(key);
  }
}

assertSystemActorsUnique();
