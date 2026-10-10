/**
 * Agent registration env section — EPIC-184.
 *
 * Self-serve `POST /api/v1/agents/register` gated behind
 * AGENT_REGISTER_ENABLED. When enabled, ARC_OPS_KEY is REQUIRED — the
 * ops wallet pays mint gas on the ERC-8004 registry; there is no
 * master-key fallback (D-184-6).
 *
 *   AGENT_REGISTER_ENABLED  — 0/1 (default off)
 *   ARC_OPS_KEY             — 64-hex platform ops key (mint signer)
 *   AGENT_REGISTER_STORE    — json (default) | memory
 *   AGENT_REGISTER_DAILY    — max registrations per IP per day (default 20)
 *   AGENT_REGISTER_KEY_RPM  — keyed free-tier limit advertised to callers
 *                             (default 10 req/min vs anon 1/min — O1)
 *   AGENT_REGISTER_GAS_CAP  — gas ceiling for the mint tx (default 500000)
 *   REGISTER_SPONSORED      — 0/1: treasury-paid mint+transfer to user EOA
 *                             (default off; needs user EIP-191 intent)
 *   REGISTER_SPONSORED_DAILY— sponsored-mint budget per UTC day (default 50)
 */
import type { AgentRegistrationEnvConfig } from "./agent-registration-types";
import { booleanFlag } from "./validators";

function intVar(
  name: string,
  fallback: number,
  min: number,
  errors: string[],
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) {
    errors.push(`Invalid ${name}: expected integer >= ${min}, got "${raw}"`);
    return fallback;
  }
  return n;
}

export function loadAgentRegistration(
  errors: string[],
): AgentRegistrationEnvConfig | undefined {
  if (!booleanFlag("AGENT_REGISTER_ENABLED")) return undefined;

  const rawKey = (process.env.ARC_OPS_KEY ?? "").trim();
  let opsKey: `0x${string}` | undefined;
  if (/^0x[0-9a-fA-F]{64}$/.test(rawKey)) {
    opsKey = rawKey as `0x${string}`;
  } else {
    errors.push(
      "AGENT_REGISTER_ENABLED set but ARC_OPS_KEY is missing or not a 64-hex private key — registration requires a dedicated ops signer (no master-key fallback)",
    );
  }

  const rawStore = (process.env.AGENT_REGISTER_STORE ?? "json").toLowerCase();
  const store = rawStore === "memory" ? "memory" : "json";

  const dailyLimit = intVar("AGENT_REGISTER_DAILY", 20, 1, errors);
  const keyRpm = intVar("AGENT_REGISTER_KEY_RPM", 10, 1, errors);
  const gasCap = intVar("AGENT_REGISTER_GAS_CAP", 500_000, 1, errors);

  // SLICE-184-5: treasury-paid gasless onboarding (D-184-10).
  const sponsored = booleanFlag("REGISTER_SPONSORED");
  const sponsoredDaily = intVar("REGISTER_SPONSORED_DAILY", 50, 1, errors);

  return {
    enabled: true,
    store,
    dailyLimit,
    keyRpm,
    gasCap,
    sponsored,
    sponsoredDaily,
    ...(opsKey ? { opsKey } : {}),
  };
}
