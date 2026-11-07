/**
 * SLICE-214-1 (D-214-2): makeChain() — the shared multi-role chain
 * fixture. Single source for the scenario matrix (214-2/214-3) and
 * the 216-1 dogfood scaffold. Test-helpers only — no production code.
 *
 * Drives a shipment through accept → handoff(roles+evidence) → settle
 * → verify on InMemoryHopExecutor (deterministic jobIds, injected
 * failOnSettleJobId seam for the double-settle scenario). Returns the
 * LIVE deps + actor helpers so scenarios keep driving the same chain.
 */

import { createDatabase, type Database } from "@agentbadge/database";
import {
  acceptShipment,
  createShipment,
  handoffHop,
  settleHop,
  verifyHop,
  shipmentState,
} from "../../../src/server/lib/econ-ledger/supply-chain/shipment";
import { InMemoryHopExecutor } from "../../../src/server/lib/econ-ledger/supply-chain/executor";
import type {
  HopJobExecutor,
  HopSpec,
  ShipmentDeps,
} from "../../../src/server/lib/econ-ledger/supply-chain/types";

const DEFAULT_CLIENT = ("0x" + "aa".repeat(20)) as `0x${string}`;

/** Deterministic receiver for `hops: N` shorthand — 0x0..01, 0x0..02… */
function defaultReceiver(hopIndex: number): `0x${string}` {
  return `0x${String(hopIndex + 1).padStart(40, "0")}` as `0x${string}`;
}

/** Per-hop input — HopSpec fields double as the handoff EPCIS claims;
 *  roles/evidenceRefs are RAW (strict write-parse happens inside
 *  handoffHop, same as production — never pre-parse here). */
export interface ChainHopInput extends HopSpec {
  roles?: unknown;
  evidenceRefs?: unknown;
  proofOfDelivery?: string;
  deliverableHash?: `0x${string}`;
  /** Skip settle for this hop (leaves it handed_off). */
  skipSettle?: boolean;
  /** Skip handoff for this hop (leaves it offered — implies no settle). */
  skipHandoff?: boolean;
}

export interface ChainHopCtx {
  hopIndex: number;
  receiver: `0x${string}`;
}

/** How far the fixture drives the chain. Default "settled" — every
 *  hop accept → handoff → settle. "offered" = offer only (scenarios
 *  drive manually), "verified" = + verifyHop("pass") per hop. */
export type ChainLifecycle = "offered" | "settled" | "verified";

export interface MakeChainOptions {
  /** Defaults to a deterministic `shp-chain-<ts>` — pass a stable id
   *  when the scenario correlates executor.failOnSettleJobId. */
  shipmentId?: string;
  client?: `0x${string}`;
  /** Hop count shorthand (default 3) or explicit per-hop inputs. */
  hops?: number | ChainHopInput[];
  /** Roles applied to every hop — a raw object or a factory keyed by
   *  {hopIndex, receiver} (use the factory to bind custodian == the
   *  hop's receiver, required by the write-side H-2 guard). */
  roles?: unknown | ((hop: ChainHopCtx) => unknown);
  /** Evidence applied to every hop: a count N (auto-generates N refs
   *  per hop, issuer = receiver → issuerMatchesParty true), a raw
   *  array, or a per-hop factory. Per-hop `hops[i].evidenceRefs` wins. */
  evidencePerHop?:
    | number
    | unknown[]
    | ((hop: ChainHopCtx) => unknown);
  executor?: HopJobExecutor;
  db?: Database;
  lifecycle?: ChainLifecycle;
}

export interface MadeChain {
  shipmentId: string;
  client: `0x${string}`;
  receivers: `0x${string}`[];
  /** HopSpec[] passed to createShipment. */
  specs: HopSpec[];
  /** Resolved per-hop evidence refs (index = hopIndex). */
  evidenceRefs: (unknown[] | undefined)[];
  /** Job refs from createShipment (index = hopIndex). */
  jobs: Array<{ hopIndex: number; jobId?: string }>;
  deps: ShipmentDeps & { executor: HopJobExecutor };
  executor: HopJobExecutor;
  db: Database;
  /** Deterministic InMemoryHopExecutor id — the failOnSettleJobId key. */
  jobId(hopIndex: number): string;
  /** Custody holder that must call handoffHop for hop i: the client at
   *  hop 0, else the previous hop's receiver. */
  handoffActor(hopIndex: number): `0x${string}`;
  /** Evaluator that verifies hop i: next hop's receiver, else client. */
  verifyActor(hopIndex: number): `0x${string}`;
  state(): Promise<Awaited<ReturnType<typeof shipmentState>>>;
}

let autoSeq = 0;

export async function makeChain(opts: MakeChainOptions = {}): Promise<MadeChain> {
  const shipmentId = opts.shipmentId ?? `shp-chain-${Date.now()}-${autoSeq++}`;
  const client = opts.client ?? DEFAULT_CLIENT;
  const db = opts.db ?? ({ ...createDatabase({ enabled: false }), db: {} as Database["db"] } as Database);
  const executor = opts.executor ?? new InMemoryHopExecutor();

  const hopInputs: ChainHopInput[] = typeof opts.hops === "number" || opts.hops === undefined
    ? Array.from({ length: opts.hops ?? 3 }, (_, i) => ({
        receiver: defaultReceiver(i),
        amountUsdc: "10",
      }))
    : opts.hops;
  const specs: HopSpec[] = hopInputs.map(({ roles: _r, evidenceRefs: _e, proofOfDelivery: _p, deliverableHash: _d, skipSettle: _s, skipHandoff: _h, ...hop }) => hop);
  const receivers = specs.map((h) => h.receiver);

  const ctx = (hopIndex: number): ChainHopCtx => ({ hopIndex, receiver: receivers[hopIndex]! });
  const handoffActor = (hopIndex: number): `0x${string}` =>
    hopIndex === 0 ? client : receivers[hopIndex - 1]!;
  const verifyActor = (hopIndex: number): `0x${string}` =>
    receivers[hopIndex + 1] ?? client;

  const rolesFor = (i: number): unknown =>
    hopInputs[i]!.roles ??
    (typeof opts.roles === "function" ? opts.roles(ctx(i)) : opts.roles);

  const evidenceFor = (i: number): unknown => {
    const per = hopInputs[i]!.evidenceRefs;
    if (per !== undefined) return per;
    const eph = opts.evidencePerHop;
    if (eph === undefined) return undefined;
    if (typeof eph === "number") {
      return Array.from({ length: eph }, (_, j) => ({
        type: "document",
        hash: `0x${String(i * 32 + j + 1).padStart(64, "0")}`,
        issuer: { address: receivers[i]!, type: "org" },
      }));
    }
    return typeof eph === "function" ? eph(ctx(i)) : eph;
  };
  const evidenceRefs = hopInputs.map((_, i) => {
    const e = evidenceFor(i);
    return e === undefined ? undefined : (e as unknown[]);
  });

  const deps = { ledger: db.econLedger, executor };
  const { jobs } = await createShipment({ shipmentId, client, hops: specs }, deps);
  const lifecycle = opts.lifecycle ?? "settled";

  if (lifecycle !== "offered") {
    for (let i = 0; i < hopInputs.length; i++) {
      const input = hopInputs[i]!;
      const spec = specs[i]!;
      await acceptShipment(shipmentId, i, shipmentId, spec.receiver, deps);
      if (input.skipHandoff) continue;
      await handoffHop(
        shipmentId,
        i,
        {
          ...(input.deliverableHash ? { deliverableHash: input.deliverableHash } : {}),
          ...(input.proofOfDelivery ? { proofOfDelivery: input.proofOfDelivery } : {}),
        },
        handoffActor(i),
        spec.receiver,
        deps,
        // HopSpec's EPCIS fields ride the handoff as claims.
        spec.what || spec.where || spec.why
          ? { what: spec.what, where: spec.where, why: spec.why }
          : undefined,
        rolesFor(i),
        evidenceFor(i),
      );
      if (input.skipSettle) continue;
      await settleHop(shipmentId, i, spec.amountUsdc, client, spec.receiver, deps);
      if (lifecycle === "verified") {
        await verifyHop(shipmentId, i, "pass", verifyActor(i), spec.receiver, deps);
      }
    }
  }

  return {
    shipmentId,
    client,
    receivers,
    specs,
    evidenceRefs,
    jobs,
    deps,
    executor,
    db,
    jobId: (hopIndex) => `job-${shipmentId}-${hopIndex}`,
    handoffActor,
    verifyActor,
    state: () => shipmentState(deps.ledger, shipmentId),
  };
}
