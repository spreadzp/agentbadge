// SLICE-258-11: shared harness for the e2e outcome matrix.
// Virtual transports (site map + DoH fixtures) + fixture builders +
// the scanDomain→RuleEngine→report helper. The actual vi.mock calls
// live in each *.test.ts file (vi.mock is file-scoped/hoisted).
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanDomain } from "../../../../src/agent-readiness/scanner/orchestrator";
import { RuleEngine } from "../../../../src/agent-readiness/rule-engine/rule-engine";
import { formatScanReport } from "../../../../src/agent-readiness/report-formatter";
import { buildCanonicalMessage } from "../../../../../../packages/x402-payto-proof/src/index.ts";
import { privateKeyToAccount } from "viem/accounts";

export const PUBLIC_IP = "93.184.216.34";
export const RESOURCES = ["x402_payto_dns", "x402_payto_site", "x402", "l402"];

// ─── Virtual site transport ─────────────────────────────────────────

export interface RouteResp {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

/** host → route-key (`"GET /p"`, `"POST /p"` or `"/p"`) → queue.
 *  Entries consumed per request; the last one repeats. */
export const sites = new Map<string, Map<string, RouteResp[]>>();

export function routeSite(
  url: string,
  opts?: { method?: string },
): Promise<Response> {
  const u = new URL(url);
  const routes = sites.get(u.hostname);
  if (!routes) return Promise.reject(new Error(`no fixture site: ${u.hostname}`));
  const method = opts?.method ?? "GET";
  const entry = routes.get(`${method} ${u.pathname}`) ?? routes.get(u.pathname);
  if (!entry || entry.length === 0) {
    return Promise.resolve(new Response("Not Found", { status: 404 }));
  }
  const resp = entry.length > 1 ? entry.shift()! : entry[0]!;
  return Promise.resolve(
    new Response(resp.body ?? "", { status: resp.status, headers: resp.headers }),
  );
}

// ─── DoH fixtures ────────────────────────────────────────────────────

export interface DohAnswer {
  name?: string;
  type?: number;
  data: string;
  TTL?: number;
}
export type DohResp = { Status: number; Answer?: DohAnswer[] } | "error";
export const doh = new Map<string, { google?: DohResp; cf?: DohResp }>();

export function dohOk(...records: { data: string; ttl?: number }[]): DohResp {
  return {
    Status: 0,
    Answer: records.map((r) => ({
      name: "_x402-payto.x.",
      type: 16,
      data: r.data,
      TTL: r.ttl ?? 300,
    })),
  };
}
export const DOH_NXDOMAIN: DohResp = { Status: 3 };

export async function mockFetch(
  input: unknown,
  init?: { method?: string },
): Promise<Response> {
  const url = typeof input === "string" ? input : (input as URL).toString();
  const u = new URL(url);
  if (u.hostname === "dns.google" || u.hostname === "cloudflare-dns.com") {
    const name = u.searchParams.get("name") ?? "";
    const slot = doh.get(name);
    const r = u.hostname === "dns.google" ? slot?.google : slot?.cf;
    const resp = r ?? DOH_NXDOMAIN;
    if (resp === "error") return Promise.reject(new Error("resolver unreachable"));
    return Promise.resolve(
      new Response(JSON.stringify(resp), {
        status: 200,
        headers: { "content-type": "application/dns-json" },
      }),
    );
  }
  return routeSite(url, init);
}

/** Same answer on both resolvers, or per-resolver override. */
export function dns(
  qname: string,
  resp: DohResp | { google?: DohResp; cf?: DohResp },
) {
  if (typeof resp === "object" && ("google" in resp || "cf" in resp)) {
    doh.set(qname, resp as { google?: DohResp; cf?: DohResp });
  } else {
    doh.set(qname, { google: resp as DohResp, cf: resp as DohResp });
  }
}

// ─── Fixture payloads ────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "..", "fixtures", "e2e-matrix");
export const LIVE_DNS = JSON.parse(
  readFileSync(join(FIXTURE_DIR, "live-dns.json"), "utf-8"),
) as { records: Record<string, { ttl: number; data: string }> };
export const AB_MANIFEST = readFileSync(
  join(FIXTURE_DIR, "agentbadge.xyz.x402-manifest.json"),
  "utf-8",
);
export const SW_PAYMENT_REQUIRED = readFileSync(
  join(FIXTURE_DIR, "api.settlewatch.com.payment-required.b64"),
  "utf-8",
).trim();
export const AB_CHALLENGE_HEADERS = readFileSync(
  join(FIXTURE_DIR, "agentbadge.xyz.challenge-headers.txt"),
  "utf-8",
);

export const SIGNER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
export const SIGNED_ADDR = SIGNER.address.toLowerCase();
export const ADDR_A = "0xaaaabbbbccccddddeeeeffff0000111122223333";
export const ADDR_B = "0x1111222233334444555566667777888899990000";
export const ADDR_C = "0x9999888877776666555544443333222211110000";
export const ADDR_SOL = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM";

const sigCache = new Map<string, string>();
export async function signedTxt(
  domain: string,
  addr: string,
  issued: string,
): Promise<string> {
  const key = `${domain}|${addr}|${issued}`;
  let sig = sigCache.get(key);
  if (!sig) {
    sig = await SIGNER.signMessage({
      message: buildCanonicalMessage({ domain, address: addr, issued }),
    });
    sigCache.set(key, sig);
  }
  return `v=x402payto1; a=${addr}; d=${issued}; s=${sig}`;
}
export const txt = (addr: string, extra = "") =>
  `v=x402payto1; a=${addr}; d=2026-11-20${extra}`;

// ─── Site builders ────────────────────────────────────────────────────

export interface Accept {
  scheme?: string;
  network?: string;
  asset?: string;
  payTo?: string;
  [k: string]: unknown;
}
export const accept = (
  payTo: string,
  network = "eip155:5042",
  asset = "USDC",
): Accept => ({ scheme: "exact", network, asset, payTo });

export const payRequired = (doc: unknown) =>
  Buffer.from(JSON.stringify(doc)).toString("base64");

export const paid402 = (
  accepts: Accept[],
  extra?: { headers?: Record<string, string>; extensions?: unknown },
): RouteResp => ({
  status: 402,
  headers: {
    "payment-required": payRequired({
      x402Version: 2,
      accepts,
      ...(extra?.extensions ? { extensions: extra.extensions } : {}),
    }),
    "content-type": "application/json",
    ...extra?.headers,
  },
  body: "",
});

export const manifestBody = (
  services: { method: string; path: string }[],
  payTo?: string,
) => JSON.stringify({ x402Version: 1, payTo, network: "eip155:5042", services });

export function x402Site(
  host: string,
  cfg: {
    path?: string;
    accepts?: Accept[] | null;
    probes?: RouteResp[];
    manifest?: string | false;
    paytoWellKnown?: RouteResp;
    l402?: RouteResp[];
  } = {},
) {
  const path = cfg.path ?? "/paid";
  const routes = new Map<string, RouteResp[]>();
  const manifest =
    cfg.manifest === false
      ? null
      : (cfg.manifest ?? manifestBody([{ method: "GET", path }]));
  if (manifest !== null) {
    routes.set("/.well-known/x402.json", [
      { status: 200, headers: { "content-type": "application/json" }, body: manifest },
    ]);
  }
  const probes =
    cfg.probes ?? (cfg.accepts ? [paid402(cfg.accepts), paid402(cfg.accepts)] : []);
  if (probes.length) routes.set(`GET ${path}`, probes);
  if (cfg.paytoWellKnown) routes.set("/.well-known/x402-payto.json", [cfg.paytoWellKnown]);
  if (cfg.l402) routes.set("POST /passport/request", cfg.l402);
  sites.set(host, routes);
}

export const stripeReq = (recipient: string) =>
  Buffer.from(JSON.stringify({ amount: "100", currency: "usd", recipient })).toString("base64url");

export const l402Mpp = (recipient: string, more = ""): RouteResp => ({
  status: 402,
  headers: {
    "www-authenticate": `Payment method="stripe", request="${stripeReq(recipient)}"${more}`,
    "content-type": "application/json",
  },
  body: "",
});

// ─── Scan helper ──────────────────────────────────────────────────────

export async function scan(host: string) {
  const state = await scanDomain(`https://${host}`, { resources: RESOURCES });
  const engine = RuleEngine.run(state);
  const report = formatScanReport(`https://${host}`, engine);
  const assertion = (id: string) => engine.assertions.find((a) => a.rule_id === id)!;
  const detail = (id: string) => {
    const reason = assertion(id).reason ?? "";
    const i = reason.indexOf("{");
    return i >= 0 ? (JSON.parse(reason.slice(i)) as Record<string, unknown>) : { raw: reason };
  };
  return { state, engine, report, assertion, detail };
}
