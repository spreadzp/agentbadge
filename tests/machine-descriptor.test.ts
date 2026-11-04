/**
 * SLICE-206-1: /.well-known/agentbadge-machine.json + machine_entry schema.
 * AC: 200 valid JSON with all spec fields; machine_entry builder output
 * validates via zod; zero secrets; cache immutable.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { machineDescriptorRoutes } from "../src/server/routes/well-known/machine-descriptor";
import {
  buildMachineDescriptor,
  buildMachineEntry,
  CONTRACT_LIMITS,
  ENDPOINT_TEMPLATE,
  machineEntrySchema,
} from "../src/server/lib/machine-entry";

const app = new Hono().route("/", machineDescriptorRoutes);

describe("SLICE-206-1 machine descriptor", () => {
  it("GET /.well-known/agentbadge-machine.json → 200 + all spec fields", async () => {
    const res = await app.request("/.well-known/agentbadge-machine.json");
    expect(res.status).toBe(200);
    const d = (await res.json()) as ReturnType<typeof buildMachineDescriptor>;

    expect(d.protocol_version).toBe("agentbadge-market/1");
    // auth: sig-auth contract from middleware/agent-auth
    expect(d.auth.scheme).toBe("sig-auth");
    expect(d.auth.headers).toEqual({
      wallet: "X-Wallet",
      signature: "X-Sig",
      timestamp: "X-Timestamp",
    });
    expect(d.auth.challenge_format).toContain("agentbadge-access:v1");
    expect(d.auth.timestamp_skew_seconds).toBe(300);
    expect(d.auth.chains).toContain("eip155:5042002");
    // endpoints: ordered discover → … → verify-status
    const phases = d.endpoints.map((e: { phase: string }) => e.phase);
    expect(phases).toEqual(
      ENDPOINT_TEMPLATE.map((e) => e.phase),
    );
    expect(phases[0]).toBe("discover");
    expect(phases.at(-1)).toBe("verify-status");
    // contract limits — same consts as 206-2 will consume
    expect(d.contract.idempotency_key.min).toBe(CONTRACT_LIMITS.idempotencyKey.min);
    expect(d.contract.evidence_refs.max_count).toBe(50);
    expect(d.contract.summary.max_len).toBe(4000);
    // verification + budget_status
    expect(d.verification.rule).toContain("verifier_wallet != owner");
    expect(d.budget_status).toEqual([
      "DECLARED_NOT_RESERVED",
      "ESCROWED",
      "PAID",
    ]);
  });

  it("immutable cache header, JSON only (no secrets)", async () => {
    const res = await app.request("/.well-known/agentbadge-machine.json");
    expect(res.headers.get("cache-control")).toContain("immutable");
    const raw = await res.text();
    // no key/secret-shaped values — descriptor is public protocol doc
    expect(raw.toLowerCase()).not.toMatch(/secret|private_key|api_key|0x[a-f0-9]{64}/);
  });

  it("machineEntrySchema round-trip", () => {
    const entry = buildMachineEntry({
      id: "task_abc123",
      budget: 3.5,
      currency: "USDC",
      budgetStatus: "ESCROWED",
      deadline: "2026-11-10T00:00:00Z",
      requiredCapabilities: ["code-review"],
    });
    const parsed = machineEntrySchema.parse(entry);
    expect(parsed.task_id).toBe("task_abc123");
    expect(parsed.budget_status).toBe("ESCROWED");
    expect(parsed.deadline).toBe("2026-11-10T00:00:00Z");
    expect(parsed.calls.map((c) => c.phase)).toEqual([
      "read",
      "bid",
      "deliver",
      "verify-status",
    ]);
    // concrete task_id substituted — no template placeholders left
    expect(parsed.calls.every((c) => !c.path.includes("{task_id}"))).toBe(true);
    const bid = parsed.calls.find((c) => c.phase === "bid");
    expect(bid?.path).toBe("/api/tasks/task_abc123/bids");
    expect(bid?.auth).toBe("sig-auth");
    expect(bid?.args).toContain("idempotency_key");
    // evidence spec mirrors contract limits
    expect(parsed.evidence.refs_max_count).toBe(50);
    expect(parsed.evidence.summary_max_len).toBe(4000);
  });

  it("builder defaults: zero-budget task, no deadline", () => {
    const entry = buildMachineEntry({ id: "task_zero", budget: 0 });
    expect(entry.budget_status).toBe("DECLARED_NOT_RESERVED");
    expect(entry.deadline).toBeNull();
    expect(entry.required_capabilities).toEqual([]);
  });
});
