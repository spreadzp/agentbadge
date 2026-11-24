/**
 * knowledge-sod-negative (SLICE-264-15): separation-of-duties — обе
 * половины правила на ОДНОМ item'е за один flow:
 *   1) verify-attempt submitter'ом (probe_a submit → probe_a verify)
 *      → 403 {error.code:"SEPARATION_OF_DUTIES", detail:"actor"}
 *   2) после легального verify (probe_b) publish-attempt тем же
 *      probe_b (publisher = verifier) → 403 SEPARATION_OF_DUTIES
 *
 * Спека пишет «/409» — impl отдаёт 403 (route мапит SoD в 403-класс
 * вместе с ACTOR_NOT_OPERATOR; см. admin-knowledge-api-mutations.ts).
 * Expect строго на 403 + assert на error.code — ослабленный SoD
 * (самопроверка/самопаблиш пропущены) краснеет в обеих точках:
 * verify-self → 200 вместо 403, а publish-after-self-verify уйдёт
 * с пути publisher=verifier → тоже не 403.
 *
 * Требует PROBE_KEY_A/B в env (service creds, capability
 * probe+workflow). Мутирует — только local/dev; при регрессии SoD
 * шаг реально промоутит item (сигнал остаётся отчётным, не silent).
 */
import { contractBody, caseToken } from "../src/scenarios";
import type { Scenario } from "../src/types";
import { getPath } from "../src/verify";

const scenario: Scenario = {
  name: "knowledge-sod-negative",
  layer: "contract",
  mutating: true,
  applies: ep =>
    ep.method === "POST" &&
    !!ep.contract?.bodyTemplate &&
    ep.contract.idField === "item.id" &&
    !!(process.env.PROBE_KEY_A && process.env.PROBE_KEY_B),
  variants: (ep, ctx) => {
    const c = ep.contract!;
    const tok = caseToken(ep, "knowledge-sod-negative", "264-15");
    const body = contractBody(ep, "knowledge-sod-negative", ctx, "264-15")!;
    const credH = (key: string, idem: string) => ({
      "content-type": "application/json",
      "x-admin-key": key,
      "idempotency-key": `probe-${tok}-sod-${idem}`,
    });
    const aH = (idem: string) => credH(process.env.PROBE_KEY_A!, idem);
    const bH = (idem: string) => credH(process.env.PROBE_KEY_B!, idem);
    const base = `/admin/api/knowledge/items/{step1.${c.idField}}/transition`;
    const to = (status: string, h: typeof aH, idem: string,
      extra?: Record<string, unknown>) => ({
      method: "POST",
      path: base,
      headers: h(idem),
      body: JSON.stringify({ to: status, ...extra }),
      note: `→ ${status}`,
    });
    // statusIn включает 409 для requeue-устойчивости: cacheErrors:false
    // — отказные ответы не кэшируются, повторный кейс исполняет шаг на
    // item'е, который уже VERIFIED → INVALID_TRANSITION (409) легитимен.
    // Строгость первого прогона держит assert: на fresh-run (create без
    // duplicate:true) SoD-точки обязаны быть ровно 403+SoD-код.
    const sodStep = (status: string, h: typeof aH, idem: string,
      note: string, extra?: Record<string, unknown>) => ({
      ...to(status, h, idem, extra),
      note,
      expect: { statusIn: [403, 409], statusNotIn: [500, 502, 503, 504] },
    });
    // Arc R3 M-11 pins: VERIFIED/PUBLISHED требуют expectedVersionId
    // (+expectedEvidence для VERIFIED) — без них легальный verify(b)
    // на step5 отказал бы precondition_required (400), item остался
    // бы PENDING и publish-шаг ушёл бы в 409 не по SoD. На самих
    // SoD-шагах pins — для in-lock атрибуции, если lib fast-path
    // (SoD до store-вызова) обойдён; сегодня fast-path отдаёт 403
    // и без pins.
    const verifyPins = {
      expectedVersionId: "{step1.version.id}",
      expectedEvidence: "{step2.evidence.id}",
    };
    const publishPins = { expectedVersionId: "{step1.version.id}" };
    return [{
      method: "POST", path: ep.path, headers: aH("create"), body,
      expect: {
        statusIn: [200, 201, 202, 400, 401, 402, 403, 404, 409, 422, 429],
        statusNotIn: [500, 502, 503, 504],
      },
      note: "create→evidence→PENDING→verify-self 403→verify(b)→publish-self 403",
      flow: {
        steps: [
          { method: "POST", path: ep.path, headers: aH("c1"), body,
            note: "create (a)" },
          {
            method: "POST",
            path: `/admin/api/knowledge/versions/{step1.version.id}/evidence`,
            headers: aH("ev"),
            body: JSON.stringify({
              type: "EXTERNAL_URL",
              uri: "https://example.com/probe-sod-evidence",
              label: "probe sod evidence",
            }),
            note: "evidence add (a, DRAFT)",
          },
          { ...to("PENDING", aH, "p1"), note: "→ PENDING (a)" },
          sodStep("VERIFIED", aH, "v1", "verify-self → 403 SoD",
            verifyPins),
          { ...to("VERIFIED", bH, "v2", verifyPins),
            note: "→ VERIFIED (b, legal)" },
          sodStep("PUBLISHED", bH, "p2", "publish-by-verifier → 403 SoD",
            publishPins),
        ],
        assert: obs => {
          const problems: string[] = [];
          // Requeue: create реплеится duplicate:true — цепочка
          // already-run, свежих SoD-отказов нет → assert'ы скипаем
          // (idiom knowledge-lifecycle's alreadyLifecycled).
          if (getPath(obs[0]?.bodyJson, "duplicate") === true) {
            return problems;
          }
          for (const [i, label] of [[3, "verify-self"], [5, "publish-by-verifier"]] as const) {
            if (obs[i]?.status !== 403) {
              problems.push(`${label}: expected 403 SoD, got ${obs[i]?.status}`);
              continue;
            }
            const code = getPath(obs[i]?.bodyJson, "error.code");
            if (code !== "SEPARATION_OF_DUTIES") {
              problems.push(`${label}: 403 but error.code=${JSON.stringify(code)}`);
            }
          }
          return problems;
        },
      },
    }];
  },
};
export default scenario;
