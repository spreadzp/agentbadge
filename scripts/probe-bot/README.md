# probe-bot — локальный пробо-раннер с DB-верификацией

SLICE-234-38 (грилл D-234-38-Q1..Q17). Формализует ad-hoc цикл
«hermes прогон → fix за 40 мин» в постоянный инструмент: бот долбит
endpoints по сценариям, запоминает покрытые кейсы в SQLite и сверяет
ответы сервера прямо по таблице `event` — не по Telegram-репортам.

## Три интерфейса

| Интерфейс | Где | Для кого |
|---|---|---|
| CLI `bun run probe …` | `hackathon/server/` | руки, агенты, тесты |
| Панель `/probe` | `http://127.0.0.1:48787/probe` | человек, кнопки + живой лог |
| Мост `TYPE: probe` | `scripts/devin-bridge/watcher.ts` | облачные сессии / слайсы |

Все три сидят на одном движке (`src/runner.ts`) и одном state
(`probe-state.db`, per-machine — в git не коммитится).

## Браузерные эндпоинты панели

Панель — `devin-bots-panel` (`scripts/devin-bridge/panel.ts`, слушает
только `127.0.0.1:48787`):

| URL | Что показывает |
|---|---|
| `GET /probe` | Страница probe-bot: кнопки прогонов, фильтры, таблица кейсов с пагинацией, джобы и лог |
| `GET /probe/endpoints` | Агрегат по endpoint'ам: последний статус (5xx/4xx цветом), худший вердикт, число кейсов — problem-first |
| `GET /probe/cases?verdict=&scenario=&target=&q=&page=` | HTMX-фрагмент таблицы (фильтры + пагинация 50/стр, автообновление 10s сохраняет фильтры) |
| `GET /probe/endpoints/rows?target=&cls=&q=` | HTMX-фрагмент endpoints-таблицы (cls: `5xx`/`4xx`/`2xx`/`none`) |
| `GET /api/probe/cases` | JSON `{counts, total, cases[]}` — те же фильтры + `per` |
| `GET /api/probe/endpoints` | JSON-агрегат по endpoint'ам (last_status, verdict, n, fails) |
| `GET /` | Главная панель ботов (не probe-специфично) |
| `GET /jobs` | HTMX-фрагмент списка джоб |
| `GET /jobs/<id>/log` | Лог конкретной джобы |
| `POST /probe/run` | Кнопки: `contract` / `security` / `new` / `suspect` / `dry` / `sync` |
| `POST /probe/requeue` | `case_key` — вернуть кейс в очередь (фильтры сохраняются) |

Прогоны из панели спавнят **локальный `bun`**, не `devin -p`
(облачная сессия не нужна и не тратится).

## CLI

Запуск из `hackathon/server/`:

```bash
bun run probe scenarios ls                    # список сценариев
bun run probe inventory sync                  # собрать инвентарь (openapi+x402+code+registry)
bun run probe inventory ls                    # посмотреть инвентарь
bun run probe run --endpoints '/api/foo*' \
    --scenarios 'nul-control,bigint-id' \
    --dbVerify --max-requests 20              # прогон
bun run probe run --dry ...                   # план без сети
bun run probe status                          # counts + открытые кейсы
bun run probe report                          # последний md-отчёт
bun run probe requeue '/api/attestcoin/tasks%'  # requeue по LIKE-глобу
bun run probe run --force ...                 # игнорировать pass-дедуп
```

Прогон печатает `PASS|FAIL|SUSPECT|INCONCLUSIVE|SKIP` по каждому
кейсу, в конце — путь к md-отчёту. С `--json` оборачивает финальный
вердикт в `PROBE-JSON-BEGIN/END` (для моста).

## State: `probe-state.db` (bun:sqlite)

- `probe_case` — ключ `(locus, target, endpoint, method, scenario,
  variant)`; вердикт, статус, requestId, note, timestamps.
  - `locus` — метка машины (`PROBE_LOCUS`, дефолт `local`).
  - `target` — origin сервера: `https://agentbadge.xyz` и
    `http://localhost:4021` — **разные кейсы**, pass на одном не
    дедупит другой.
- `probe_endpoint` — инвентарь роутов с источником
  (`openapi|x402|code|manual`).
- `probe_run` — история прогонов (id, target, locus, counts, report_path).
- **Дедупликация**: `pass`-кейсы не перепрогоняются. `new` / `fail` /
  `suspect` / `inconclusive` остаются в очереди. `requeue` и `--force`
  возвращают pass-кейсы в игру. Стабы пишутся только для кейсов,
  реально идущих в огонь — dry-run и усечённый бюджет state не пачкают.
- В БД прода ничего не пишется. Телеметрия наших же хитов — только
  чтение.

### Прямой доступ агента (sqlite3, read-only)

```bash
DB=scripts/probe-bot/probe-state.db   # из hackathon/server/

sqlite3 $DB "SELECT verdict,COUNT(*) FROM probe_case GROUP BY 1;"           # сводка
sqlite3 $DB "SELECT endpoint,scenario,last_status,note FROM probe_case
             WHERE verdict IN ('fail','suspect','inconclusive');"           # находки
sqlite3 $DB "SELECT * FROM probe_run ORDER BY started DESC LIMIT 5;"        # история прогонов
sqlite3 $DB "SELECT DISTINCT target FROM probe_case;"                       # какие target'ы покрыты
sqlite3 $DB "SELECT endpoint,request_id FROM probe_case WHERE verdict='fail';" # requestId → добить в event
```

Это «реальность» бота для агента: не верить консоли — читать таблицы.

## Target: local ↔ prod

`--target` принимает URL **или алиас** (`normalizeTarget`):

| Алиас | Разворачивается в |
|---|---|
| `prod` | `https://agentbadge.xyz` |
| `local`, `dev` | `http://localhost:$PROBE_LOCAL_PORT ‖ $PORT ‖ 4021` |

Также `PROBE_TARGET` — дефолт для всех команд. Типовой цикл фичи:

```bash
bun run dev &                                     # dev-сервер :4021
bun run probe run --target local --endpoints '/api/foo*' --max-requests 20
# → фиксим код → requeue + повтор:
bun run probe requeue '/api/foo%'
bun run probe run --target local --endpoints '/api/foo*' --max-requests 20
# → после деплоя та же команда с --target prod (dbVerify → fly proxy)
```

`dbVerify` на `local` сверяет по той БД, куда пишет dev-сервер
(`.env` → `DATABASE_URL`), на `prod` — через `logs-cli.sh proxy up`.

### `probe diff` — сверка ответов между окружениями

Один кейс хранится на target отдельно → можно сравнить «локально vs
прод» одной командой. `≠` — расхождение (вердикт или статус разошлись):
типичный кейс «у меня 400, на проде 500».

## Верификация: ответ + серверная телеметрия

Каждый хит несёт `User-Agent: AgentBadge-ProbeBot/0.1` и
`x-probe-case: <case_key>` — свой трафик отличим в репортах.

1. **HTTP-assert (всегда)** — статус входит в `expect.status_in` /
   не входит в `status_not_in`, тело не содержит `body_not_includes`
   (например `rpc.`, `blockdaemon`, `stack`).
2. **dbVerify (per-scenario/order)** — `X-Request-Id` из ответа ищется
   в `event.payload->>'requestId'` через `getDatabase().events.list`
   с поллингом (~10s — INSERT файер-энд-форгет). Нет события →
   `inconclusive`, не `fail` — телеметрия могла не долететь.
   Требует `DATABASE_URL` (прокси: `scripts/logs-cli.sh proxy up`).

## Сценарии (`scenarios/`)

Новая уязвимость = новый файл, раннер не трогаем.

- **YAML** (`*.yaml`) — декларативно: `layer`, `apply.methods`,
  шаблон мутаций пути/тела, `expect.*`, `dbVerify`, `mutating`.
  Пример: `contract-basic.yaml` — «GET/POST/… отвечает не-5xx и без
  утечек в теле».
- **TS** (`*.ts`) — многошаговые/stateful потоки (`burst-429`,
  `replay-idem`): экспортируют генератор кейсов.

Сиды: `contract-basic`, `nul-control`, `bigint-id`, `unicode-id`,
`traversal`, `sqli`, `malformed-body`, `method-fuzz`, `forged-events`,
`headers-audit`, `burst-429`, `replay-idem`, `fts-injection`
(tsquery-операторы в `?q=` — шаблон `query-variants`),
`no-store-audit` (assert `cache-control: no-store` на response
headers — урок B-1), `auth-negative` (мусорный Bearer → typed 401/403,
на POST-ручках безопасно — отбивается в auth-слое до записи).

Шаблоны YAML: `param-variants` (сегменты пути), `query-variants`
(`params.param` + `params.values` → `?param=<enc>`), `path-feed`
(абсолютные пути из `values_file` — endpoint-discovery), `method-fuzz`,
`malformed-body`, `header-fuzz`, `auth-negative`, `contract-basic`.
`expect` поддерживает `status_in`, `status_not_in`, `body_not_includes`
(строки или `re:<regex>`), `headers` (header → substring,
case-insensitive), `json.*` (см. ниже).

## Семантический слой (SLICE-234-40)

Три дополнения поверх статус/header-asserts: **json-asserts**,
**contract-блоки**, **stateful flow**.

### `expect.json` — asserts по JSON-телу

```yaml
expect:
  status_in: [200, 201, 202]
  json:
    present: [requestId, sessionId]      # пути обязаны существовать
    absent: [internal, prisma, context.text]  # denylist (projection-leak)
    equals: { status: PENDING_REVIEW }   # точные значения
    regex: { requestId: "^rq_" }         # regex на String(value)
    schema_ref: "#/components/schemas/InteractionAccepted"  # опц.
```

Пути — dot-notation (`a.b`, `a[0].c`, `$.a`). `schema_ref` резолвится
против `/openapi.json` таргета (required + shallow types); недоступная
схема — мягкий скип.

### `contract:` в `registry.yaml`

Контракт мёржится на любой endpoint с тем же `method+path` (openapi/
code-scan получают семантику из реестра автоматически):

```yaml
- path: /api/v1/agent/interaction
  method: POST
  contract:
    bodyTemplate: {text: "BOT-PROBE {case_key}", context: {sessionId: "s-{case_key}"}}
    idempotencyField: "header:idempotency-key"   # или имя поля тела
    replayInvariant: [requestId, sessionId]      # равны R1==R2 на реплее
    replayExpect: {duplicate: true}              # json.equals на ответе реплея
    readPathField: statusUrl                     # откуда читать проекцию
    idField: requestId                           # поле с id ресурса
    ssrPath: "/admin/interactions/{id}"          # для xss-ssr
    projectionDenylist: [context.text, fingerprint]
    lifecycleAdmin: /api/admin/interactions      # для lifecycle-сценариев
    terminalStates: [ANSWERED, REJECTED]
    identities: [agent, operator]                # bola-idor (env PROBE_ID_*)
    freeAction: {method: POST, path: "/x/{id}/withdraw"}  # use-after-free
```

Токены в `bodyTemplate`: `{case_key}` (стабильный per-case —
идемпотентность-дружественный), `{run_id}`, `{ts}`. Если объявлен
`idempotencyField: header:X` — заголовок `X: BOT-PROBE-<caseToken>`
пришивается ко всем contract-сабмитам (иначе guard отобьёт до схемы).

Contract-aware шаблоны: `contract-submit`, `negative-contract`
(per-field мутации → 4xx), `ignored-auth` (forged creds),
`mass-assignment` (admin/role/`__proto__` поля), `ssrf-guard`
(url_field → 169.254.169.254), `origin-guard` (Origin: evil),
`unsupported-method` (WebDAV feed), `deprecation-pair`.

### Stateful flow (`Variant.flow`)

TS-сценарий возвращает вариант с `flow.steps[]`; раннер исполняет
шаги последовательно в рамках ОДНОГО кейса:

- `path`/`headers`/`body` шага поддерживают `{stepN.<json-path>}` —
  значение из тела ответа шага N (1-based);
- per-step `expect` (иначе `expect` варианта); шаг-фейл обрывает флоу;
- `flow.assert(obs[])` — cross-step проверки → список проблем.

Сценарии: `replay-idem-v2` (submit+replay одним ключом → инварианты),
`projection-leak` (submit → GET проекции → denylist absent),
`session-grouping`, `xss-ssr` (payload → SSR → escape-проверка),
`use-after-free` (create → freeAction → GET → 404), `bola-idor`
(чужой id → 401/403/404; env `PROBE_ID_<NAME>`),
`interaction-lifecycle`, `terminal-replay` (терминал + transition → 409).

Идентичности/секреты — только env (`ADMIN_API_KEY`, `PROBE_ID_*`);
без env сценарий не применяется (`applies → false`), секретов в
orders/reports нет. Атрибуция: `x-operator-id: BOT-PROBE-<case>`.

### Payload-фиды (`payloads/`)

`values_file`/`methods_file`/`bodies_file` в params — вендорные списки
(строки, `#` — комментарий): `nul-variants`, `sqli-generic`,
`traversal-lfi`, `xss-basic`, `ssti-special-vars`,
`http-methods-webdav`, `error-regex` (`re:`-паттерны для
body_not_includes), `hidden-paths` (endpoint-discovery, cap 150).

## Safety-рельсы (src/safety.ts)

- `target` обязан быть в allowlist хостов
  (`agentbadge.xyz`, localhost, staging…).
- `mutating: true` сценарии — только по явному флагу.
- `--max-requests` обязателен (дефолт бюджета в заказах — 200).
- Abort по серии подряд идущих 5xx — отчёт всё равно пишется.
- `--dry-run` печатает план без единого запроса.
- Никогда не шлём валидные платёжные подписи; опасные ручки
  (`/admin/*`, settlement, `indexer/run`) — через allowlist-исключения.

## Отчёты

- `docs/LOGS/Analisis/probe-runs/probe-report-<ts>-<runId>.md` —
  человеку: counts по вердиктам, матрица, fail/suspect-строки с
  requestId и `event ✓/✗`.
- `PROBE-JSON` — машине: `{runId, target, locus, counts, suspects[],
  reportPath}`.

## Заказы из чатов (мост, TYPE: probe)

Облачная Devin-сессия пишет `~/local-queries/<id>.req`:

```
LOCAL-QUERY
TYPE: probe
ARG: {"target":"https://agentbadge.xyz","endpoints":["/api/attestcoin/tasks*"],"scenarios":["bigint-id"],"dbVerify":true,"maxRequests":20}
NEED: verdict
QID: <uuid>
```

`ARG` — однострочный JSON (JSON ⊆ YAML, валидатор общий) или
workspace-путь к `probe-order.yaml` внутри `allowRead`
(`docs/**` и др. — см. `probe-order.example.yaml`).

Watcher решает по safety-lint'у (`lintOrder`):
- чисто (host ∈ `probeAllowedHosts`, `maxRequests ≤ 200`,
  без mutating) → авто-исполнение `bun run probe run --order-b64 …`;
- нарушение → human-queue, отвечает человек.

Ответ в сессию: `LOCAL-ANSWER` с компактным JSON-вердиктом
(`counts`, suspects с requestId, `reportPath`) — слайс/сессия
обрабатывает машиночитаемо; md-отчёт рядом для человека.
Невалидный заказ → `PROBE-ORDER-INVALID: <schema error>`.

Слайс может буквально содержать готовый order-блок — имплементор
копирует его в `.req` и получает результаты обратно в сессию.
Workflow: `.windsurf/workflows/probe-bot.md`.
