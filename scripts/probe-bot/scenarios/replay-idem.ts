/**
 * replay-idem — идемпотентность: один и тот же запрос с одинаковым
 * Idempotency-Key дважды → второй не должен создавать дубль/500.
 * Port probe-replay.sh. Кейс сгенерирует ДВА хита (req + replay).
 * mutating: тело может создавать объекты — только с --allow-mutations.
 */

import type { Endpoint, Scenario, Variant } from "../src/types";

const scenario: Scenario = {
  name: "replay-idem",
  layer: "security",
  dbVerify: false,
  mutating: true,
  applies: (ep: Endpoint) => ep.method === "POST" && ep.source !== "manual",
  variants: (ep: Endpoint): Variant[] => {
    const idem = `probe-${Date.now().toString(36)}`;
    const body = "{}";
    const mk = (n: number): Variant => ({
      method: "POST", path: ep.path, body,
      headers: {
        "content-type": "application/json",
        "idempotency-key": idem,
      },
      expect: {
        // второй хит: 2xx (дедуп) или 4xx (отказ/валидация) — не 5xx
        statusIn: [200, 201, 202, 204, 400, 401, 402, 403, 404, 405, 409, 422, 429],
        statusNotIn: [500, 502, 503, 504],
      },
      note: `replay ${n}/2 idem=${idem}`,
    });
    return [mk(1), mk(2)];
  },
};

export default scenario;
