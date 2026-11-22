import {
  NamespaceRegistry,
  registerAllTools,
} from "@agentbadge/mcp";
import { allKeeperhubTools } from "@agentbadge/keeperhub";

import { AGENT_READINESS_RULESET } from "../../../agent-readiness/ruleset";
import { RULE_PACKS } from "../../../agent-readiness/rule-packs";
import { MANIFEST_REGISTRY } from "../agent-discovery/manifests";
import { registerAttestcoinTools } from "../../../mcp/attestcoin-tools";
import { registerBoardTools } from "../../../mcp/board-tools";
import { registerComplianceTools } from "../../../mcp/compliance-tools";
import { registerKnowledgeTools } from "../../../mcp/knowledge-tools";
import { registerParityTools } from "../../../mcp/parity-tools";

import { upsertKnowledgeCapability } from "./capabilities";
import type { KnowledgeStore } from "./store";
import type { KnowledgeCapabilityRecord } from "./types";

/**
 * EPIC-229 (SLICE-229-4, D-229-5/O-229-3): deterministic capability
 * seed — the registry mirrors what the CODE actually exposes, never
 * hand-maintained lists. Sources:
 *
 *   check.<RULE_ID>        ← AGENT_READINESS_RULESET.rules[].rule_id
 *                            (SCANNER_CHECK — "can the scanner verify X")
 *   x402-pack.<PackId>     ← RULE_PACKS[].id (paid scan bundles)
 *   mcp.<toolName>         ← MCP tool registrations, enumerated on a
 *                            throwaway NamespaceRegistry (no global
 *                            side-effects, same registrars prod wires)
 *   manifest.<normalized>  ← MANIFEST_REGISTRY[].path
 *                            ("/.well-known/x"→"x", "/" stripped)
 *
 * Every seeded row: source=SEEDED, verified=true (the code IS the
 * evidence). MANUAL rows stay operator-owned and are never touched
 * by seed runs.
 */

export interface SeedCapability {
  name: string;
  kind: string;
  description: string;
}

function normalizeManifestPath(path: string): string {
  return path.replace(/^\/+/, "").replace(/^\.well-known\//, "");
}

export function collectSeedCapabilities(): SeedCapability[] {
  const out: SeedCapability[] = [];

  for (const rule of AGENT_READINESS_RULESET.rules) {
    const id = (rule as { rule_id?: string }).rule_id;
    if (typeof id === "string" && id.length > 0) {
      out.push({
        name: `check.${id}`,
        kind: "SCANNER_CHECK",
        description: `Agent-readiness rule ${id}`,
      });
    }
  }

  for (const pack of RULE_PACKS) {
    out.push({
      name: `x402-pack.${pack.id}`,
      kind: "X402_PACK",
      description: `x402 scan bundle: ${pack.name}`,
    });
  }

  const probe = new NamespaceRegistry("knowledge-seed-probe");
  registerAllTools(probe);
  registerParityTools(probe);
  registerComplianceTools(probe);
  registerKnowledgeTools(probe);
  registerBoardTools(probe);
  registerAttestcoinTools(probe);
  for (const tool of probe.listTools()) {
    out.push({
      name: `mcp.${tool.name}`,
      kind: "MCP_TOOL",
      description: `MCP tool: ${tool.name}`,
    });
  }
  // KeeperHub tools register to the GLOBAL registry behind an env
  // context — enumerate names from the static array instead (the
  // capability exists regardless of whether the context is wired).
  for (const tool of allKeeperhubTools) {
    out.push({
      name: `mcp.${tool.name}`,
      kind: "MCP_TOOL",
      description: `MCP tool (keeperhub): ${tool.name}`,
    });
  }

  for (const m of MANIFEST_REGISTRY) {
    const normalized = normalizeManifestPath(m.path);
    if (normalized.length > 0) {
      out.push({
        name: `manifest.${normalized}`,
        kind: "MANIFEST",
        description: `Discovery manifest served at ${m.path}`,
      });
    }
  }

  return out;
}

export interface SeedReport {
  total: number;
  added: number;
  existing: number;
  /** In code but NOT in the registry before this run (new this run). */
  newlyAddedNames: string[];
  /** In the registry but no longer in code — MANUAL rows are fine,
   *  SEEDED rows flagged here are DRIFT (code removed/renamed). */
  dbOnlySeeded: string[];
  /** Arc R3 M-10: seeds the upsert REJECTED — `total ≠ added +
   *  existing` used to be the only clue failures happened. */
  failed: { name: string; error: string }[];
  /** Arc R3 M-10: MANUAL rows a SEEDED upsert refused to colonize —
   *  the symmetric provenance guard keeps them operator-owned. */
  manualOwned: string[];
}

/**
 * Idempotent seed run — upsert by name; a second run adds nothing.
 * Also computes the drift set for the drift-check test: SEEDED rows
 * present in the store that the current code no longer produces.
 */
export async function seedCapabilities(
  store: KnowledgeStore,
): Promise<SeedReport> {
  const wanted = collectSeedCapabilities();
  const report: SeedReport = {
    total: wanted.length,
    added: 0,
    existing: 0,
    newlyAddedNames: [],
    dbOnlySeeded: [],
    failed: [],
    manualOwned: [],
  };
  for (const seed of wanted) {
    const before = await store.getCapabilityByName(seed.name);
    const r = await upsertKnowledgeCapability(store, {
      name: seed.name,
      kind: seed.kind,
      description: seed.description,
      source: "SEEDED",
    });
    if (!r.ok) {
      report.failed.push({ name: seed.name, error: r.error });
      continue;
    }
    if (before === null) {
      report.added += 1;
      report.newlyAddedNames.push(seed.name);
    } else if (before.source === "MANUAL") {
      // Arc R3 M-10: the upsert kept the operator-owned row —
      // surface it instead of silently counting "existing".
      report.manualOwned.push(seed.name);
    } else {
      report.existing += 1;
    }
  }

  // Drift: seeded registry rows the code no longer emits. Arc R3
  // M-10: a stale SEEDED row stayed verified=true forever — flip
  // it off so the registry stops asserting a capability code no
  // longer produces.
  const wantedNames = new Set(wanted.map((w) => w.name));
  const dbRows = await store.listCapabilities({ limit: 10_000 });
  for (const row of dbRows) {
    if (row.source === "SEEDED" && !wantedNames.has(row.name)) {
      report.dbOnlySeeded.push(row.name);
      if (row.verified) {
        await store.upsertCapability({
          id: row.id,
          name: row.name,
          kind: row.kind,
          description: row.description,
          source: "SEEDED",
          verified: false,
        });
      }
    }
  }
  report.dbOnlySeeded.sort();
  return report;
}

/** Pure drift computation for tests — no writes. */
export async function capabilityDrift(
  store: KnowledgeStore,
): Promise<{ codeOnly: string[]; dbOnlySeeded: string[]; dbOnlyManual: string[] }> {
  const wanted = new Set(collectSeedCapabilities().map((c) => c.name));
  const dbRows = await store.listCapabilities({ limit: 10_000 });
  const dbNames = new Set(dbRows.map((r) => r.name));
  return {
    codeOnly: [...wanted].filter((n) => !dbNames.has(n)).sort(),
    dbOnlySeeded: dbRows
      .filter((r) => r.source === "SEEDED" && !wanted.has(r.name))
      .map((r) => r.name)
      .sort(),
    dbOnlyManual: dbRows
      .filter((r) => r.source === "MANUAL" && !wanted.has(r.name))
      .map((r) => r.name)
      .sort(),
  };
}

export type { KnowledgeCapabilityRecord };
