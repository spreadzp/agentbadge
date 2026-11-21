/**
 * SLICE-257-19 M-1 — counterpartyModeFromEnv fail-closed defaults.
 * (split from mediums-257-19 → mirror lib/buy/counterparty-gate.ts)
 */
import { describe, it, expect } from "vitest";
import { counterpartyModeFromEnv } from "../../src/server/lib/buy/counterparty-gate";

describe("counterpartyModeFromEnv", () => {
  it("M-1: NODE_ENV unset/unknown → enforce (fail-closed), dev/test → off", () => {
    const env = (ne?: string, mode?: string) =>
      counterpartyModeFromEnv({
        NODE_ENV: ne,
        COUNTERPARTY_CHECK_MODE: mode,
      });
    expect(env("production")).toBe("enforce");
    expect(env(undefined)).toBe("enforce"); // unset → fail-closed
    expect(env("staging")).toBe("enforce"); // unknown → fail-closed
    expect(env("test")).toBe("off");
    expect(env("development")).toBe("off");
    expect(env("test", "enforce")).toBe("enforce"); // explicit wins
    expect(env("production", "shadow")).toBe("shadow");
  });
});
