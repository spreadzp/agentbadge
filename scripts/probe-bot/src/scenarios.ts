/**
 * Scenario loader (D-234-38-Q6): YAML templates + TS modules hybrid.
 *
 * New known-vuln pattern = new YAML file, no code — the main path for
 * "found a CVE write-up online → add the probe". TS modules cover
 * multi-step flows (replay, settlement cycles).
 *
 * YAML schema:
 *   name, layer, template, [dbVerify], [mutating],
 *   apply: {methods?, pathRegex?}, params: <per-template>,
 *   expect: {status_in?, status_not_in?, body_not_includes?}
 *
 * Templates:
 *   param-variants — append each params.values[] as trailing segment
 *   query-variants — params.param + params.values[] → `path?param=<v>`
 *   method-fuzz    — same path, methods from params.methods[]
 *   malformed-body — POST with params.bodies[] (raw strings)
 *   header-fuzz    — GET with each params.headers[] header-set
 *   auth-negative  — endpoint's method, no/invalid credentials
 *   contract-basic — endpoint's method as-is (layer=contract default)
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { Endpoint, ExpectSpec, Scenario, Variant } from "./types";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCENARIOS_DIR = join(HERE, "..", "scenarios");

const DEFAULT_EXPECT: ExpectSpec = {
  statusIn: [200, 201, 202, 204, 301, 302, 304, 400, 401, 402, 403, 404, 405, 408, 409, 410, 422, 429],
  statusNotIn: [500, 501, 502, 503, 504, 505, 599],
};

const SECURITY_EXPECT: ExpectSpec = {
  statusIn: [400, 401, 402, 403, 404, 405, 408, 409, 410, 413, 414, 422, 429, 501],
  statusNotIn: [500, 502, 503, 504, 505],
  bodyNotIncludes: [],
};

interface YamlScenario {
  name: string;
  layer?: "contract" | "security";
  template: string;
  dbVerify?: boolean;
  mutating?: boolean;
  apply?: { methods?: string[]; pathRegex?: string };
  params?: {
    values?: string[];
    methods?: string[];
    bodies?: string[];
    headers?: Record<string, string>[];
    method?: string;
    param?: string;
  };
  expect?: {
    status_in?: number[];
    status_not_in?: number[];
    body_not_includes?: string[];
    headers?: Record<string, string>;
  };
}

/** `/a/b/:id` or `/a/b/{id}` → `/a/b/<value>`; без плейсхолдера — append. */
export function substitutePathParam(path: string, value: string): string {
  const replaced = path
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, value)
    .replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, value);
  return replaced === path ? `${path}/${value}` : replaced;
}

function yamlExpect(y: YamlScenario): ExpectSpec {
  const base = (y.layer ?? "security") === "contract" ? DEFAULT_EXPECT : SECURITY_EXPECT;
  return {
    statusIn: y.expect?.status_in ?? base.statusIn,
    statusNotIn: y.expect?.status_not_in ?? base.statusNotIn,
    bodyNotIncludes: y.expect?.body_not_includes ?? base.bodyNotIncludes,
    headers: y.expect?.headers,
  };
}

function compileYaml(y: YamlScenario): Scenario {
  const layer = y.layer ?? "security";
  const expect = yamlExpect(y);
  const methods = y.apply?.methods?.map(m => m.toUpperCase());
  const re = y.apply?.pathRegex ? new RegExp(y.apply.pathRegex) : null;
  const applies = (ep: Endpoint) =>
    (!methods || methods.includes(ep.method.toUpperCase())) &&
    (!re || re.test(ep.path));

  const variants = (ep: Endpoint): Variant[] => {
    const p = y.params ?? {};
    switch (y.template) {
      case "param-variants":
        return (p.values ?? []).map(v => ({
          method: ep.method,
          // replace :param/{param} placeholders with the probe value;
          // append as trailing segment when path has no params
          path: substitutePathParam(ep.path, v), expect,
          note: `param-variant ${v.slice(0, 24)}`,
        }));
      case "query-variants": {
        const qp = p.param;
        if (!qp) throw new Error(`query-variants (${y.name}) needs params.param`);
        return (p.values ?? []).map(v => ({
          method: ep.method,
          path: `${ep.path}${ep.path.includes("?") ? "&" : "?"}${encodeURIComponent(qp)}=${encodeURIComponent(v)}`,
          expect, note: `query ${qp}=${v.slice(0, 24)}`,
        }));
      }
      case "method-fuzz":
        return (p.methods ?? ["PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])
          .filter(m => m !== ep.method.toUpperCase())
          .map(m => ({
            method: m, path: ep.path,
            // OPTIONS preflight отвечает 204/200 by design (CORS) — не нарушение
            expect: m === "OPTIONS" && expect.statusIn
              ? { ...expect, statusIn: [...new Set([...expect.statusIn, 200, 204])] }
              : expect,
            note: `method ${m}`,
          }));
      case "malformed-body":
        return (p.bodies ?? []).map(b => ({
          method: "POST", path: ep.path, body: b,
          headers: { "content-type": "application/json" },
          expect, note: `body ${b.slice(0, 24).replace(/\n/g, " ")}`,
        }));
      case "header-fuzz":
        return (p.headers ?? []).map(h => ({
          method: ep.method, path: ep.path, headers: h, expect,
          note: `headers ${Object.keys(h).join(",")}`,
        }));
      case "auth-negative":
        return [{
          method: ep.method, path: ep.path,
          headers: { authorization: "Bearer probe-invalid-token" },
          expect, note: "invalid creds → 401/402/403",
        }];
      case "contract-basic":
        return [{ method: ep.method, path: ep.path, expect, note: "spec" }];
      default:
        throw new Error(`unknown template: ${y.template}`);
    }
  };

  return {
    name: y.name, layer,
    dbVerify: y.dbVerify ?? false,
    mutating: y.mutating ?? false,
    applies, variants,
  };
}

async function loadTsScenario(path: string): Promise<Scenario> {
  const mod = await import(path);
  const s = (mod.default ?? mod.scenario) as Scenario;
  if (!s?.name || !s.variants || !s.applies) {
    throw new Error(`TS scenario ${path} must export {name, applies, variants}`);
  }
  return {
    ...s,
    dbVerify: s.dbVerify ?? false,
    mutating: s.mutating ?? false,
    layer: s.layer ?? "security",
  };
}

/** Load all scenarios from dir (yaml + ts). Sorted by name. */
export async function loadScenarios(dir = SCENARIOS_DIR): Promise<Scenario[]> {
  const files = readdirSync(dir).sort();
  const out: Scenario[] = [];
  for (const f of files) {
    const p = join(dir, f);
    if (f.endsWith(".yaml") || f.endsWith(".yml")) {
      out.push(compileYaml(YAML.parse(readFileSync(p, "utf8")) as YamlScenario));
    } else if (f.endsWith(".ts")) {
      out.push(await loadTsScenario(p));
    }
  }
  return out;
}

export function pickScenarios(all: Scenario[], names?: string[], layer?: string): Scenario[] {
  let sel = all;
  if (names?.length) {
    const missing = names.filter(n => !all.some(s => s.name === n));
    if (missing.length) throw new Error(`unknown scenarios: ${missing.join(", ")}`);
    sel = sel.filter(s => names.includes(s.name));
  }
  if (layer) sel = sel.filter(s => s.layer === layer);
  return sel;
}
