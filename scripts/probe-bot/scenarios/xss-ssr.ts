/**
 * xss-ssr (SLICE-234-40): XSS-пейлоад в text-поле → SSR-страница
 * должна отдать его экранированным (нет сырого <script> в HTML).
 */
import { loadPayloadFile } from "../src/scenarios";
import type { Scenario } from "../src/types";
import { getPath } from "../src/verify";

const scenario: Scenario = {
  name: "xss-ssr",
  layer: "security",
  dbVerify: true,
  mutating: true,
  // ADMIN_API_KEY обязателен: без auth SSR-GET отвечает 401 и assert
  // проходит молча — сценарий ничего не проверяет.
  applies: ep => ep.method === "POST" && !!ep.contract?.bodyTemplate?.text &&
    !!ep.contract?.ssrPath && !!ep.contract?.idField && !!process.env.ADMIN_API_KEY,
  variants: (ep, ctx) => {
    const c = ep.contract!;
    const payloads = loadPayloadFile("xss-basic.txt").slice(0, 3);
    const expect = {
      // 301: step1 не создал строку (429/4xx) → ssr-URL пуст →
      // /admin/interactions/ → trailing-slash canonicalization.
      statusIn: [200, 201, 202, 301, 400, 401, 402, 403, 404, 409, 422, 429],
      statusNotIn: [500, 502, 503, 504],
    };
    return payloads.map((pl, i) => {
      const tokens = {
        case_key: `pbssr${i}`, run_id: ctx?.runId ?? "norun",
        ts: String(Math.floor(Date.now() / 1000)),
      };
      const tpl = JSON.parse(JSON.stringify(c.bodyTemplate)) as Record<string, unknown>;
      tpl.text = `BOT-PROBE ${pl}`;
      const body = JSON.stringify(tpl);
      return {
        method: "POST", path: ep.path,
        headers: { "content-type": "application/json" }, body, expect,
        note: `xss ${pl.slice(0, 30)} → ssr`,
        flow: {
          steps: [
            { method: "POST", path: ep.path,
              headers: { "content-type": "application/json", "idempotency-key": `pbssr-${tokens.case_key}-${tokens.run_id}` },
              body, note: "submit xss" },
            { method: "GET", path: c.ssrPath!.replace("{id}", `{step1.${c.idField}}`), note: "ssr read",
              headers: { "x-admin-key": process.env.ADMIN_API_KEY! },
              // 301 = step1 не создал строку (429/4xx) → шаблон пуст →
              // /admin/interactions/ → trailing-slash canonicalization.
              expect: { statusIn: [200, 301, 400, 401, 404, 429], statusNotIn: [500, 502, 503, 504] } },
          ],
          assert: obs => {
            const problems: string[] = [];
            const page = obs[1];
            if (!page || page.status !== 200) return problems;
            if (page.bodySnippet.includes(pl) && pl.includes("<")) {
              problems.push(`SSR отразил сырой payload: ${pl.slice(0, 40)}`);
            }
            return problems;
          },
        },
      };
    });
  },
};
export default scenario;
