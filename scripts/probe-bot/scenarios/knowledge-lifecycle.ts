/**
 * knowledge-lifecycle (SLICE-234-40 / EPIC-229): полный цикл
 * knowledge item — create (DRAFT) → PENDING → VERIFIED → PUBLISHED →
 * search-visible → WITHDRAWN → search-invisible → терминал (409).
 * Плюс idempotent-replay на create (duplicate:true, item.id равен).
 *
 * Требует ADMIN_API_KEY в env (секрет только из .env). Атрибуция:
 * x-operator-id = probe-<case> (Arc R1 H2: строгий allowlist
 * [a-z0-9._@-] + agent-shape denylist — uppercase и bot-* формы
 * больше не проходят). Separation of duties:
 * submit/publish — probe-<case>, verify — probe-<case>-v;
 * VERIFIED требует evidence → шаг evidence-add перед верификацией.
 * Применяется к POST /admin/api/knowledge/items (contract.bodyTemplate +
 * contract.idField="item.id"). Мутирует — только local/dev,
 * на проде создаёт реальные строки (human-queue).
 */
import { contractBody, caseToken } from "../src/scenarios";
import type { Scenario } from "../src/types";
import { getPath } from "../src/verify";

const scenario: Scenario = {
  name: "knowledge-lifecycle",
  layer: "contract",
  dbVerify: true,
  mutating: true,
  applies: ep =>
    ep.method === "POST" &&
    !!ep.contract?.bodyTemplate &&
    ep.contract.idField === "item.id" &&
    !!process.env.ADMIN_API_KEY,
  variants: (ep, ctx) => {
    const c = ep.contract!;
    const tok = caseToken(ep, "knowledge-lifecycle");
    const adminKey = process.env.ADMIN_API_KEY!;
    const body = contractBody(ep, "knowledge-lifecycle", ctx)!;
    const submitH = {
      "content-type": "application/json",
      "x-admin-key": adminKey,
      "x-operator-id": `probe-${tok}`,
      "idempotency-key": `probe-${tok}`,
    };
    const adminH = (idem: string) => ({
      "content-type": "application/json",
      "x-admin-key": adminKey,
      "x-operator-id": `probe-${tok}`,
      "idempotency-key": `probe-${tok}-${idem}`,
    });
    // Arc R1: verify идёт ДРУГИМ оператором (separation of duties —
    // publisher ≠ verifier), и нужен evidence-шаг (гейт на ≥1
    // evidence). Arc R2 H-2: evidence замораживается на PENDING —
    // шаг до сабмита, пока DRAFT.
    const verifyH = (idem: string) => ({
      "content-type": "application/json",
      "x-admin-key": adminKey,
      "x-operator-id": `probe-${tok}-v`,
      "idempotency-key": `probe-${tok}-${idem}`,
    });
    const expect = {
      statusIn: [200, 201, 202, 400, 401, 402, 403, 404, 409, 422, 429],
      statusNotIn: [500, 502, 503, 504],
    };
    const adminBase = `/admin/api/knowledge/items/{step1.${c.idField}}/transition`;
    const to = (status: string, n: number) => ({
      method: "POST",
      path: adminBase,
      headers: adminH(`t${n}`),
      body: JSON.stringify({ to: status }),
      note: `→ ${status}`,
    });
    const verify = (n: number) => ({
      method: "POST",
      path: adminBase,
      headers: verifyH(`v${n}`),
      body: JSON.stringify({ to: "VERIFIED" }),
      note: "→ VERIFIED (op2)",
    });
    const evidenceStep = {
      method: "POST",
      path: `/admin/api/knowledge/versions/{step1.version.id}/evidence`,
      headers: adminH("ev"),
      body: JSON.stringify({
        type: "EXTERNAL_URL",
        uri: "https://example.com/probe-evidence",
        label: "probe evidence",
      }),
      note: "evidence add",
    };
    // slug = "{case_key}" = "pb<hash>" — ОДИН numword-токен: PG-парсер
    // держит hyphenated-строку как цельный лексем в запросе, а
    // 'bot-probe-pb…' как токен в документе отсутствует → q=slug
    // промахивался бы мимо title. Недефисный slug = стабильный поиск.
    const searchPath = "/api/v1/agent/knowledge/search?q={step1.item.slug}";
    return [{
      method: "POST", path: ep.path, headers: submitH, body, expect,
      note: "create→replay→draft-invis→chain→publish-visible→withdraw→terminal",
      flow: {
        steps: [
          { method: "POST", path: ep.path, headers: submitH, body, note: "create" },
          { method: "POST", path: ep.path, headers: submitH, body, note: "create replay" },
          { method: "GET", path: searchPath, note: "draft invisible" },
          // Arc R2 H-2: evidence freezes at PENDING — attach while DRAFT.
          evidenceStep, to("PENDING", 1), verify(2), to("PUBLISHED", 3),
          { method: "GET", path: searchPath, note: "published visible" },
          to("WITHDRAWN", 4),
          { method: "GET", path: searchPath, note: "withdrawn invisible" },
          { ...to("PUBLISHED", 5), note: "terminal 409",
            expect: { statusIn: [409], statusNotIn: [500, 502, 503, 504] } },
        ],
        assert: obs => {
          const problems: string[] = [];
          // obs: 0 create, 1 replay, 2 draftS, 3 evidence, 4 PENDING,
          //      5 VERIFIED, 6 PUBLISHED, 7 pubS, 8 WITHDRAWN, 9 withS
          const [create, replay, draftS, , pend, , , pubS, , withS] = obs;
          const itemId = getPath(create?.bodyJson, "item.id");
          if (!itemId) return problems;
          // Идемпотентный rerun: slug/key детерминированы — requeue'нутый
          // кейс реплеит создание (step1 несёт duplicate:true) и все
          // transition-ключи тоже реплеятся (stored 200), значит
          // «PENDING:200» может быть фантомом. Настоящий сигнал rerun'а —
          // duplicate на самом create. Это честное «уже пройдено» —
          // visibility-asserts скипаем (их закрывает первый прогон кейса).
          const alreadyLifecycled = pend?.status === 409 ||
            getPath(create?.bodyJson, "duplicate") === true;
          // replay: duplicate:true + тот же item.id
          if (replay && replay.status != null && replay.status < 300) {
            if (getPath(replay.bodyJson, "duplicate") !== true) {
              problems.push("replay lacks duplicate:true");
            }
            const r2id = getPath(replay.bodyJson, "item.id");
            if (r2id !== itemId) {
              problems.push(`invariant item.id: ${JSON.stringify(r2id)} ≠ ${JSON.stringify(itemId)}`);
            }
          }
          const contains = (o: typeof obs[number] | undefined) => {
            const rs = getPath(o?.bodyJson, "results");
            return Array.isArray(rs) &&
              rs.some(r => getPath(r, "itemId") === itemId);
          };
          if (draftS?.status === 200 && contains(draftS)) {
            problems.push("DRAFT item visible in agent search (projection leak)");
          }
          if (!alreadyLifecycled) {
            if (pubS?.status === 200 && !contains(pubS)) {
              problems.push("PUBLISHED item NOT visible in agent search");
            }
            if (withS?.status === 200 && contains(withS)) {
              problems.push("WITHDRAWN item still visible in agent search");
            }
          }
          return problems;
        },
      },
    }];
  },
};
export default scenario;
