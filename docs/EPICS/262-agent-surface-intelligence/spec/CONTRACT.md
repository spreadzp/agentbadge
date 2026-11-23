# Intel Evidence Contract v1 — SLICE-262-1

Версионируемый контракт фактов (D-262-Q5). Единственный авторитетный
источник для backend и WP-плагина (PHP потребляет `schemas/` без Node —
D-262-Q12). Реализация: `src/server/lib/intel/evidence/`; тесты:
`tests/intel/`; регенерация: `bun run generate:intel-schemas`.

## Две схемы — граница доверия

| | Collector Submission | Canonical Envelope |
|---|---|---|
| Что | untrusted input DTO | backend-owned record |
| Файл | `schemas/collector-submission.schema.json` | `schemas/canonical-envelope.schema.json` |
| Доп. ключи | `additionalProperties: false` — **reject** | `additionalProperties: false` |
| Поля доверия | отсутствуют физически (`provenance`, `received_at`, `verifier`, `signature` → reject) | назначает backend |

Submission: `collector_id`, `scan_id`, `site_ref`, `collected_at`
(заявленное, клиентские часы не доверяем), `subject`, `payload`
(discriminated union по `type`), `evidence_refs[]`.

Envelope: `schema_version` (literal `"1.0"`), `envelope_id`
(`env_` + 26-char Crockford ULID), `scan_id`, `site_id`, `collector
{type,id,version}` (из аутентифицированного контекста), `verifier
{id,check_type}`, `provenance`, `collected_at`, `received_at` (только
backend clock), `subject`, `payload`, `evidence_refs`, `derived_from?`,
`signature`.

## Provenance — взаимоисключающая классификация записи

`provenance = f(authenticated collector.type)` — чистая функция контекста,
никогда не поле wire-формата:

| collector.type | provenance |
|---|---|
| `external_scan` | `EXTERNAL_OBSERVED` |
| `wp_plugin` | `PLUGIN_SELF_REPORTED` |
| `backend_verifier` | `BACKEND_VERIFIED` — требует `verifier.check_type` (ЧТО проверено) |
| `deriver` | `DERIVED` — требует непустой `derived_from[]` |

Запрет на эскалацию (D-262-Q6): получение/хранение/подпись/трансформация
не повышают доверие. Проверка self-report'а = НОВЫЙ envelope
`BACKEND_VERIFIED` с `derived_from` → исходный; исходный не переписывается.
`collector_id` в submission обязан совпадать с аутентифицированным id —
расхождение = reject на границе.

## Signature contract (Q59=A+C)

- **Algorithm**: `ed25519` (единственный; неизвестный algo → reject).
- **Key**: `signature.key_id` ↔ запись в
  `/.well-known/agentbadge-keys.json` (unknown key_id → reject).
- **Signing input**: JCS (RFC 8785) каноникализация envelope, где поле
  `signature` свёрнуто в `{"algorithm":"ed25519","key_id":<id>}` —
  значение подписи исключено, `key_id` и `schema_version` связаны
  внутри подписываемых байтов.
- **Проверка**: структура (schema pins version+algo) → lookup key_id →
  Ed25519 verify. Любой сбой → `{ok:false,error}`; unknown
  schema_version → `invalid_envelope`.
- **Смысл подписи**: целостность принятого envelope — НЕ истинность
  фактов. Collector-подписи вне v1 (нет фиктивных attestation-полей).

## Evidence refs

`{evidence_ref_id, media_type, sha256 (64-hex), size}` — указатель на
артефакт; storage вне v1, digest+size проверяемы
(`verifyEvidenceRefDigest`).

## Payload-варианты (discriminant `type`, closed union)

`http_observation`, `document_fact`, `file_presence`,
`wp_option_read`, `verification_result`, `derived_assessment`.
Новые варианты — только через minor-версию схемы; unknown `type` → reject.

## Subject-варианты

`site`, `url` (нормализация: lowercase host), `wp_option`, `file_path`.

## Redaction

На границе, до подписи: object keys `/secret|token|password|api_?key|
private_?key|credential|authorization|auth_?token/i` → `[REDACTED]`;
name/value-пары с секретным именем маскируют `value`; URL query-параметры
из секретного набора маскируются.

## Legacy compat (Q61=C)

`agentbadge-report.json` (ruleset 1.x) → compatibility representation:
все assertions verbatim; evidence inline + digest-refs только из
существующих `content_hash`; без evidence → `legacy_no_evidence`;
никаких provenance/received_at/signature — фабрикация запрещена,
compat-записи НЕ являются envelopes.

## Fixtures

`fixtures/envelopes/` — валидные подписанные envelope всех 4 классов
(детерминированы: фиксированный seed `Buffer.alloc(32,7)`, key_id
`bk-fixture-1` — НЕ production-ключ). `fixtures/negative/` — reject-классы
с `expected_error`. `fixtures/legacy/agentbadge-report.json` — реальный
ruleset-1.x отчёт для converter-тестов.
