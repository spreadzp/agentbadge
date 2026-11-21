# EPIC-229 — Prod verification (agentbadge.xyz)

Дата: 2026-11-21. Prod: `agent-passport-hedera` @ fly.io.

## Deploy

- Deploy 1: `fly deploy` GIT_COMMIT `62c8985a` (229-1..229-11 + openapi regen).
  release_command применил миграцию `20261120T1945_knowledge_engine` —
  **27 операций, 8 таблиц + GIN FTS-индекс** на прод Postgres (лог релиз-
  машины: `Applied 1 migration(s) (27 operation(s))`, marker
  `1931ea48…`).
- Deploy 2 (фикс): GIT_COMMIT `22d5c3ef` — включает `6fc16185`
  `fix(229-12)`. `/health`: version 0.16.0, gitCommit 22d5c3ef, db:up.
- Capability seed: `fly ssh … bun scripts/knowledge-capability-seed.ts`
  → 256 capabilities (все verified): check 156 / mcp 78 / manifest 14 /
  x402-pack 8.

## Прогон 1 — hermes verify (пакет `verify-packet-229-prod.txt`)

- Bot: `BOT-TEST-vz229a`, модель deepseek-v4-pro.
- Лог: `evidence/hermes-verify-229-prod.log`, usage:
  `evidence/hermes-usage-229-prod.json` — **7 256 795 tokens,
  ~$0.48**, 82 api_calls.
- Вердикт: **PARTIAL** — все функциональные шаги A–I + [K] toolkit
  зелёные (projection-leak airtight, engine:"FTS", no-store, rate
  limit 10rpm, XSS-escape, workflow end-to-end, gap dedupe).
- **BUG-1 (High)**: NUL/C0 на READ-path → unauthenticated 500 —
  `?q=ab%00cd`, `/items/%00`, `/versions/%00/evidence`,
  `?uri=%00`. Twin r1-M-1: write-body была покрыта, params/query — нет.

## Фикс — `6fc16185`

`noControlChars` экспортирован из types.ts; `rejectCtrl()` —
на всех param/query sinks (admin API :id/:vid/:gapId, `?uri`,
agent `?q`/`?capability`, SSR UI mutations + operator-поле);
zod `.refine` на id-ish body-полях и `reason`/`query`/`name`/
`description`; `x-operator-id` header тоже guard'ится.
Регрессии: 5 новых тестов (knowledge-audit-fixes + search), весь
knowledge suite 65 тестов зелёный.

Спот-проверка на проде после деплоя (свой curl, не бот):

```
GET /api/v1/agent/knowledge/search?q=ab%00cd      → 400 (было 500)
GET /admin/api/knowledge/items/%00                → 400
GET /admin/api/knowledge/versions/%00/evidence    → 400
GET /admin/api/knowledge/evidence/citing?uri=%00  → 400
GET /api/v1/agent/knowledge/search?q=escrow&capability=cap%00x → 400
```

## Прогон 2 — probe-bot deterministic prod pass (SLICE-229-12 §3)

Тот же набор, что local, retarget `prod` + `dbVerify` (event-таблица
через `logs-cli.sh proxy up`).

Итог по knowledge-кейсам на `https://agentbadge.xyz`:

| verdict | count |
|---|---|
| pass | 142 |
| suspect | 2 |
| fail | 0 |

Сценарии на проде:
- `auth-negative` — 33 endpoints × мусорный Bearer → 401 typed.
- `contract-basic` — все поверхности, статусы в контракте.
- `fts-injection` (query-variants на `?q=`) — tsquery-операторы,
  **`?q=%00` → 400**, unicode, длинный запрос → typed, ноль 5xx.
- `nul-control`/`sqli`/`unicode-id` — path-варианты → 404/400.
- `method-fuzz` — PUT/DELETE/PATCH/OPTIONS/HEAD → 404/204/401.
- `headers-audit` + `no-store-audit` — `cache-control: no-store`
  на всех GET (включая 401 — middleware до auth-отказа). B-1 урок
  закрыт детерминированно.

2 suspect: `?q=ключ🔥` и `?q=\u202eadmin` — `status changed 200→429`
(первый прогон 200, второй уперся в anon-бакет 10rpm — rate limiter
работает как задумано, не регрессия; оба кейса дали 200 в первом
прогоне).

`probe diff` local↔prod: все сопоставимые knowledge-кейсы `=`.
Расхождения вне 229 (`/api/requests`, `/admin/interactions`) — след
от мёртвой БД на локальном :4021 (docker PG conn упала — `Sql-
ConnectionError`), после перезапуска dev-сервера с живой
`DATABASE_URL=:5335` локальный 500 → 404 как на проде. Урок:
невалидный local env портит baseline — чинить env до diff, не
триажить как баг.

Отчёты probe-bot: `docs/LOGS/Analisis/probe-runs/probe-report-2026-
11-21_14-{24,26,27,29,30,31,32,33}-*-run-*.md`.

## Anomalies (не баги, задокументировано)

- POST items → 201 (пакет ожидал 200) — правильная семантика.
- Admin JSON list: `?status=all` → 400 (`all` — только SSR-фильтр).
- Content-Type не enforced на POST — zod всё равно валидирует.
- `server: Fly/…` header — Fly edge, не app-leak.
- Request-логи пишут значение `x-admin-key` — shared request
  logger, предшествует 229; вынесено в platform backlog (все
  admin-поверхности одинаково).
- Prod BOT-TEST-* артефакты оставлены append-only по гигиене пакета.

## Вердикт

**GREEN.** BUG-1 — единственная prod-находка — воспроизведена,
исправлена, задеплоена и подтверждена двумя независимыми
инструментами: прямым curl (5/5 repro → 400) и probe-bot
(`?q=%00` кейс → 400 pass, 0 fail на 142 кейсах).
Projection-leak / FTS / workflow / gaps / SSR / no-store / rate-
limit — всё зелёное на живом Postgres.
