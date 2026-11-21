/**
 * terminal-replay (SLICE-234-40): ресурс в терминальном статусе
 * (respond/reject) → повторный transition → 409, не 200.
 * Env: ADMIN_API_KEY. Только local/dev — на проде создаёт шум.
 */
import { contractBody, caseToken } from "../src/scenarios";
import type { Scenario } from "../src/types";

const scenario: Scenario = {
  name: "terminal-replay",
  layer: "contract",
  dbVerify: true,
  mutating: true,
  applies: ep => ep.method === "POST" && !!ep.contract?.bodyTemplate &&
    !!ep.contract?.lifecycleAdmin && !!process.env.ADMIN_API_KEY,
  variants: (ep, ctx) => {
    const c = ep.contract!;
    const key = `BOT-PROBE-${caseToken(ep, "terminal-replay")}`;
    const adminH = {
      "content-type": "application/json",
      "x-admin-key": process.env.ADMIN_API_KEY!,
      "x-operator-id": `BOT-PROBE-${caseToken(ep, "tr-op")}`,
    };
    const body = contractBody(ep, "terminal-replay", ctx)!;
    const expect = {
      statusIn: [200, 201, 202, 400, 401, 402, 403, 404, 409, 422, 429],
      statusNotIn: [500, 502, 503, 504],
    };
    const adminBase = c.lifecycleAdmin!;
    const respond = {
      method: "POST", path: `${adminBase}/{step1.requestId}/respond`,
      headers: adminH, body: JSON.stringify({ text: `BOT-PROBE ${key.slice(-8)}` }),
    };
    return [{
      method: "POST", path: ep.path,
      headers: { "content-type": "application/json", "idempotency-key": key },
      body, expect,
      note: "respond → respond again → 409",
      flow: {
        steps: [
          { method: "POST", path: ep.path,
            headers: { "content-type": "application/json", "idempotency-key": key },
            body, note: "submit" },
          { ...respond, note: "respond #1" },
          { ...respond, note: "respond #2 (replay)",
            expect: { statusIn: [400, 401, 403, 404, 409, 422, 429], statusNotIn: [200, 201, 202, 500, 502, 503, 504] } },
        ],
      },
    }];
  },
};
export default scenario;
