/**
 * session-grouping (SLICE-234-40): два сабмита с одинаковым
 * context.sessionId → оба принимаются и ответы ссылаются на
 * тот же sessionId (группировка не разваливается).
 */
import { contractBody } from "../src/scenarios";
import type { Scenario } from "../src/types";
import { getPath } from "../src/verify";

const scenario: Scenario = {
  name: "session-grouping",
  layer: "contract",
  dbVerify: true,
  mutating: true,
  applies: ep => ep.method === "POST" &&
    !!ep.contract?.bodyTemplate?.context &&
    typeof (ep.contract.bodyTemplate.context as Record<string, unknown>).sessionId === "string",
  variants: (ep, ctx) => {
    const body = contractBody(ep, "session-grouping", ctx)!;
    const headers = { "content-type": "application/json" };
    const expect = {
      statusIn: [200, 201, 202, 400, 401, 402, 403, 409, 422, 429],
      statusNotIn: [500, 502, 503, 504],
    };
    return [{
      method: "POST", path: ep.path, headers, body, expect,
      note: "2 submits same sessionId → same session",
      flow: {
        steps: [
          { method: "POST", path: ep.path, headers, body, note: "submit #1" },
          { method: "POST", path: ep.path, headers, body, note: "submit #2" },
        ],
        assert: obs => {
          const problems: string[] = [];
          if (obs.length < 2) return problems;
          const s1 = getPath(obs[0].bodyJson, "sessionId");
          const s2 = getPath(obs[1].bodyJson, "sessionId");
          if (obs[0].status === 202 && obs[1].status === 202 && s1 && s2 && s1 !== s2) {
            problems.push(`session split: ${s1} ≠ ${s2} при одинаковом sessionId`);
          }
          return problems;
        },
      },
    }];
  },
};
export default scenario;
