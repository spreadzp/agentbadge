# LOCAL-BRIDGE — как облачному Devin общаться с локальной машиной

На локальной машине работает watcher (`scripts/devin-bridge/watcher.ts`), который
каждые ~45 секунд опрашивает эту облачную сессию по ssh и выполняет два вида
file-drop запросов. У тебя НЕТ прямого доступа к локальным файлам — но ты можешь
запросить их через этот канал и получить уведомления в обратную сторону.

## 1. Запрос локального контекста — `~/local-queries/*.req`

Создай файл `~/local-queries/<уникальный-id>.req`:

```bash
mkdir -p ~/local-queries
cat > ~/local-queries/ctx-001.req <<'EOF'
LOCAL-QUERY
TYPE: doc
ARG: docs/EPICS/206-marketplace-agent-interop/decisions.md
NEED: нужны решения D-206-* для ответа на вопрос оператора
QID: ctx-001
EOF
```

Поддерживаемые TYPE:

- `doc` / `file` — ARG = путь относительно workspace root
  (`/home/dev/Projects/my/agents-ai/hedera`). Разрешены только
  `docs/**`, `graphify-out/**`, `backlog/**`, `hackathon/server/src/**`.
  Файлы с именами `*.env`, `*key*`, `*secret*`, `*.pem` и т.п. будут DENIED.
- `backlog` — ARG = task-id (например `MYPROJ-2672`), вернёт файл задачи.
- `graphify` — ARG = поисковый запрос к graphify knowledge graph.
- `command`, `log` — НЕ выполняются автоматически; уходят в human-queue
  на локальной стороне и будут обработаны оператором вручную.

## 2. Ответ

Watcher ответит в этот чат сообщением:

```
LOCAL-ANSWER
FOR: doc: docs/EPICS/...md
QID: ctx-001

<содержимое файла>
```

Если payload > 4KB — в чат придёт указатель `LOCAL-ANSWER-FILE: ~/answers/<qid>.txt`,
забери файл: `cat ~/answers/<qid>.txt`.

Если ответа нет >2 минут — проверь, что watcher запущен у оператора
(`bun watcher.ts status` на локальной стороне).

## 3. Уведомление оператору — `~/local-notify/*.notify`

Когда завершил значимую задачу (PR открыт, тесты прогнаны, деплой и т.п.),
кинь файл `~/local-notify/<id>.notify` — он будет переслан в Telegram-канал
оператора:

```bash
mkdir -p ~/local-notify
cat > ~/local-notify/task-done-001.notify <<'EOF'
LOCAL-NOTIFY
TASK: fix market claim race
TEXT:
Done. PR opened: https://github.com/spreadzp/agentbadge/pull/123
Tests: 61/61 pass. Deployed to staging.
EOF
```

TASK — короткий заголовок (одна строка). TEXT — тело до 4000 символов.
Используй это на завершении каждого существенного шага, не для чата.

## Правила

- Один запрос = один `.req` файл. QID должен быть уникальным в сессии.
- Не запрашивай файлы вне whitelist — ответ будет `DENIED: ...`.
- Обработанные файлы watcher переносит в `done/` — не удаляй их сам.
