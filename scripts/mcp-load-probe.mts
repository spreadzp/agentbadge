/**
 * mcp-load-probe.mts — локальный нагрузочный зонд для rate-limit слоёв /mcp*.
 *
 * Что измеряет: по каждому запросу — timestamp (ms), latency, HTTP status,
 * X-RateLimit-Limit/Remaining/Reset, Retry-After, error code из body.
 *
 * Сценарии (каждый в изолированной IP-lane через уникальный X-Forwarded-For —
 * вне Fly правый XFF доверенный, см. resolveClientIp):
 *   jsonrpc    — 70× POST /mcp {tools/list}: только abuse-guard base lane.
 *   rest       — 70× POST /mcp/passport/tools/verify_passport: глобальный
 *                limiter + guard base (глобальный стоит раньше в цепочке).
 *   heavy      — 15× POST /mcp/passport/tools/request_passport: heavy-бакет.
 *   heavy-json — 15× tools/call request_passport через /mcp JSON-RPC.
 *   xff-rotate — 70× POST /mcp, каждый запрос новый XFF → новая lane.
 *   badkey     — один запрос с недействительным agb_ ключом (auth-порядок).
 *   all        — все сценарии подряд.
 *
 * Запуск:
 *   bun scripts/mcp-load-probe.mts all
 *   bun scripts/mcp-load-probe.mts rest heavy --base http://localhost:4021
 */

const args = process.argv.slice(2);
const baseFlag = args.indexOf("--base");
const BASE = baseFlag >= 0 ? args[baseFlag + 1] : "http://localhost:4021";
const scenarios = args.filter(
  (a, i) => a !== "--base" && !(baseFlag >= 0 && i === baseFlag + 1),
);
const wanted = scenarios.length ? scenarios : ["all"];

// Уникальный /16 на прогон — окна 60s живут между вызовами, иначе lane
// предыдущего прогона ещё активна и тест стартует уже залимиченным.
const RUN_IP = `10.${40 + (Date.now() % 100)}.${(process.pid % 200) + 1}`;

const ts = () => new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm

interface ProbeResult {
  seq: number;
  status: number;
  ms: number;
  limit: string | null;
  remaining: string | null;
  reset: string | null;
  retryAfter: string | null;
  errCode: string | null;
}

async function probe(
  seq: number,
  url: string,
  init: RequestInit,
): Promise<ProbeResult> {
  const t0 = performance.now();
  const res = await fetch(url, init);
  const ms = Math.round(performance.now() - t0);
  let errCode: string | null = null;
  try {
    const body = (await res.json()) as Record<string, unknown>;
    const err = body.error as Record<string, unknown> | string | undefined;
    if (typeof err === "object" && err) errCode = String(err.code ?? err.message ?? "").slice(0, 40);
    else if (typeof err === "string") errCode = err.slice(0, 40);
    else if (body.isError) errCode = "tool:isError";
  } catch {
    /* non-JSON body */
  }
  return {
    seq,
    status: res.status,
    ms,
    limit: res.headers.get("x-ratelimit-limit"),
    remaining: res.headers.get("x-ratelimit-remaining"),
    reset: res.headers.get("x-ratelimit-reset"),
    retryAfter: res.headers.get("retry-after"),
    errCode,
  };
}

function line(r: ProbeResult): string {
  const rl =
    r.limit !== null
      ? ` limit=${r.limit} rem=${r.remaining ?? "?"} reset=${r.reset ?? "?"}`
      : " no-rl-headers";
  const ra = r.retryAfter ? ` retryAfter=${r.retryAfter}s` : "";
  const ec = r.errCode ? ` err=${r.errCode}` : "";
  return `[${ts()}] #${String(r.seq).padStart(3)} ${r.status} ${r.ms}ms${rl}${ra}${ec}`;
}

function summarize(name: string, results: ProbeResult[]): void {
  const byStatus = new Map<number, number>();
  for (const r of results) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  const first429 = results.find((r) => r.status === 429);
  const dist = [...byStatus.entries()].map(([s, n]) => `${s}×${n}`).join(" ");
  console.log(
    `  ── ${name}: ${results.length} req | ${dist}` +
    (first429
      ? ` | first 429 at #${first429.seq} (limit=${first429.limit}, retryAfter=${first429.retryAfter}s)`
      : " | no 429"),
  );
}

const jsonHeaders = (xff?: string) => ({
  "Content-Type": "application/json",
  ...(xff ? { "X-Forwarded-For": xff } : {}),
});

const rpc = (method: string, params?: unknown) =>
  JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });

async function burst(
  name: string,
  count: number,
  make: (seq: number) => { url: string; init: RequestInit },
): Promise<ProbeResult[]> {
  console.log(`\n▶ ${name} (${count} req)`);
  const results: ProbeResult[] = [];
  for (let i = 1; i <= count; i++) {
    const { url, init } = make(i);
    const r = await probe(i, url, init);
    results.push(r);
    // Печатаем каждый запрос — это зонд, не стресс-тест; 70 строк ок.
    console.log(line(r));
  }
  summarize(name, results);
  return results;
}

// ─── Сценарии ────────────────────────────────────────────────────────────────

/** Guard base lane only: /mcp JSON-RPC не покрыт глобальным limiter'ом. */
const scenarioJsonrpc = (ip: string) =>
  burst("jsonrpc: POST /mcp tools/list ×70 (guard base lane, anon 60/m)", 70, () => ({
    url: `${BASE}/mcp`,
    init: { method: "POST", headers: jsonHeaders(ip), body: rpc("tools/list") },
  }));

/** REST tool path: глобальный limiter (до auth) + guard base — кто раньше? */
const scenarioRest = (ip: string) =>
  burst("rest: POST /mcp/passport/tools/verify_passport ×70 (global+guard)", 70, () => ({
    url: `${BASE}/mcp/passport/tools/verify_passport`,
    init: { method: "POST", headers: jsonHeaders(ip), body: "{}" },
  }));

/** Heavy-бакет через REST: 10/мин на lane. */
const scenarioHeavyRest = (ip: string) =>
  burst("heavy-rest: POST /mcp/passport/tools/request_passport ×15", 15, () => ({
    url: `${BASE}/mcp/passport/tools/request_passport`,
    init: { method: "POST", headers: jsonHeaders(ip), body: "{}" },
  }));

/** Heavy-бакет через JSON-RPC tools/call — другой путь детекции имени. */
const scenarioHeavyJson = (ip: string) =>
  burst("heavy-json: /mcp tools/call request_passport ×15", 15, () => ({
    url: `${BASE}/mcp`,
    init: {
      method: "POST",
      headers: jsonHeaders(ip),
      body: rpc("tools/call", { name: "request_passport", arguments: {} }),
    },
  }));

/** Ротация XFF: каждый запрос — новая ip-lane. Доказывает per-IP изоляцию. */
const scenarioXffRotate = () =>
  burst("xff-rotate: POST /mcp ×70, новый XFF на запрос", 70, (i) => ({
    url: `${BASE}/mcp`,
    init: {
      method: "POST",
      headers: jsonHeaders(`10.99.${Math.floor(i / 256)}.${i % 256}`),
      body: rpc("tools/list"),
    },
  }));

/** Порядок auth vs rate-limit: битый agb_ → 401 до или после лимитов? */
async function scenarioBadkey() {
  console.log("\n▶ badkey: невалидный agb_ bearer (agent_key_invalid?)");
  const r = await probe(1, `${BASE}/mcp`, {
    method: "POST",
    headers: { ...jsonHeaders("10.98.0.1"), Authorization: "Bearer agb_deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" },
    body: rpc("tools/list"),
  });
  console.log(line(r));
  summarize("badkey", [r]);
}

const ALL: Record<string, (ip: string) => Promise<unknown>> = {
  jsonrpc: scenarioJsonrpc,
  rest: scenarioRest,
  heavy: scenarioHeavyRest,
  "heavy-json": scenarioHeavyJson,
  "xff-rotate": () => scenarioXffRotate(),
  badkey: () => scenarioBadkey(),
};

console.log(`mcp-load-probe → ${BASE}`);
console.log(`scenarios: ${wanted.join(", ")} | start ${new Date().toISOString()}`);

// Уникальный IP на сценарий внутри прогона — lane изоляция без ожидания окна.
let ipOctet = 10;
for (const name of wanted) {
  const list = name === "all" ? Object.keys(ALL) : [name];
  for (const sc of list) {
    const fn = ALL[sc];
    if (!fn) {
      console.log(`unknown scenario: ${sc} (have: ${Object.keys(ALL).join(", ")})`);
      continue;
    }
    await fn(`${RUN_IP}.${ipOctet++}`);
  }
}

console.log(`\ndone ${new Date().toISOString()}`);
