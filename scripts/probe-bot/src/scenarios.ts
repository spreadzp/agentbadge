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
 *   path-feed      — params.values_file → абсолютные пути (endpoint-discovery)
 *   method-fuzz    — same path, methods from params.methods[]
 *   malformed-body — POST with params.bodies[] (raw strings)
 *   header-fuzz    — GET with each params.headers[] header-set
 *   auth-negative  — endpoint's method, no/invalid credentials
 *   contract-basic — endpoint's method as-is (layer=contract default)
 *   contract-submit — POST ep.contract.bodyTemplate ({case_key}/{run_id})
 *   negative-contract — body_template + per-field мутации → 4xx
 *   ignored-auth   — contract body + мусорные creds → как anon или 401
 *   mass-assignment — contract body + admin/proto поля → отказ/не-протекло
 *   unsupported-method — методы вне схемы → 405/404 (+Allow на 405)
 *   deprecation-pair — GET + assert headers Deprecation/Sunset
 *   ssrf-guard     — contract body + webhookUrl→169.254.169.254 → 4xx
 *   origin-guard   — contract method + Origin:evil → 4xx
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { Endpoint, EndpointContract, ExpectSpec, Scenario, ScenarioContext, Variant } from "./types";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCENARIOS_DIR = join(HERE, "..", "scenarios");
export const PAYLOADS_DIR = join(HERE, "..", "payloads");

/** Читает вендорный payload-файл: строки, `#` — комментарий, пустые скип. */
export function loadPayloadFile(name: string): string[] {
  try {
    return readFileSync(join(PAYLOADS_DIR, name), "utf8")
      .split("\n")
      .map(l => l.trimEnd())
      .filter(l => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

/** Стабильный per-case токен для contract-подстановок
 *  (идемпотентность дружественна к дедупу: тот же кейс → тот же ключ). */
export function caseToken(ep: Endpoint, scenario: string, salt = ""): string {
  return "pb" + createHash("sha1")
    .update(`${ep.method}|${ep.path}|${scenario}|${salt}`).digest("hex").slice(0, 10);
}

/** {case_key}/{run_id}/{ts} подстановки в строках contract-шаблона. */
export function substituteTokens(v: unknown, tokens: Record<string, string>): unknown {
  if (typeof v === "string") {
    return v.replace(/\{(case_key|run_id|ts)\}/g, (_, k) => tokens[k] ?? "");
  }
  if (Array.isArray(v)) return v.map(x => substituteTokens(x, tokens));
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substituteTokens(x, tokens)]));
  }
  return v;
}

export function contractBody(ep: Endpoint, sc: string, ctx?: ScenarioContext, salt = ""): string | null {
  const tpl = ep.contract?.bodyTemplate;
  if (!tpl) return null;
  const tokens = {
    case_key: caseToken(ep, sc, salt),
    run_id: ctx?.runId ?? "norun",
    ts: String(Math.floor(Date.now() / 1000)),
  };
  return JSON.stringify(substituteTokens(tpl, tokens));
}

/** Заголовки contract-запроса: content-type + idempotency-header
 *  из contract.idempotencyField ("header:X"), иначе контрактные
 *  запросы упираются в guard до бизнес-логики. */
export function contractHeaders(ep: Endpoint, sc: string, extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  const f = ep.contract?.idempotencyField;
  if (f?.startsWith("header:")) {
    h[f.slice(7)] = `BOT-PROBE-${caseToken(ep, sc)}`;
  }
  return { ...h, ...extra };
}

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
    /** Файл из payloads/: строки дополняют params.values. */
    values_file?: string;
    methods?: string[];
    /** Файл методов (webdav feed) дополняет params.methods. */
    methods_file?: string;
    bodies?: string[];
    bodies_file?: string;
    headers?: Record<string, string>[];
    method?: string;
    param?: string;
    /** Поле в bodyTemplate для ssrf-guard инъекции. */
    url_field?: string;
    /** Origin-значение для origin-guard (default: https://evil.example). */
    origin?: string;
  };
  expect?: {
    status_in?: number[];
    status_not_in?: number[];
    body_not_includes?: string[];
    headers?: Record<string, string>;
    json?: {
      present?: string[];
      absent?: string[];
      equals?: Record<string, unknown>;
      regex?: Record<string, string>;
      schema_ref?: string;
    };
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
  const j = y.expect?.json;
  return {
    statusIn: y.expect?.status_in ?? base.statusIn,
    statusNotIn: y.expect?.status_not_in ?? base.statusNotIn,
    bodyNotIncludes: y.expect?.body_not_includes ?? base.bodyNotIncludes,
    headers: y.expect?.headers,
    json: j ? {
      present: j.present, absent: j.absent,
      equals: j.equals, regex: j.regex, schemaRef: j.schema_ref,
    } : undefined,
  };
}

function compileYaml(y: YamlScenario): Scenario {
  const layer = y.layer ?? "security";
  const expect = yamlExpect(y);
  const methods = y.apply?.methods?.map(m => m.toUpperCase());
  const re = y.apply?.pathRegex ? new RegExp(y.apply.pathRegex) : null;
  // Шаблоны, которым нужен contract.bodyTemplate — applies=false без него,
  // чтобы план не плодил пустые кейсы (invariant: applies → ≥1 variant).
  const NEEDS_CONTRACT = new Set([
    "contract-submit", "negative-contract", "ignored-auth",
    "mass-assignment", "ssrf-guard",
  ]);
  const applies = (ep: Endpoint) =>
    (!methods || methods.includes(ep.method.toUpperCase())) &&
    (!re || re.test(ep.path)) &&
    (!NEEDS_CONTRACT.has(y.template) || !!ep.contract?.bodyTemplate);

  const variants = (ep: Endpoint, ctx?: ScenarioContext): Variant[] => {
    const p = y.params ?? {};
    // values_file/methods_file/bodies_file — вендорные feeds из payloads/
    const values = [...(p.values ?? []), ...(p.values_file ? loadPayloadFile(p.values_file) : [])];
    const methodsList = [...(p.methods ?? []), ...(p.methods_file ? loadPayloadFile(p.methods_file) : [])];
    const bodies = [...(p.bodies ?? []), ...(p.bodies_file ? loadPayloadFile(p.bodies_file) : [])];
    switch (y.template) {
      case "param-variants":
        return values.map(v => ({
          method: ep.method,
          // replace :param/{param} placeholders with the probe value;
          // append as trailing segment when path has no params
          path: substitutePathParam(ep.path, v), expect,
          note: `param-variant ${v.slice(0, 24)}`,
        }));
      case "query-variants": {
        const qp = p.param;
        if (!qp) throw new Error(`query-variants (${y.name}) needs params.param`);
        return values.map(v => ({
          method: ep.method,
          path: `${ep.path}${ep.path.includes("?") ? "&" : "?"}${encodeURIComponent(qp)}=${encodeURIComponent(v)}`,
          expect, note: `query ${qp}=${v.slice(0, 24)}`,
        }));
      }
      case "path-feed":
        // Абсолютные пути из feed'а — endpoint-discovery на hidden paths.
        return values.map(v => ({
          method: "GET", path: v, expect, note: `path ${v}`,
        }));
      case "method-fuzz":
        return (methodsList.length ? methodsList : ["PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])
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
        return bodies.map(b => ({
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
      case "contract-submit": {
        const body = contractBody(ep, y.name, ctx);
        if (body == null) return [];
        return [{
          method: "POST", path: ep.path, body,
          headers: contractHeaders(ep, y.name),
          expect, note: "valid contract body",
        }];
      }
      case "negative-contract": {
        // Per-field мутации валидного шаблона: null, type-flip, drop.
        const tpl = ep.contract?.bodyTemplate;
        if (!tpl) return [];
        const out: Variant[] = [];
        for (const [field, val] of Object.entries(tpl)) {
          for (const mut of [
            { ...tpl, [field]: null },
            typeof val === "string"
              ? { ...tpl, [field]: 12345 }
              : { ...tpl, [field]: "str" },
          ]) {
            const body = JSON.stringify(substituteTokens(mut, {
              case_key: caseToken(ep, y.name, `${field}-neg`),
              run_id: ctx?.runId ?? "norun",
              ts: String(Math.floor(Date.now() / 1000)),
            }));
            out.push({
              method: "POST", path: ep.path, body,
              headers: contractHeaders(ep, y.name),
              expect, note: `negative ${field}`,
            });
          }
          const { [field]: _dropped, ...rest } = tpl;
          out.push({
            method: "POST", path: ep.path,
            body: JSON.stringify(substituteTokens(rest, {
              case_key: caseToken(ep, y.name, `${field}-drop`),
              run_id: ctx?.runId ?? "norun",
              ts: String(Math.floor(Date.now() / 1000)),
            })),
            headers: contractHeaders(ep, y.name),
            expect, note: `negative drop ${field}`,
          });
        }
        return out;
      }
      case "ignored-auth": {
        // Поле/заголовок-обманка: сервер должен игнорить или отказать 401.
        const body = contractBody(ep, y.name, ctx);
        if (body == null) return [];
        return [
          { method: "POST", path: ep.path, body,
            headers: contractHeaders(ep, y.name, { authorization: "Bearer probe-forged-admin-token" }),
            expect, note: "forged bearer" },
          { method: "POST", path: ep.path, body,
            headers: contractHeaders(ep, y.name, { "x-admin-key": "probe-forged-key" }),
            expect, note: "forged x-admin-key" },
        ];
      }
      case "mass-assignment": {
        const body = contractBody(ep, y.name, ctx);
        if (body == null) return [];
        let obj: Record<string, unknown>;
        try { obj = JSON.parse(body) as Record<string, unknown>; }
        catch { return []; }
        const polluted = {
          ...obj, admin: true, role: "admin", isAdmin: true,
          tenantId: "probe-foreign-tenant", verified: true,
          "__proto__": { admin: true },
        };
        return [{
          method: "POST", path: ep.path, body: JSON.stringify(polluted),
          headers: contractHeaders(ep, y.name),
          expect, note: "extra privileged fields",
        }];
      }
      case "unsupported-method":
        // TRACK/DEBUG исключены из дефолта: Bun fetch() нормализует
        // неизвестные методы в GET → вечный false-positive (258-25).
        return (methodsList.length ? methodsList : ["PROPFIND", "SEARCH", "CONNECT"])
          .map(m => ({
            method: m, path: ep.path, expect,
            note: `unsupported ${m}`,
          }));
      case "deprecation-pair":
        return [{ method: ep.method, path: ep.path, expect, note: "deprecation headers" }];
      case "ssrf-guard": {
        const body = contractBody(ep, y.name, ctx);
        if (body == null) return [];
        let obj: Record<string, unknown>;
        try { obj = JSON.parse(body) as Record<string, unknown>; }
        catch { return []; }
        const field = p.url_field ?? "webhookUrl";
        const targets = values.length ? values : ["http://169.254.169.254/latest/meta-data", "http://127.0.0.1:8080/internal", "file:///etc/passwd"];
        return targets.map(u => ({
          method: "POST", path: ep.path,
          body: JSON.stringify({ ...obj, [field]: u }),
          headers: contractHeaders(ep, y.name),
          expect, note: `ssrf ${u.slice(0, 40)}`,
        }));
      }
      case "origin-guard": {
        const body = ep.contract?.bodyTemplate ? contractBody(ep, y.name, ctx) : null;
        const o = p.origin ?? "https://evil.example";
        return [
          { method: ep.method, path: ep.path,
            headers: { origin: o, ...(body ? { "content-type": "application/json" } : {}) },
            ...(body ? { body } : {}),
            expect, note: `origin ${o}` },
        ];
      }
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
