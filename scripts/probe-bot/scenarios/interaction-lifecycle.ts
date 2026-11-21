/**
 * interaction-lifecycle (SLICE-234-40): полный цикл 228 — submit →
 * admin classify → respond → poll statusUrl → терминальный статус.
 * Требует ADMIN_API_KEY в env (секрет только из .env). Атрибуция:
 * x-operator-id = BOT-PROBE-<case>.
 */
import { contractBody, caseToken } from "../src/scenarios";
import type { Scenario } from "../src/types";
import { getPath } from "../src/verify";

const scenario: Scenario = {
  name: "interaction-lifecycle",
  layer: "contract",
  dbVerify: true,
  mutating: true,
  applies: ep => ep.method === "POST" && !!ep.contract?.bodyTemplate &&
    !!ep.contract?.lifecycleAdmin && !!process.env.ADMIN_API_KEY,
  variants: (ep, ctx) => {
    const c = ep.contract!;
    const key = `BOT-PROBE-${caseToken(ep, "interaction-lifecycle")}`;
    const adminKey = process.env.ADMIN_API_KEY!;
    const body = contractBody(ep, "interaction-lifecycle", ctx)!;
    const submitH = {
      "content-type": "application/json",
      "idempotency-key": key,
    };
    const adminH = {
      "content-type": "application/json",
      "x-admin-key": adminKey,
      "x-operator-id": `BOT-PROBE-${caseToken(ep, "lc-op")}`,
    };
    const expect = {
      statusIn: [200, 201, 202, 400, 401, 402, 403, 404, 409, 422, 429],
      statusNotIn: [500, 502, 503, 504],
    };
    const adminBase = c.lifecycleAdmin!;
    return [{
      method: "POST", path: ep.path, headers: submitH, body, expect,
      note: "submit → classify → respond → poll → terminal",
      flow: {
        steps: [
          { method: "POST", path: ep.path, headers: submitH, body, note: "submit" },
          { method: "POST", path: `${adminBase}/{step1.requestId}/classify`,
            headers: adminH, body: JSON.stringify({ intent: "OTHER", outcome: "answer" }), note: "classify" },
          { method: "POST", path: `${adminBase}/{step1.requestId}/respond`,
            headers: adminH, body: JSON.stringify({ body: `BOT-PROBE answer ${key.slice(-8)}` }),
            note: "respond" },
          { method: "GET", path: "{step1.statusUrl}", note: "poll" },
        ],
        assert: obs => {
          const problems: string[] = [];
          const poll = obs[3];
          if (!poll || poll.status !== 200 || poll.bodyJson === undefined) return problems;
          const status = getPath(poll.bodyJson, "status");
          const terminal = c.terminalStates ?? ["ANSWERED", "REJECTED"];
          if (typeof status === "string" && !terminal.includes(status)) {
            problems.push(`terminal status ${status} ∉ [${terminal.join(",")}]`);
          }
          return problems;
        },
      },
    }];
  },
};
export default scenario;
