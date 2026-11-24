/**
 * Endpoint inventory — union of 4 sources (D-234-38-Q3):
 *   openapi.json  — published contract (GET /openapi.json on target)
 *   x402.json     — paid paths (GET /.well-known/x402.json on target)
 *   code-scan     — src/server/routes/** literals (sees UNPUBLISHED
 *                   paths — internal routes are where bugs live)
 *   registry.yaml — manual list for edge/gateway paths
 *
 * probe_endpoint.source stores origin; new paths → verdict='new'
 * cases (they get probed first).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { Endpoint, EndpointContract, Source } from "./types";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REGISTRY_PATH = join(HERE, "..", "registry.yaml");
const SERVER_ROOT = join(HERE, "..", "..", "..");
const ROUTES_DIR = join(SERVER_ROOT, "src", "server", "routes");

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

// ---------- openapi ----------

export function endpointsFromOpenapi(doc: unknown): Endpoint[] {
  const out: Endpoint[] = [];
  const paths = (doc as { paths?: Record<string, Record<string, unknown>> })?.paths;
  if (!paths || typeof paths !== "object") return out;
  for (const [path, ops] of Object.entries(paths)) {
    for (const m of Object.keys(ops ?? {})) {
      const method = m.toUpperCase();
      if (HTTP_METHODS.includes(method)) out.push({ path, method, source: "openapi" });
    }
  }
  return out;
}

// ---------- x402 manifest ----------

/** Tolerant walk: collect strings that look like paths under paid-resource keys. */
export function endpointsFromX402(doc: unknown): Endpoint[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string" && v.startsWith("/") && !v.includes(" ") && v.length < 120) {
      out.add(v.split("?")[0]);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v)) {
        if (typeof val === "string" && /^(path|url|resource|endpoint|route)$/i.test(k) && val.startsWith("/")) {
          out.add(val.split("?")[0]);
        } else walk(val);
      }
    }
  };
  walk(doc);
  // x402 resources are GET-paid endpoints by default
  return [...out].map(path => ({ path, method: "GET", source: "x402" as Source }));
}

// ---------- code scan ----------

/** Best-effort literal scan: `.get("/path"` / `.route("/base"` hono calls. */
export function endpointsFromCode(routesDir = ROUTES_DIR): Endpoint[] {
  const out: Endpoint[] = [];
  const files: string[] = [];
  const walkDir = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walkDir(p);
      else if (f.endsWith(".ts")) files.push(p);
    }
  };
  try { walkDir(routesDir); } catch { return out; }

  const callRe = /\.(get|post|put|delete|patch|head|options)\(\s*["'`](\/[^"'`]*)["'`]/g;
  const mountRe = /\.route\(\s*["'`](\/[^"'`]*)["'`]/g;
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(callRe)) {
      if (!m[2].includes("${")) out.push({ path: m[2], method: m[1].toUpperCase(), source: "code" });
    }
    for (const m of src.matchAll(mountRe)) {
      // mount base itself is a probed prefix (append-segment templates land on it)
      if (!m[1].includes("${")) out.push({ path: m[1], method: "GET", source: "code" });
    }
  }
  return out;
}

// ---------- registry.yaml ----------

export function endpointsFromRegistry(path = REGISTRY_PATH): Endpoint[] {
  try {
    const doc = YAML.parse(readFileSync(path, "utf8")) as {
      endpoints?: { path: string; method?: string; contract?: EndpointContract; denyExempt?: boolean }[];
    };
    return (doc?.endpoints ?? [])
      .filter(e => e.path?.startsWith("/"))
      .map(e => ({
        path: e.path, method: (e.method ?? "GET").toUpperCase(),
        source: "manual" as Source, contract: e.contract,
        denyExempt: e.denyExempt === true || undefined,
      }));
  } catch {
    return [];
  }
}

/** Сливает registry-семантику (contract + denyExempt) на совпадающие
 *  endpoints (path+method) — openapi/code/state endpoint получает
 *  метаданные из ручного реестра. denyExempt обязателен к merge:
 *  иначе state-копия без флага дедупит variant'ы раньше exempt-
 *  записи и endpoint молча остаётся под hard-deny (258-25). */
export function mergeContracts(eps: Endpoint[]): Endpoint[] {
  const contracts = new Map<string, EndpointContract>();
  const exempt = new Set<string>();
  for (const e of eps) {
    const k = `${e.method} ${e.path}`;
    if (e.contract) contracts.set(k, e.contract);
    if (e.denyExempt) exempt.add(k);
  }
  if (!contracts.size && !exempt.size) return eps;
  return eps.map(e => {
    const k = `${e.method} ${e.path}`;
    const merged = {
      ...e,
      contract: e.contract ?? contracts.get(k),
      denyExempt: e.denyExempt || (exempt.has(k) || undefined),
    };
    return merged === e ? e : merged;
  });
}

// ---------- union ----------

export async function fetchJson(url: string, timeoutMs = 15_000): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": "AgentBadge-ProbeBot/0.1 inventory" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function collectEndpoints(opts: {
  target?: string;                    // live openapi/x402 fetch
  codeDir?: string; registryPath?: string;
  openapiDoc?: unknown; x402Doc?: unknown; // injected fixtures (tests)
}): Promise<Endpoint[]> {
  const all: Endpoint[] = [];

  const openapi = opts.openapiDoc ??
    (opts.target ? await fetchJson(`${opts.target}/openapi.json`) : null);
  if (openapi) all.push(...endpointsFromOpenapi(openapi));

  const x402 = opts.x402Doc ??
    (opts.target ? await fetchJson(`${opts.target}/.well-known/x402.json`) : null);
  if (x402) all.push(...endpointsFromX402(x402));

  all.push(...endpointsFromCode(opts.codeDir ?? ROUTES_DIR));
  all.push(...endpointsFromRegistry(opts.registryPath ?? REGISTRY_PATH));

  return mergeContracts(all);
}

/** Glob-ish match: '*' wildcard, else prefix. */
export function matchEndpoint(path: string, globs: string[]): boolean {
  if (!globs.length) return true;
  return globs.some(g => {
    if (g === "*") return true;
    const re = new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    return re.test(path) || path.startsWith(g.replace(/\*$/, ""));
  });
}
