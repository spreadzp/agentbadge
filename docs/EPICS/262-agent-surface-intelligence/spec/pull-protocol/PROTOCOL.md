# Pull Protocol v1 — capability jobs (SLICE-262-16, ADR-INTEL-002)

Версионируемый контракт plugin-pull диагностики. Инвариант:
**backend никогда не передаёт исполняемый код, произвольные
выражения или paths вне whitelist.** Job = ссылка на capability
из этого реестра + typed params. Решения: D-262-Q22…Q43.

Файлы: `job.schema.json` (wire-формат job),
`capability-registry.v1.json` (единственный источник whitelist'ов
+ result-schema + limits + data-classification — версия `v1`).
PHP потребляет JSON verbatim (`contracts/` в плагине — копия).

## Endpoints (все Bearer absk_ кроме create)

| Метод | Кто | Что |
|---|---|---|
| `POST /api/intel/jobs` | operator (abop_, role≥operator) | create+sign job; gates: consent inside_diagnostics + entitlement inside_diagnostics |
| `GET /api/intel/jobs?site=` | plugin | read-only peek pending (queued + own claimed) — без side-effects |
| `POST /api/intel/jobs/:id/claim` | plugin | атомарный queued→claimed; выдаёт `lease_token`+`lease_generation`+`lease_expires_at`(+15min); retry → тот же context |
| `POST /api/intel/jobs/:id/result` | plugin | submit result → envelope PLUGIN_SELF_REPORTED |

## Job lifecycle

```
queued ──claim(gen=1)──► claimed ──result──► done
            │                │
            │           lease expired ──► requeue (reclaim≤2)
            │                │                    │
            │           reclaim_count>2 ──────► expired (terminal)
            │
         TTL 60min (re-claim НЕ сбрасывает) ──► expired
```

- `lease_generation` — монотонный счётчик поколений claim;
  result принимается только от текущего поколения, иначе
  `409 lease_expired` (гонка двух исполнителей)
- claim retry **того же поколения** → те же
  `lease_token/lease_expires_at` (HTTP-retry безопасен)
- result идемпотентен по `job_id` + canonical-equal body →
  тот же envelope-ref; другой body → `409 conflict` +
  security event

## Подпись

- Домен: sub-key `intel:jobs` — `sha256("intel:jobs"+seed)`
  от intel-seed; публикуется в `/.well-known/agentbadge-keys.json`
  в `keysets[]` с `purpose:"jobs"`, validity window, и
  root-подписью над `{root_id, keysets}`.
- Job подписывается canonical body: `{job_id, site_id,
  probe_id, params, exp, nonce, key_id}` — JCS (RFC 8785).
- Плагин: verify keyset (root-sig + окно validity) → verify
  job-sig → проверки (exp, nonce-store, probe∈registry,
  params∈whitelist, consent-mirror) → исполнение.
- Подпись доказывает **происхождение**, не безопасность и не
  легитимность намерения (R4).

## Consent + entitlement gates

- `inside_diagnostics` — отдельный consent kind (не audit).
  Проверка при `POST /jobs` (create), при `claim`, и при
  `result`-submit — revocation mid-flight отвергает result.
- Entitlement op `inside_diagnostics` — paid-операция,
  тот же checkEntitlement как у deep_scan.
- Plugin mirror-флаг — кэш, не авторизация.
- `/scans` создаёт pull-jobs только при handshake+consent+
  entitlement; нет consent → нет jobs (не ошибка); wait ≤90с;
  поздний результат → envelope для следующего scan, signed
  report не мутирует.

## Capabilities v1

См. `capability-registry.v1.json` — каждая запись:
`probe_id`, `params` (typed, enum/whitelist), `result`
(schema + redaction), `max_exec_ms`, `data_class`,
`damage_budget` (макс. урон при компрометированном backend —
заполняется честно, урон ≠ 0).

| probe_id | params | result |
|---|---|---|
| `const_read` | `{name ∈ CONST_WHITELIST}` | `{name, defined, value?}` |
| `option_read` | `{name ∈ OPTION_WHITELIST}` | `{name, present, value?}` — per-field redaction |
| `phpinfo_summary` | `{}` | 8 фиксированных полей |

`siteurl`/`home` → `{siteurl_https, home_https}` — флаги,
без URL. `default_role` → enum WP-ролей.

## Лимиты (R5 — DoS/memory, не RCE)

- params JSON ≤ 1 KiB; result JSON ≤ 8 KiB; string ≤ 256 chars
- max 1 result на job; capability exec ≤ 5000ms (server-side
  заявление; plugin честно докладывает `exec_ms`)
- rate limits per-site: peek 30/ч, claim 60/ч, result 60/ч,
  evidence 60/ч, burst 10/мин (server-side policy)

## Security event stream

Append-only, отдельно от consent-audit. События:
`result_conflict` (409), `lease_stale` (409 lease_expired),
`job_forge_rejected`. Поля: `event_id, site_id, job_id,
lease_generation, event_type, principal, correlation_id,
payload_digest (sha256 canonical body), ts` — полный payload
НЕ хранится. Запись не зависит от активного consent.

## Fail-closed (полная матрица)

| Нарушение | Ответ |
|---|---|
| bad job-sig / unknown key_id / expired keyset | plugin: отказ, jobs не исполняются; free-функции живы |
| `exp` истёк / nonce в store | plugin: отказ |
| probe_id∉registry / param∉whitelist | plugin: отказ без обращения к WP |
| нет consent при claim | `403 consent_denied` |
| consent revoked → result | `403 consent_denied` + job возвращается в очередь? НЕТ — stays claimed, lease истекает → requeue. Result отвергнут. |
| stale generation | `409 lease_expired` + security event |
| done-job, другой payload | `409 conflict` + security event |
| malformed result-schema | `400 result_invalid` |
| TTL истёк | job expired, из peek пропадает |
| rate limit | `429` + Retry-After |

## Три acceptance-гейта

G1 stale lease cannot submit · G2 stale trust cannot execute ·
G3 late evidence cannot mutate report — негативные тесты,
обязательны.
