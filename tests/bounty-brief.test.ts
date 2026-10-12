/**
 * SLICE-197-05: createBounty validation (Q33/Q34), public feed
 * projection (Q20), brief access gate (Q35/Q36), route smoke.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  checkBriefAccess,
  createBounty,
  publicFeed,
  stepsTemplate,
  toPublicBounty,
} from "../src/server/lib/bounties/brief";
import {
  listTransitions,
  resetBountyStoreForTesting,
  upsertBounty,
  useMemoryBountyStoreForTesting,
  type BountyRecord,
} from "../src/server/lib/bounties/store";
import { createBountyRoutes } from "../src/server/routes/bounty-api";

const PASSPORT = "897230";

function validBody() {
  return {
    title: "Fix flaky test",
    description: "d",
    budgetUsdc: "25",
    criteria: ["tests green", "no skip"],
    deliverableType: "pr",
    verify: "CI run on the PR",
  };
}

beforeEach(() => useMemoryBountyStoreForTesting());
afterEach(() => resetBountyStoreForTesting());

describe("createBounty", () => {
  it("ok: record created, open, jobAttempt 1, template steps (Q34)", () => {
    const r = createBounty(validBody(), { passportId: PASSPORT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = r.bounty;
    expect(b.bountyId).toMatch(/^bty_/);
    expect(b.status).toBe("open");
    expect(b.jobAttempt).toBe(1);
    expect(b.createdByPassportId).toBe(PASSPORT);
    expect(b.brief.steps).toEqual(stepsTemplate("pr"));
    expect(listTransitions(b.bountyId)[0].to).toBe("open");
  });

  it("custom steps override template; snake_case alias accepted", () => {
    const r = createBounty(
      { ...validBody(), deliverableType: undefined,
        deliverable_type: "post", steps: ["custom 1", "custom 2"] },
      { passportId: PASSPORT },
    );
    expect(r.ok && r.bounty.brief.steps).toEqual(["custom 1", "custom 2"]);
    if (r.ok) expect(r.bounty.brief.deliverableType).toBe("post");
  });

  it.each([
    ["title", { title: "" }],
    ["budgetUsdc", { budgetUsdc: "0" }],
    ["budgetUsdc", { budgetUsdc: "abc" }],
    ["criteria", { criteria: [] }],
    ["criteria", { criteria: ["", "  "] }],
    ["verify", { verify: "" }],
  ])("400 MISSING_FIELDS for %s", (_f, over) => {
    const r = createBounty({ ...validBody(), ...over }, { passportId: PASSPORT });
    expect(!r.ok && r.status === 400).toBe(true);
  });

  it("400 INVALID_INPUT for bad deliverable_type", () => {
    const r = createBounty(
      { ...validBody(), deliverableType: "video" },
      { passportId: PASSPORT },
    );
    expect(!r.ok && r.code === "INVALID_INPUT").toBe(true);
  });
});

describe("public feed (Q20)", () => {
  function bounty(over: Partial<BountyRecord> = {}): BountyRecord {
    return {
      bountyId: "b1", title: "t", brief: { criteria: ["c"], deliverableType: "pr" },
      budgetUsdc: "5", status: "open", jobAttempt: 1,
      createdAt: new Date().toISOString(), ...over,
    };
  }

  it("strips brief, budget and private fields", () => {
    const pub = toPublicBounty(bounty({ createdByPassportId: "x" }));
    expect(pub).not.toHaveProperty("brief");
    expect(pub).not.toHaveProperty("budgetUsdc");
    expect(pub).not.toHaveProperty("createdByPassportId");
    expect(pub).not.toHaveProperty("description");
    expect(pub.status).toBe("open");
  });

  it("publicFeed lists and filters by status", () => {
    upsertBounty(bounty());
    upsertBounty(bounty({ bountyId: "b2", status: "claimed" }));
    expect(publicFeed()).toHaveLength(2);
    const open = publicFeed({ status: "open" });
    expect(open).toHaveLength(1);
    expect(open[0].bountyId).toBe("b1");
  });
});

describe("checkBriefAccess (Q35/Q36)", () => {
  const sigOk = () => Promise.resolve("valid" as const);
  const base = { method: "GET", path: "/api/bounties/b1" };

  it("no passport → 403", async () => {
    const d = await checkBriefAccess(
      { ...base, wallet: "0x1", signature: "0x2", timestamp: "1" },
      { verify: sigOk },
    );
    expect(d?.status).toBe(403);
    expect(d?.code).toBe("PASSPORT_NOT_FOUND");
  });

  it("no-headers → 401, invalid sig → 401", async () => {
    const missing = await checkBriefAccess(
      { ...base, passportId: PASSPORT },
      { verify: () => Promise.resolve("no-headers") },
    );
    expect(missing?.status).toBe(401);
    const bad = await checkBriefAccess(
      { ...base, passportId: PASSPORT, wallet: "0x1" },
      { verify: () => Promise.resolve("invalid") },
    );
    expect(bad?.status).toBe(401);
  });

  it("owner mismatch → 403, match → null", async () => {
    const w = "0x00000000000000000000000000000000000000aa";
    const args = { ...base, passportId: PASSPORT, wallet: w, signature: "0x", timestamp: "1" };
    const no = await checkBriefAccess(args, {
      verify: sigOk,
      fetchOwner: () => Promise.resolve("0x" + "11".repeat(20)),
    });
    expect(no?.status).toBe(403);
    expect(no?.code).toBe("WRONG_SIGNER");
    const yes = await checkBriefAccess(args, {
      verify: sigOk,
      fetchOwner: () => Promise.resolve(w.toUpperCase().replace("0X", "0x")),
    });
    expect(yes).toBeNull();
  });
});

describe("route smoke", () => {
  it("POST /bounties without agent → 403", async () => {
    const app = createBountyRoutes();
    const res = await app.request("/bounties", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody()),
    });
    expect(res.status).toBe(403);
  });

  it("POST /bounties with agent → 201; GET feed strips brief", async () => {
    const app = new Hono<{ Variables: { agent?: { agentId: string } } }>();
    app.use("*", async (c, next) => {
      c.set("agent", { agentId: PASSPORT });
      await next();
    });
    app.route("/", createBountyRoutes());
    const res = await app.request("/bounties", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody()),
    });
    expect(res.status).toBe(201);
    const feed = await (await app.request("/bounties")).json() as {
      bounties: Record<string, unknown>[];
    };
    expect(feed.bounties).toHaveLength(1);
    expect(feed.bounties[0]).not.toHaveProperty("brief");
    expect(feed.bounties[0]).not.toHaveProperty("budgetUsdc");
  });
});
