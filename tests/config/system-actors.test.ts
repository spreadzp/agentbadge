/**
 * SLICE-236-1: system-actors registry — data integrity.
 * The resolution conformance (every record → ActorRef SYSTEM via the pure
 * matcher) lives in packages/process-contracts/tests/system-actors-resolution.test.ts
 * — that matcher isn't linked into the server (D-235-12), so the
 * contract-level check runs on the package side where the contract lives.
 */
import { describe, expect, it } from "vitest";
import {
  assertSystemActorsUnique,
  SYSTEM_ACTORS,
  type SystemActorRecord,
} from "../../src/config/system-actors";

describe("system-actors registry (SLICE-236-1)", () => {
  it("is non-empty and covers the audited ledger sources", () => {
    expect(SYSTEM_ACTORS.length).toBeGreaterThanOrEqual(4);
    const sources = new Set(SYSTEM_ACTORS.map((r) => r.source));
    expect(sources).toContain("board");
    expect(sources).toContain("x402");
  });

  it("every record is well-formed", () => {
    for (const r of SYSTEM_ACTORS) {
      expect(r.source.length).toBeGreaterThan(0);
      expect(r.source).toMatch(/^[a-z0-9-]+$/);
      expect(r.rawActor.length).toBeGreaterThan(0);
      expect(r.actorType).toBe("SYSTEM");
      expect(r.principal).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
      expect(r.note.length).toBeGreaterThan(10);
    }
  });

  it("(source, rawActor) pairs are unique — module load asserts it", () => {
    // Import succeeded ⇒ assertSystemActorsUnique() passed at load.
    expect(() => assertSystemActorsUnique()).not.toThrow();
    const dup: SystemActorRecord = { ...SYSTEM_ACTORS[0] };
    expect(() =>
      assertSystemActorsUnique([...SYSTEM_ACTORS, dup]),
    ).toThrow(/duplicate \(source, rawActor\)/);
  });

  it("records carry no secrets or credentials", () => {
    for (const r of SYSTEM_ACTORS) {
      const blob = `${r.source}|${r.rawActor}|${r.principal}`;
      // no private keys / hex secrets / bearer material — principals are
      // human-readable names, not credentials
      expect(blob).not.toMatch(/0x[0-9a-fA-F]{32,}/);
      expect(blob).not.toMatch(/[0-9a-fA-F]{64}/);
      expect(blob).not.toMatch(/key|secret|token|password/i);
      // system actors are short literals, not addresses/ids
      expect(r.rawActor).not.toMatch(/^0x/);
      expect(r.rawActor.length).toBeLessThan(64);
    }
  });
});
