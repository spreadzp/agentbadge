/**
 * SLICE-236-3: supply-chain adapter — handoff → ProcessEventProjection.
 *
 * Events mirror the live dogfood 3-hop chain (org→agent→device→restaurant)
 * exactly as shipment.ts emits them: source "supply_chain", kind "handoff",
 * actor/counterparty = 0x wallets, roles.custodian == counterparty.
 * Resolution runs through the real 236-2 ActorResolver on stub ports —
 * the test exercises the whole rail, not a mock.
 */
import { describe, expect, it } from "vitest";
import { createActorResolver } from "../../src/server/lib/process/resolver/actor-resolver";
import type {
  ActorIdentityRow,
  Erc8004Registration,
} from "../../src/server/lib/process/resolver/types";
import { createAdapterRegistry } from "../../src/server/lib/process/adapters";
import { createSupplyChainAdapter } from "../../src/server/lib/process/adapters/supply-chain";
import type { EconomicEventLike } from "../../src/server/lib/process/adapters/types";

const CHAIN = 1874;
const ORG = `0x${"aa".repeat(20)}`;
const AGENT = `0x${"bb".repeat(20)}`;
const DEVICE = `0x${"cc".repeat(20)}`;
const RESTAURANT = `0x${"dd".repeat(20)}`;
const SHIPMENT = "fish-114";

const handoff = (
  hopIndex: number,
  actor: string,
  counterparty: string,
  extra: Record<string, unknown> = {},
): EconomicEventLike => ({
  source: "supply_chain",
  sourceId: SHIPMENT,
  seq: 4 + hopIndex * 4, // seqFor(hopIndex,"handoff") = 2+i*4+2
  kind: "handoff",
  actor,
  counterparty,
  at: "2026-11-28T12:00:00.000Z",
  idempotencyKey: `ev:supply_chain:${SHIPMENT}:${4 + hopIndex * 4}`,
  payload: { shipmentId: SHIPMENT, hopIndex, ...extra },
});

/** Dogfood identity: every hop party is a registered agent row. */
const deps = (extra?: {
  actors?: Map<string, ActorIdentityRow>;
  regs?: Erc8004Registration[];
}) => {
  const actorRows = extra?.actors ?? DOGFOOD_ROWS;
  return createActorResolver({
    actors: { getById: async (w) => actorRows.get(w) ?? null },
    erc8004: {
      get: async () => undefined,
      list: async () => extra?.regs ?? [],
    },
    defaultChainId: CHAIN,
  });
};

const DOGFOOD_ROWS = new Map<string, ActorIdentityRow>(
  [ORG, AGENT, DEVICE, RESTAURANT].map((w) => [
    w,
    { type: "EXTERNAL_AGENT" },
  ]),
);

const adapter = () =>
  createSupplyChainAdapter({ resolver: deps(), chainId: CHAIN });

describe("supply-chain adapter — handoff (SLICE-236-3)", () => {
  it("all 3 dogfood hops → SUPPORTED with full subjectRefs", async () => {
    const a = adapter();
    const hops: [number, string, string][] = [
      [0, ORG, AGENT],
      [1, AGENT, DEVICE],
      [2, DEVICE, RESTAURANT],
    ];
    for (const [i, actor, cp] of hops) {
      const p = await a.project(handoff(i, actor, cp));
      expect(p.mapping.status, `hop ${i}`).toBe("SUPPORTED");
      expect(p.mapping.issues).toEqual([]);
      expect(p.projectionVersion).toBe("process-event-projection/1");
      expect(p.interpretation.stepType).toBe("supply-chain.handoff");
      const subject = p.interpretation.subjectRefs[0];
      expect(subject?.assetType).toBe("physical.batch");
      expect(subject?.domain).toBe("supply-chain");
      expect(subject?.externalReferences[0]).toEqual({
        namespace: "agentbadge:supply-chain",
        referenceType: "shipment",
        value: SHIPMENT,
      });
      // hander-offer + receiver resolved (EXTERNAL_AGENT → AI_AGENT)
      expect(p.interpretation.actorRefs).toHaveLength(2);
      for (const ref of p.interpretation.actorRefs) {
        expect(ref.type).toBe("AI_AGENT");
        expect(ref.externalReferences[0]?.namespace).toBe(`eip155:${CHAIN}`);
      }
      expect(p.sourceEvent).toEqual({
        spec: "econ-events/1",
        id: `ev:supply_chain:${SHIPMENT}:${4 + i * 4}`,
        source: "supply_chain",
        sourceId: SHIPMENT,
        seq: 4 + i * 4,
      });
      expect(p.interpretation.domainData?.hopIndex).toBe(i);
    }
  });

  it("roles resolve via resolver; custodian == counterparty dedupes", async () => {
    const a = adapter();
    const p = await a.project(
      handoff(0, ORG, AGENT, {
        roles: {
          custodian: { address: AGENT, type: "agent", label: "Plant intake" },
          operator: { address: ORG, type: "org", label: "FishCo ops" },
        },
      }),
    );
    expect(p.mapping.status).toBe("SUPPORTED");
    // actor=ORG, counterparty=AGENT, custodian=AGENT (dup), operator=ORG (dup)
    expect(p.interpretation.actorRefs).toHaveLength(2);
    expect(p.interpretation.domainData?.roles).toBeDefined();
  });

  it("unknown actor → PARTIAL + ACTOR_UNRESOLVED with the slot field", async () => {
    const a = adapter();
    const ghost = `0x${"ff".repeat(20)}`;
    const p = await a.project(handoff(1, ghost, DEVICE));
    expect(p.mapping.status).toBe("PARTIAL");
    expect(p.interpretation.subjectRefs).toHaveLength(1);
    // receiver still resolved — partial, not failed
    expect(p.interpretation.actorRefs).toHaveLength(1);
    expect(p.mapping.issues).toEqual([
      { code: "ACTOR_UNRESOLVED", field: "actor", message: ghost },
    ]);
  });

  it("determinism: same event → bit-for-bit identical projection", async () => {
    const a = adapter();
    const e = handoff(1, AGENT, DEVICE, {
      what: "reefer van leg",
      roles: { custodian: { address: DEVICE, type: "device" } },
    });
    const [p1, p2] = await Promise.all([a.project(e), a.project(e)]);
    expect(p2).toEqual(p1);
    expect(JSON.stringify(p2)).toBe(JSON.stringify(p1));
  });

  it("ambiguous actor resolution → AMBIGUOUS projection", async () => {
    const twoRegs: Erc8004Registration[] = [
      {
        agentId: "eip155:1874:0x2222222222222222222222222222222222222222:1",
        owner: AGENT,
        status: "active",
      },
      {
        agentId: "eip155:1874:0x2222222222222222222222222222222222222222:2",
        owner: AGENT,
        status: "active",
      },
    ];
    const rows = new Map(DOGFOOD_ROWS);
    rows.delete(AGENT);
    const a = createSupplyChainAdapter({
      resolver: deps({ actors: rows, regs: twoRegs }),
      chainId: CHAIN,
    });
    const p = await a.project(handoff(1, AGENT, DEVICE));
    expect(p.mapping.status).toBe("AMBIGUOUS");
    expect(p.mapping.issues[0]?.code).toBe("AMBIGUOUS_SOURCE");
  });

  it("missing shipmentId → ASSET_REF_MISSING + PARTIAL", async () => {
    const a = adapter();
    const e = handoff(0, ORG, AGENT);
    delete (e.payload as Record<string, unknown>).shipmentId;
    const p = await a.project(e);
    expect(p.mapping.status).toBe("PARTIAL");
    expect(p.interpretation.subjectRefs).toHaveLength(0);
    expect(p.mapping.issues.some((i) => i.code === "ASSET_REF_MISSING")).toBe(
      true,
    );
  });

  it("adapter version + id ride mapping", async () => {
    const a = adapter();
    const p = await a.project(handoff(0, ORG, AGENT));
    expect(p.mapping.adapter).toBe("supply-chain");
    expect(p.mapping.version).toBe("0.1.0");
  });
});

describe("adapter registry (D-236-Q1/Q4)", () => {
  it("unmapped kind on a claimed source → UNSUPPORTED + TYPE_UNKNOWN", async () => {
    const reg = createAdapterRegistry([adapter()]);
    const p = await reg.project(handoff(0, ORG, AGENT, {}));
    expect(p.mapping.status).toBe("SUPPORTED"); // sanity: registry routes
    const pay = await reg.project({
      ...handoff(0, ORG, AGENT),
      kind: "pay",
      seq: 5,
    });
    expect(pay.mapping.status).toBe("UNSUPPORTED");
    expect(pay.mapping.adapter).toBe("supply-chain");
    expect(pay.mapping.issues[0]?.code).toBe("TYPE_UNKNOWN");
  });

  it("unclaimed source → UNSUPPORTED via registry fallback", async () => {
    const reg = createAdapterRegistry([adapter()]);
    const p = await reg.project({
      source: "bounty",
      sourceId: "b-1",
      seq: 1,
      kind: "transition",
      actor: "ops",
    });
    expect(p.mapping.status).toBe("UNSUPPORTED");
    expect(p.mapping.adapter).toBe("unmapped");
    expect(p.mapping.issues[0]?.code).toBe("TYPE_UNKNOWN");
  });
});
