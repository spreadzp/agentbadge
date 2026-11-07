/**
 * SLICE-214-1 (MYPROJ-2711): makeChain() — shared multi-role chain
 * fixture for the scenario matrix (214-2/214-3) and 216-1 dogfood.
 *
 * Contract (D-214-2): test-helpers only, single source. Drives a
 * shipment through accept → handoff(roles+evidence) → settle → verify
 * on InMemoryHopExecutor; returns live deps so scenarios can keep
 * driving the same chain. Advisory fields (rolesAssertedBy,
 * evidenceAssertedBy, issuerMatchesParty) must be visible in replay.
 */

import { describe, expect, it } from "vitest";
import { createDatabase, type Database } from "@agentbadge/database";
import {
  acceptShipment,
  handoffHop,
  settleHop,
  shipmentState,
} from "../../../src/server/lib/econ-ledger/supply-chain/shipment";
import { InMemoryHopExecutor } from "../../../src/server/lib/econ-ledger/supply-chain/executor";
import { makeChain } from "./chain-fixture";

const CLIENT = "0x" + "aa".repeat(20) as `0x${string}`;
const SENSOR = "0x" + "dd".repeat(20) as `0x${string}`;
const HASH = `0x${"ef".repeat(32)}`;

describe("makeChain() fixture (SLICE-214-1)", () => {
  it("default: 3-hop chain driven to settled — all hops paid, jobs created", async () => {
    const chain = await makeChain();
    expect(chain.specs).toHaveLength(3);
    expect(chain.receivers).toHaveLength(3);
    expect(chain.jobs).toHaveLength(3);
    const exec = chain.executor as InMemoryHopExecutor;
    expect(exec.created).toHaveLength(3);
    expect(exec.settled).toHaveLength(3);
    const { hops } = await chain.state();
    expect(hops).toHaveLength(3);
    expect(hops.every((h) => h.status === "paid")).toBe(true);
    // every hop got its own deterministic job
    for (const h of hops) expect(h.jobId).toBe(chain.jobId(h.hopIndex));
  });

  it("roles + evidencePerHop ride the chain and surface advisory fields in replay", async () => {
    const chain = await makeChain({
      hops: 2,
      roles: (hop) => ({ custodian: { address: hop.receiver, type: "org" } }),
      evidencePerHop: [
        { type: "gps", hash: HASH, issuer: { address: SENSOR, type: "device" } },
      ],
    });
    const { hops } = await chain.state();
    for (const hop of hops) {
      expect(hop.roles?.custodian?.type).toBe("org");
      expect(hop.rolesAssertedBy).toBe(chain.handoffActor(hop.hopIndex));
      expect(hop.evidence).toHaveLength(1);
      expect(hop.evidence?.[0]?.hash).toBe(HASH);
      // SENSOR is third-party → honest advisory flag (213-5 H-1)
      expect(hop.evidence?.[0]?.issuerMatchesParty).toBe(false);
      expect(hop.evidenceAssertedBy).toBe(chain.handoffActor(hop.hopIndex));
    }
  });

  it("issuer = hop receiver → issuerMatchesParty true (no advisory)", async () => {
    const chain = await makeChain({
      hops: 1,
      evidencePerHop: 1, // auto-generated, issuer = receiver
    });
    const { hops } = await chain.state();
    expect(hops[0]?.evidence).toHaveLength(1);
    expect(hops[0]?.evidence?.[0]?.issuerMatchesParty).toBe(true);
    expect(hops[0]?.evidence?.[0]?.issuer.address).toBe(chain.receivers[0]);
  });

  it("lifecycle 'offered' drives nothing past the offer", async () => {
    const chain = await makeChain({ hops: 2, lifecycle: "offered" });
    const { hops, events } = await chain.state();
    expect(events.filter((e) => e.kind === "work_offer")).toHaveLength(1);
    expect(events.some((e) => e.kind === "handoff" || e.kind === "pay")).toBe(false);
    expect(hops.every((h) => h.status === "offered")).toBe(true);
  });

  it("lifecycle 'verified' drives verify on every hop", async () => {
    const chain = await makeChain({ hops: 2, lifecycle: "verified" });
    const { hops } = await chain.state();
    expect(hops.every((h) => h.status === "verified")).toBe(true);
  });

  it("explicit hops[] with per-hop overrides win over global roles/evidence", async () => {
    const OTHER_HASH = `0x${"12".repeat(32)}`;
    const r0 = "0x" + "b0".repeat(20) as `0x${string}`;
    const r1 = "0x" + "b1".repeat(20) as `0x${string}`;
    const chain = await makeChain({
      client: CLIENT,
      hops: [
        { receiver: r0, amountUsdc: "10" },
        {
          receiver: r1,
          amountUsdc: "4",
          evidenceRefs: [
            { type: "document", hash: OTHER_HASH, issuer: { address: r1, type: "org" } },
          ],
        },
      ],
      evidencePerHop: 1, // applies to hop0 only — hop1 overrides
    });
    const { hops } = await chain.state();
    expect(hops[0]?.evidence).toHaveLength(1);
    expect(hops[1]?.evidence).toHaveLength(1);
    expect(hops[1]?.evidence?.[0]?.hash).toBe(OTHER_HASH);
    expect(hops[1]?.evidence?.[0]?.issuerMatchesParty).toBe(true);
    // hop1 handoff actor is hop0's receiver — provenance follows the chain
    expect(hops[1]?.evidenceAssertedBy).toBe(r0);
    expect(chain.handoffActor(0)).toBe(CLIENT);
    expect(chain.handoffActor(1)).toBe(r0);
  });

  it("reuse contract: injected executor failure propagates (S7 seam)", async () => {
    const executor = new InMemoryHopExecutor();
    executor.failOnSettleJobId = "job-shp-fix-seam-0";
    await expect(
      makeChain({ shipmentId: "shp-fix-seam", hops: 1, executor }),
    ).rejects.toThrow(/settle of job-shp-fix-seam-0 rejected/);
    // the fixture still handed us the same executor — scenarios drive on
    expect(executor.created).toHaveLength(1);
  });

  it("exposed deps let a caller keep driving the chain manually", async () => {
    const chain = await makeChain({ hops: 2, lifecycle: "offered" });
    const { deps, shipmentId } = chain;
    // drive hop0 by hand through the returned deps
    await acceptShipment(shipmentId, 0, shipmentId, chain.receivers[0]!, deps);
    await handoffHop(shipmentId, 0, {}, CLIENT, chain.receivers[0]!, deps);
    await settleHop(shipmentId, 0, "10", CLIENT, chain.receivers[0]!, deps);
    const { hops } = await shipmentState(deps.ledger, shipmentId);
    expect(hops[0]?.status).toBe("paid");
    expect(hops[1]?.status).toBe("offered");
  });

  it("honours a caller-provided db (createDatabase passthrough)", async () => {
    const base = createDatabase({ enabled: false });
    const db = { ...base, db: {} as Database["db"] } as Database;
    const chain = await makeChain({ hops: 1, db });
    expect(chain.db).toBe(db);
    const { events } = await chain.state();
    expect(events.length).toBeGreaterThan(0);
  });
});
