/**
 * replay-idem-v2 (SLICE-234-40): настоящий replay-семантика.
 * Требует ep.contract.idempotencyField ("header:X" | поле тела) +
 * bodyTemplate. Два сабмита одним ключом → R2 должен подтвердить
 * идемпотентность (replayExpect / replayInvariant в contract).
 */
import { contractBody, caseToken, substituteTokens } from "../src/scenarios";
import type { Scenario } from "../src/types";
import { getPath } from "../src/verify";

const scenario: Scenario = {
  name: "replay-idem-v2",
  layer: "contract",
  dbVerify: true,
  mutating: true,
  applies: ep => ep.method === "POST" &&
    !!ep.contract?.bodyTemplate && !!ep.contract?.idempotencyField,
  variants: (ep, ctx) => {
    const c = ep.contract!;
    const key = `BOT-PROBE-${caseToken(ep, "replay-idem-v2")}`;
    const body = contractBody(ep, "replay-idem-v2", ctx)!;
    const isHeader = c.idempotencyField!.startsWith("header:");
    const field = c.idempotencyField!.replace(/^header:/, "");
    const headers = isHeader
      ? { "content-type": "application/json", [field]: key }
      : { "content-type": "application/json" };
    const bodyWithKey = isHeader
      ? body
      : JSON.stringify({ ...JSON.parse(body), [field]: key });

    const expect = {
      statusIn: [200, 201, 202, 400, 401, 402, 403, 409, 422, 429],
      statusNotIn: [500, 502, 503, 504],
    };
    return [{
      method: "POST", path: ep.path,
      headers, body: bodyWithKey, expect,
      note: `replay key=${key.slice(-10)}`,
      flow: {
        steps: [
          { method: "POST", path: ep.path, headers, body: bodyWithKey, note: "submit" },
          { method: "POST", path: ep.path, headers, body: bodyWithKey, note: "replay" },
        ],
        assert: obs => {
          const problems: string[] = [];
          if (obs.length < 2) return problems;
          const [r1, r2] = obs;
          const ok = (s: number | null) => s != null && [200, 201, 202].includes(s);
          if (!ok(r1.status)) return problems; // сабмит не принят — replay не тестируем
          // replayExpect: json.equals на ответе реплея
          for (const [p, want] of Object.entries(c.replayExpect ?? {})) {
            const got = getPath(r2.bodyJson, p);
            if (got !== want) {
              problems.push(`replay ${p}=${JSON.stringify(got)} want ${JSON.stringify(want)}`);
            }
          }
          // replayInvariant: пути равны R1==R2 (requestId не должен меняться)
          for (const p of c.replayInvariant ?? []) {
            const a = getPath(r1.bodyJson, p), b = getPath(r2.bodyJson, p);
            if (a === undefined && b === undefined) continue;
            if (JSON.stringify(a) !== JSON.stringify(b)) {
              problems.push(`invariant ${p}: R1=${JSON.stringify(a)} ≠ R2=${JSON.stringify(b)}`);
            }
          }
          // идемпотентный replay не должен падать 5xx при принятом сабмите
          if (r2.status != null && r2.status >= 500) {
            problems.push(`replay → ${r2.status} после принятого submit`);
          }
          return problems;
        },
      },
    }];
  },
};
export default scenario;
