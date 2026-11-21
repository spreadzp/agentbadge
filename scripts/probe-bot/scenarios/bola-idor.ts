/**
 * bola-idor (SLICE-234-40): A создаёт ресурс, B читает чужой id →
 * 401/403/404, не данные. Идентичности из env PROBE_ID_<NAME>
 * (bearer-токены; без env сценарий не применяется).
 */
import { contractBody } from "../src/scenarios";
import type { Scenario } from "../src/types";

const scenario: Scenario = {
  name: "bola-idor",
  layer: "security",
  dbVerify: true,
  mutating: true,
  applies: ep => ep.method === "POST" && !!ep.contract?.bodyTemplate &&
    (ep.contract.identities?.length ?? 0) >= 2 && !!ep.contract?.idField &&
    (ep.contract.identities ?? []).every(id => !!process.env[`PROBE_ID_${id.toUpperCase()}`]),
  variants: (ep, ctx) => {
    const c = ep.contract!;
    const [a, b] = c.identities!;
    const tokenA = process.env[`PROBE_ID_${a.toUpperCase()}`]!;
    const tokenB = process.env[`PROBE_ID_${b.toUpperCase()}`]!;
    const body = contractBody(ep, "bola-idor", ctx)!;
    const h = (t: string) => ({ "content-type": "application/json", authorization: `Bearer ${t}` });
    const expect = {
      statusIn: [200, 201, 202, 400, 401, 402, 403, 404, 409, 422, 429],
      statusNotIn: [500, 502, 503, 504],
    };
    const readPath = c.readPathField
      ? `{step1.${c.readPathField}}`
      : `${ep.path}/{step1.${c.idField}}`;
    return [{
      method: "POST", path: ep.path, headers: h(tokenA), body, expect,
      note: `B(${b}) reads A(${a}) resource → refuse`,
      flow: {
        steps: [
          { method: "POST", path: ep.path, headers: h(tokenA), body, note: "A creates" },
          { method: "GET", path: readPath, headers: { authorization: `Bearer ${tokenB}` },
            note: "B reads",
            expect: { statusIn: [400, 401, 403, 404, 429], statusNotIn: [200, 201, 500, 502, 503, 504] } },
        ],
      },
    }];
  },
};
export default scenario;
