/**
 * projection-leak (SLICE-234-40): public read-проекция не содержит
 * denylist-полей (internal, prisma, admin notes…). flow: submit →
 * GET readPathField/{idField} → json.absent на проекции.
 */
import { contractBody } from "../src/scenarios";
import type { Scenario } from "../src/types";
import { getPath } from "../src/verify";

const scenario: Scenario = {
  name: "projection-leak",
  layer: "security",
  dbVerify: true,
  mutating: true,
  applies: ep => ep.method === "POST" && !!ep.contract?.bodyTemplate &&
    !!(ep.contract.projectionDenylist?.length) &&
    !!(ep.contract.readPathField || ep.contract.idField),
  variants: (ep, ctx) => {
    const c = ep.contract!;
    const body = contractBody(ep, "projection-leak", ctx)!;
    const headers = { "content-type": "application/json" };
    const readExpr = c.readPathField
      ? `{step1.${c.readPathField}}`
      : `/${ep.path.replace(/^\/+|\/+$/g, "")}/{step1.${c.idField}}`;
    const expect = {
      statusIn: [200, 201, 202, 400, 401, 402, 403, 404, 409, 422, 429],
      statusNotIn: [500, 502, 503, 504],
    };
    return [{
      method: "POST", path: ep.path, headers, body, expect,
      note: "submit → GET projection → denylist absent",
      flow: {
        steps: [
          { method: "POST", path: ep.path, headers, body, note: "submit" },
          { method: "GET", path: readExpr, note: "read projection",
            expect: { statusIn: [200, 400, 401, 404, 429], statusNotIn: [500, 502, 503, 504] } },
        ],
        assert: obs => {
          const problems: string[] = [];
          const proj = obs[1];
          if (!proj || proj.status !== 200 || proj.bodyJson === undefined) return problems;
          for (const p of c.projectionDenylist ?? []) {
            if (getPath(proj.bodyJson, p) !== undefined) {
              problems.push(`projection leaked "${p}"`);
            }
          }
          return problems;
        },
      },
    }];
  },
};
export default scenario;
