/**
 * SLICE-216-1: dogfood scaffold contract — `scripts/supply-chain-dogfood.mts`
 * driven as a real subprocess (the artifact the audit and the live run
 * will exercise), not by re-implementing its internals.
 *
 * AC: --dry-run executes the 3-hop "Proof of Freshness" lite chain on
 * InMemoryHopExecutor end-to-end, prints the plan, exits 0.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function runDogfood(
  args: string[],
  env: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("bun", ["scripts/supply-chain-dogfood.mts", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** The script's contract: stdout = one JSON document, last line wins. */
function lastJson(stdout: string): Record<string, unknown> {
  const line = stdout.trim().split("\n").at(-1);
  if (!line) throw new Error(`empty stdout: ${stdout.slice(-400)}`);
  return JSON.parse(line) as Record<string, unknown>;
}

describe("supply-chain-dogfood --dry-run", () => {
  it("executes the 3-hop chain on InMemoryHopExecutor, exits 0, prints plan + jobs", () => {
    const r = runDogfood(["--dry-run"]);
    expect(r.status, `stderr: ${r.stderr.slice(-800)}`).toBe(0);

    const out = lastJson(r.stdout);
    expect(out.mode).toBe("dry-run");
    expect(typeof out.shipmentId).toBe("string");

    // Plan: 3 hops — org→agent→device→org (D-216-2).
    const plan = out.plan as Array<Record<string, unknown>>;
    expect(plan).toHaveLength(3);
    for (const [i, hop] of plan.entries()) {
      expect(hop.hopIndex).toBe(i);
      expect(hop.receiver).toMatch(/^0x[0-9a-f]{40}$/);
      expect(hop.evaluator).toMatch(/^0x[0-9a-f]{40}$/);
      expect(hop.amountUsdc).toMatch(/^\d+(\.\d+)?$/);
    }

    // Result: one job per hop, every hop verified, shipment completed.
    const jobs = out.jobs as Array<Record<string, unknown>>;
    expect(jobs).toHaveLength(3);
    for (const [i, j] of jobs.entries()) {
      expect(j.hopIndex).toBe(i);
      expect(typeof j.jobId).toBe("string");
      expect(j.status).toBe("verified");
    }
    expect(out.status).toBe("completed");
  });

  it("emits no secrets — output stays redactable", () => {
    const r = runDogfood(["--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/privateKey|PRIVATE_KEY/i);
  });
});

describe("supply-chain-dogfood --live (config seam for 216-4)", () => {
  it("fails fast with a config error when keys are missing — never touches chain", () => {
    const r = runDogfood(["--live"], {
      SC_DOGFOOD_ORG_KEY: "",
      SC_DOGFOOD_AGENT_KEY: "",
      SC_DOGFOOD_DEVICE_KEY: "",
      SC_DOGFOOD_EVAL_KEY: "",
      ARC_VENUE_EVALUATOR_KEY: "",
      ARC_OPS_KEY: "",
      ARC_EVALUATOR_KEY: "",
    });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}\n${r.stderr}`).toMatch(/SC_DOGFOOD_\w+|key/i);
  });
});
