/**
 * burst-429 — rate-limit должен срабатывать: N быстрых запросов →
 * рано или поздно 429, и никогда 5xx. Port probe-burst.sh.
 * Бюджетный сценарий: variants возвращает пачку хитов на один path.
 */

import type { Endpoint, Scenario, Variant } from "../src/types";

const BURST_N = 12;

const scenario: Scenario = {
  name: "burst-429",
  layer: "security",
  dbVerify: false,
  mutating: false,
  applies: (ep: Endpoint) => ep.method === "GET" && !ep.path.includes("{"),
  variants: (ep: Endpoint): Variant[] =>
    Array.from({ length: BURST_N }, (_, i) => ({
      method: "GET",
      path: ep.path,
      expect: {
        statusIn: [200, 201, 204, 301, 302, 400, 401, 402, 403, 404, 405, 429],
        statusNotIn: [500, 502, 503, 504],
      },
      note: `burst ${i + 1}/${BURST_N} — ждём 429, не 5xx`,
    })),
};

export default scenario;
