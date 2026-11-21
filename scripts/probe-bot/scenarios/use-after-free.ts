/**
 * use-after-free (SLICE-234-40): ресурс создаётся → freeAction
 * (delete/withdraw) → GET по id должен дать 404/410, не данные.
 */
import { contractBody } from "../src/scenarios";
import type { Scenario } from "../src/types";

const scenario: Scenario = {
  name: "use-after-free",
  layer: "security",
  dbVerify: true,
  mutating: true,
  applies: ep => ep.method === "POST" && !!ep.contract?.bodyTemplate &&
    !!ep.contract?.freeAction && !!ep.contract?.idField,
  variants: (ep, ctx) => {
    const c = ep.contract!;
    const body = contractBody(ep, "use-after-free", ctx)!;
    const headers = { "content-type": "application/json" };
    const fa = c.freeAction!;
    const expect = {
      statusIn: [200, 201, 202, 400, 401, 402, 403, 404, 409, 422, 429],
      statusNotIn: [500, 502, 503, 504],
    };
    return [{
      method: "POST", path: ep.path, headers, body, expect,
      note: "create → free → GET → 404/410",
      flow: {
        steps: [
          { method: "POST", path: ep.path, headers, body, note: "create" },
          { method: fa.method, path: fa.path.replace("{id}", `{step1.${c.idField}}`),
            headers, body: fa.body ? JSON.stringify(fa.body) : undefined, note: "free" },
          { method: "GET", path: c.readPathField
              ? `{step1.${c.readPathField}}`
              : `${ep.path}/{step1.${c.idField}}`,
            note: "read after free",
            expect: { statusIn: [400, 401, 403, 404, 410, 429], statusNotIn: [200, 201, 500, 502, 503, 504] } },
        ],
      },
    }];
  },
};
export default scenario;
