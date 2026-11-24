/**
 * operator-auth-negative (SLICE-264-15): battery на operatorAuth —
 * каждый кейс отдельным вариантом (свой verdict в отчёте):
 *
 *   unknown-key      opk_<invalid>                 → 401
 *   revoked          cred с status=revoked          → 401
 *   disabled-op      cred активного вида, но op
 *                    status=disabled               → 401
 *   insufficient-cap service cred без `workflow`
 *                    на mutating route             → 403
 *   x-operator-id    валидный cred + мёртвый
 *                    заголовок                     → 400
 *   legacy-admin-key ADMIN_API_KEY при закрытом
 *                    break-glass окне               → 401
 *
 * Каждый вариант шлёт ВАЛИДНОЕ contract-тело + idempotency-key:
 * отказ живёт в auth-слое до парсинга/записи, а если auth
 * регрессирует (bad cred пропущен) — запись проходит и кейс
 * краснеет по реальному следу, не по косвенному признаку.
 * mutating: отказоустойчивые кейсы мутируют ТОЛЬКО при сломе auth.
 *
 * Env: PROBE_KEY_A (valid), PROBE_KEY_NOFLOW (probe-only cap),
 * PROBE_KEY_REVOKED, PROBE_KEY_DISABLED; ADMIN_API_KEY — для
 * legacy-кейса (если не задан — кейс просто не собирается).
 * Внимание: заведённый ADMIN_BREAK_GLASS_ENABLED делает legacy
 * окно открытым → break-glass кейс покраснеет — это честный
 * сигнал об открытом окне, не флаки.
 */
import { contractBody, caseToken } from "../src/scenarios";
import type { Scenario, Variant } from "../src/types";

const INVALID_KEY = "opk_probeInvalidUnknown0000000000000000000000";

const scenario: Scenario = {
  name: "operator-auth-negative",
  layer: "security",
  mutating: true,
  applies: ep =>
    ep.method === "POST" &&
    !!ep.contract?.bodyTemplate &&
    ep.contract.idField === "item.id" &&
    !!(process.env.PROBE_KEY_A && process.env.PROBE_KEY_NOFLOW &&
      process.env.PROBE_KEY_REVOKED && process.env.PROBE_KEY_DISABLED),
  variants: (ep, ctx) => {
    const tok = caseToken(ep, "operator-auth-negative", "264-15");
    const body = contractBody(ep, "operator-auth-negative", ctx, "264-15")!;
    const h = (key: string, idem: string, extra?: Record<string, string>) => ({
      "content-type": "application/json",
      "x-admin-key": key,
      "idempotency-key": `probe-${tok}-${idem}`,
      ...extra,
    });
    const expect = (code: number) => ({
      statusIn: [code],
      statusNotIn: [500, 502, 503, 504],
    });
    const v = (key: string, idem: string, code: number, note: string,
      extra?: Record<string, string>): Variant => ({
      method: "POST", path: ep.path,
      headers: h(key, idem, extra), body,
      expect: expect(code), note,
    });
    const out: Variant[] = [
      v(INVALID_KEY, "unk", 401, "unknown key → 401"),
      v(process.env.PROBE_KEY_REVOKED!, "rev", 401, "revoked cred → 401"),
      v(process.env.PROBE_KEY_DISABLED!, "dis", 401, "disabled operator → 401"),
      v(process.env.PROBE_KEY_NOFLOW!, "cap", 403,
        "probe-only cred on mutating route → 403 insufficient capability"),
      v(process.env.PROBE_KEY_A!, "hdr", 400,
        "x-operator-id under operatorAuth → 400",
        { "x-operator-id": "probe" }),
    ];
    // Legacy-окно: ADMIN_BREAK_GLASS_ENABLED не задан → ADMIN_API_KEY
    // обычный unknown-key → 401. Если флаг включён — кейс сообщит об
    // открытом окне (краснеет осознанно).
    if (process.env.ADMIN_API_KEY) {
      out.push(v(process.env.ADMIN_API_KEY, "leg", 401,
        "legacy ADMIN_API_KEY, break-glass window closed → 401"));
    }
    return out;
  },
};
export default scenario;
