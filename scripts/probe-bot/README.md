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
| `GET /probe` | Страница probe-bot: кнопки прогонов, таблица кейсов, джобы и лог |
| `GET /probe/cases` | HTMX-фрагмент таблицы кейсов (автообновление 10s) |
| `GET /api/probe/cases` | Тот же state в JSON: `{counts, cases[]}` |
| `GET /` | Главная панель ботов (не probe-специфично) |
| `GET /jobs` | HTMX-фрагмент списка джоб |
| `GET /jobs/<id>/log` | Лог конкретной джобы |
| `POST /probe/run` | Кнопки: `contract` / `security` / `new` / `suspect` / `dry` / `sync` |
| `POST /probe/requeue` | `requeue=<glob>` — вернуть кейсы в очередь |

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
(`params.param` + `params.values` → `?param=<enc>`), `method-fuzz`,
`malformed-body`, `header-fuzz`, `auth-negative`, `contract-basic`.
`expect` поддерживает `status_in`, `status_not_in`, `body_not_includes`,
`headers` (header → substring, case-insensitive).

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
