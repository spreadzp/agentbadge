/**
 * payto-proof-surface (SLICE-258-25): deep-asserts на 258-поверхности
 * сверх path-синтаксиса expect.json.
 *
 * - /.well-known/x402-payto.json — draft-x402payto1 файл: версия,
 *   domain == хост таргета, непустой payTo, каждая запись с
 *   0x-адресом (40 hex) и 0x-подписью.
 * - /agent-readiness.json — self-scan showcase: scan.status ok +
 *   assertions СОДЕРЖИТ AB-188/AB-189/AB-190 со статусом VERIFIED
 *   (deep-contains; regression-proxy для audit C2/H2 — деградация
 *   вердикта правила краснит кейс на проде).
 */
import type { Endpoint, Scenario, Variant } from "../src/types";
import type { HttpObservation } from "../src/verify";

const PAYTO_PATH = "/.well-known/x402-payto.json";
const SHOWCASE_PATH = "/agent-readiness.json";
const REQUIRED_VERIFIED = ["AB-188", "AB-189", "AB-190"];

const BASE_EXPECT = {
  statusIn: [200],
  statusNotIn: [301, 302, 400, 401, 402, 403, 404, 405, 500, 502, 503, 504],
};

function assertPaytoBody(obs: HttpObservation[], target: string): string[] {
  const problems: string[] = [];
  const body = obs[0]?.bodyJson as
    | { version?: unknown; domain?: unknown; payTo?: unknown }
    | undefined;
  if (!body) return ["payto body is not JSON"];
  const host = new URL(target).hostname;
  if (body.domain !== host) {
    problems.push(`domain "${String(body.domain)}" != target host "${host}"`);
  }
  if (!Array.isArray(body.payTo) || body.payTo.length === 0) {
    problems.push("payTo is not a non-empty array");
    return problems;
  }
  for (const [i, entry] of body.payTo.entries()) {
    const e = entry as { address?: unknown; signature?: unknown; issued?: unknown };
    if (typeof e.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(e.address)) {
      problems.push(`payTo[${i}].address malformed: ${JSON.stringify(e.address)}`);
    }
    if (typeof e.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(e.signature)) {
      problems.push(`payTo[${i}].signature malformed: ${JSON.stringify(e.signature)?.slice(0, 60)}`);
    }
  }
  return problems;
}

function assertShowcase(obs: HttpObservation[]): string[] {
  const problems: string[] = [];
  const body = obs[0]?.bodyJson as
    | { scan?: { status?: unknown; assertions?: unknown } }
    | undefined;
  const scan = body?.scan;
  if (scan?.status !== "ok") {
    problems.push(`scan.status=${JSON.stringify(scan?.status)}, want "ok"`);
  }
  if (!Array.isArray(scan?.assertions)) {
    problems.push("scan.assertions is not an array");
    return problems;
  }
  for (const id of REQUIRED_VERIFIED) {
    const a = (scan.assertions as { rule_id?: string; status?: string }[]).find(
      x => x.rule_id === id,
    );
    if (!a) {
      problems.push(`assertion ${id} missing from showcase`);
    } else if (a.status !== "VERIFIED") {
      problems.push(`assertion ${id} status=${a.status}, want VERIFIED`);
    }
  }
  return problems;
}

const scenario: Scenario = {
  name: "payto-proof-surface",
  layer: "contract",
  dbVerify: false,
  mutating: false,
  applies: ep =>
    ep.method === "GET" && (ep.path === PAYTO_PATH || ep.path === SHOWCASE_PATH),
  variants: (ep: Endpoint, ctx): Variant[] => {
    const target = ctx?.target ?? "";
    if (ep.path === PAYTO_PATH) {
      return [{
        method: "GET", path: ep.path,
        expect: {
          ...BASE_EXPECT,
          headers: { "cache-control": "public" },
          json: { equals: { version: 1 }, present: ["domain", "payTo"] },
        },
        note: "x402payto file: version/domain/payTo shape",
        flow: {
          steps: [{ method: "GET", path: ep.path, note: "read proof file" }],
          assert: obs => assertPaytoBody(obs, target),
        },
      }];
    }
    return [{
      method: "GET", path: ep.path,
      expect: {
        ...BASE_EXPECT,
        json: { present: ["scan.status", "scan.assertions", "scan.score"] },
      },
      note: "self-scan showcase: AB-188/189/190 VERIFIED",
      flow: {
        steps: [{ method: "GET", path: ep.path, note: "read showcase" }],
        assert: assertShowcase,
      },
    }];
  },
};

export default scenario;
