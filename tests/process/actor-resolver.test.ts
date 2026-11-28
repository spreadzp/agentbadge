/**
 * SLICE-236-2: infrastructure ActorResolver — rail precedence
 * SYSTEM registry → ERC-8004 passport → principal → wallet (D-236-Q2),
 * source-aware matching (R2-8), no fabricated identities (D-235-16/21).
 *
 * Stub ports stand in for the actors table (@agentbadge/database),
 * the ERC-8004 registration store and the admin-operators repo —
 * the resolver never reaches past narrow read-only ports.
 */
import { describe, expect, it } from "vitest";
import {
  createActorResolver,
  type ActorResolverDeps,
} from "../../src/server/lib/process/resolver/actor-resolver";
import type {
  ActorIdentityRow,
  Erc8004Registration,
  PrincipalRecord,
} from "../../src/server/lib/process/resolver/types";

const REG_ADDR = "0x2222222222222222222222222222222222222222";
const AGENT_1 = `eip155:1874:${REG_ADDR}:42`;
const AGENT_2 = `eip155:1874:${REG_ADDR}:77`;
const CHAIN = 5042002;

const wallet = (seed: string) => `0x${seed.repeat(40)}`.slice(0, 42);
const WALLET_AGENT = wallet("a");
const WALLET_HUMAN = wallet("b");
const WALLET_OWNER = wallet("c");
const WALLET_TWO_AGENTS = wallet("d");
const WALLET_UNKNOWN = wallet("e");

const seed = () => {
  const actors = new Map<string, ActorIdentityRow>([
    [
      WALLET_AGENT.toLowerCase(),
      { type: "REGISTERED_AGENT", agentId: AGENT_1 },
    ],
    [
      WALLET_HUMAN.toLowerCase(),
      { type: "REGISTERED_USER", passportTokenId: "psp-9" },
    ],
  ]);
  const regs: Erc8004Registration[] = [
    { agentId: AGENT_1, owner: WALLET_AGENT, status: "active" },
    { agentId: AGENT_2, owner: WALLET_OWNER, status: "active" },
    {
      agentId: `eip155:1874:${REG_ADDR}:5`,
      owner: WALLET_TWO_AGENTS,
      status: "active",
    },
    {
      agentId: `eip155:1874:${REG_ADDR}:6`,
      owner: WALLET_TWO_AGENTS,
      status: "active",
    },
  ];
  const principals = new Map<string, PrincipalRecord>([
    ["op_alice", { id: "op_alice", principalType: "human" }],
    ["op_svc", { id: "op_svc", principalType: "service" }],
  ]);
  const deps: ActorResolverDeps = {
    actors: { getById: async (w) => actors.get(w.toLowerCase()) ?? null },
    erc8004: {
      get: async (id) => regs.find((r) => r.agentId === id),
      list: async () => regs,
    },
    principals: { byId: async (id) => principals.get(id) ?? null },
    defaultChainId: CHAIN,
  };
  return deps;
};

describe("actor-resolver (SLICE-236-2) — R2-8 scenarios", () => {
  it("system registry hit wins over everything (board/ops → SYSTEM)", async () => {
    const r = createActorResolver(seed());
    const res = await r.resolveActor("board", "ops");
    expect(res.status).toBe("RESOLVED");
    expect(res.actorRef?.type).toBe("SYSTEM");
    expect(res.actorRef?.externalReferences).toEqual([
      {
        namespace: "agentbadge:system",
        referenceType: "principal",
        value: "ops",
      },
    ]);
  });

  it("known wallet + chain context → registry-confirmed ActorRef", async () => {
    const r = createActorResolver(seed());
    const res = await r.resolveActor("supply_chain", WALLET_AGENT);
    expect(res.status).toBe("RESOLVED");
    expect(res.actorRef?.type).toBe("AI_AGENT");
    const keys = res.actorRef!.externalReferences.map(
      (e) => `${e.namespace}#${e.referenceType}#${e.value}`,
    );
    expect(keys).toContain(
      `erc8004:eip155:1874#agent-id#${AGENT_1.toLowerCase()}`,
    );
    // the wallet credential-ref qualifies to the link's chain (the
    // registry lives on eip155:1874), not the event's chain
    expect(keys).toContain(
      `eip155:1874#wallet#${WALLET_AGENT.toLowerCase()}`,
    );
  });

  it("ERC-8004 agentId string → AI_AGENT, owner wallet = credential-ref", async () => {
    const r = createActorResolver(seed());
    const res = await r.resolveActor("board", AGENT_1);
    expect(res.status).toBe("RESOLVED");
    expect(res.actorRef?.type).toBe("AI_AGENT");
    const keys = res.actorRef!.externalReferences.map(
      (e) => `${e.namespace}#${e.referenceType}#${e.value}`,
    );
    expect(keys).toContain(
      `erc8004:eip155:1874#agent-id#${AGENT_1.toLowerCase()}`,
    );
    expect(keys).toContain(
      `eip155:1874#wallet#${WALLET_AGENT.toLowerCase()}`,
    );
  });

  it("passport-bearing wallet row → HUMAN with passport + wallet refs", async () => {
    const r = createActorResolver(seed());
    const res = await r.resolveActor("supply_chain", WALLET_HUMAN);
    expect(res.status).toBe("RESOLVED");
    expect(res.actorRef?.type).toBe("HUMAN");
    const keys = res.actorRef!.externalReferences.map(
      (e) => `${e.namespace}#${e.referenceType}#${e.value}`,
    );
    expect(keys).toContain("agentbadge:passport#token-id#psp-9");
    expect(keys).toContain(
      `eip155:${CHAIN}#wallet#${WALLET_HUMAN.toLowerCase()}`,
    );
  });

  it("API principal → ref on the principal, never the credential", async () => {
    const r = createActorResolver(seed());
    const res = await r.resolveActor("admin", "op_alice");
    expect(res.status).toBe("RESOLVED");
    expect(res.actorRef?.type).toBe("HUMAN");
    expect(res.actorRef?.externalReferences).toEqual([
      {
        namespace: "agentbadge:operator",
        referenceType: "principal",
        value: "op_alice",
      },
    ]);
    const svc = await r.resolveActor("admin", "op_svc");
    expect(svc.status).toBe("RESOLVED");
    expect(svc.actorRef?.type).toBe("SERVICE");
  });

  it("sweeper literal → SYSTEM only via registry (x402-gateway too)", async () => {
    const r = createActorResolver(seed());
    for (const [source, raw, principal] of [
      ["board", "sweeper", "sweeper"],
      ["x402", "x402-gateway", "x402-gateway"],
    ] as const) {
      const res = await r.resolveActor(source, raw);
      expect(res.status, `${source}/${raw}`).toBe("RESOLVED");
      expect(res.actorRef?.type).toBe("SYSTEM");
      expect(res.actorRef?.externalReferences[0]?.value).toBe(principal);
    }
  });

  it("unknown string → UNRESOLVED, rawActor preserved, no invented type", async () => {
    const r = createActorResolver(seed());
    const res = await r.resolveActor("board", "nobody");
    expect(res.status).toBe("UNRESOLVED");
    expect(res.actorRef).toBeUndefined();
    expect(res.rawActor).toBe("nobody");
    expect(res.issues).toEqual([
      { code: "ACTOR_UNRESOLVED", field: "rawActor" },
    ]);
  });
});

describe("actor-resolver — acceptance criteria", () => {
  it("AC2: '0x…' in source board without records = UNRESOLVED, not wallet", async () => {
    const r = createActorResolver(seed());
    const res = await r.resolveActor("board", WALLET_UNKNOWN);
    expect(res.status).toBe("UNRESOLVED");
    expect(res.actorRef).toBeUndefined();
  });

  it("AC3: wallet without chain context → UNRESOLVED (no unqualified namespace)", async () => {
    const deps = seed();
    delete deps.defaultChainId;
    const r = createActorResolver(deps);
    const res = await r.resolveActor("supply_chain", WALLET_HUMAN);
    expect(res.status).toBe("UNRESOLVED");
    for (const ref of res.actorRef?.externalReferences ?? []) {
      expect(ref.namespace).toContain(":");
      expect(ref.namespace).not.toBe("eip155");
    }
  });

  it("AC3b: per-call chain context overrides default", async () => {
    const r = createActorResolver(seed());
    const res = await r.resolveActor("supply_chain", WALLET_HUMAN, {
      chainId: 84532,
    });
    expect(res.status).toBe("RESOLVED");
    expect(
      res.actorRef?.externalReferences.some(
        (e) => e.namespace === "eip155:84532",
      ),
    ).toBe(true);
  });

  it("AC4: no auto-link — erc8004 without owner keeps a single ref", async () => {
    const orphan = `eip155:1874:${REG_ADDR}:9`;
    const deps: ActorResolverDeps = {
      erc8004: {
        get: async (id) =>
          id === orphan ? { agentId: orphan, status: "active" } : undefined,
        list: async () => [],
      },
      defaultChainId: CHAIN,
    };
    const r = createActorResolver(deps);
    const res = await r.resolveActor("board", orphan);
    expect(res.status).toBe("RESOLVED");
    expect(res.actorRef?.externalReferences).toHaveLength(1);
    expect(res.actorRef?.externalReferences[0]?.referenceType).toBe(
      "agent-id",
    );
  });

  it("AMBIGUOUS: two active registrations owned by one wallet", async () => {
    const r = createActorResolver(seed());
    const res = await r.resolveActor("supply_chain", WALLET_TWO_AGENTS);
    expect(res.status).toBe("AMBIGUOUS");
    expect(res.actorRef).toBeUndefined();
    expect(res.issues[0]?.code).toBe("ACTOR_AMBIGUOUS");
  });

  it("AMBIGUOUS: conflicting registry entries under one key", async () => {
    const r = createActorResolver({
      ...seed(),
      systemRegistry: [
        {
          source: "board",
          rawActor: "dup",
          actorType: "SYSTEM",
          principal: "a",
          note: "first",
        },
        {
          source: "board",
          rawActor: "dup",
          actorType: "SYSTEM",
          principal: "b",
          note: "second",
        },
      ],
    });
    const res = await r.resolveActor("board", "dup");
    expect(res.status).toBe("AMBIGUOUS");
  });

  it("offline identity lookup → UNRESOLVED, never guessed", async () => {
    const deps = seed();
    deps.erc8004 = {
      get: async () => {
        throw new Error("store offline");
      },
      list: async () => {
        throw new Error("store offline");
      },
    };
    const r = createActorResolver(deps);
    const res = await r.resolveActor("board", AGENT_1);
    expect(res.status).toBe("UNRESOLVED");
    const res2 = await r.resolveActor("board", "nobody");
    expect(res2.status).toBe("UNRESOLVED");
  });

  it("dogfood literals outside ledger sources stay UNRESOLVED", async () => {
    const r = createActorResolver(seed());
    for (const [source, raw] of [
      ["supply_chain", "sweeper"],
      ["bounty", "ops"],
      ["market", "evaluator"],
    ] as const) {
      const res = await r.resolveActor(source, raw);
      expect(res.status, `${source}/${raw}`).toBe("UNRESOLVED");
    }
  });

  it("wallet normalization: uppercase 0x resolves against lowercase rows", async () => {
    const r = createActorResolver(seed());
    const res = await r.resolveActor(
      "supply_chain",
      WALLET_AGENT.toUpperCase().replace("0X", "0x"),
    );
    expect(res.status).toBe("RESOLVED");
    expect(res.actorRef?.type).toBe("AI_AGENT");
  });
});
