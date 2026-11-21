/**
 * Shared types for probe-bot (SLICE-234-38, D-234-38-Q1..Q17).
 */

export type Layer = "contract" | "security";
export type Verdict = "new" | "pass" | "fail" | "suspect" | "inconclusive";
export type Source = "openapi" | "x402" | "code" | "manual";

export interface Endpoint {
  path: string;
  method: string;
  source: Source;
  /** Семантический контракт из registry.yaml (SLICE-234-40). */
  contract?: EndpointContract;
}

/** Contract-блок: семантика endpoint'а для contract-aware сценариев. */
export interface EndpointContract {
  /** Валидное тело POST; строки могут содержать {case_key}/{run_id}/{ts}. */
  bodyTemplate?: Record<string, unknown>;
  /** Имя поля/заголовка идемпотентности ("idempotency-key" header →
      помечаем префиксом "header:"). */
  idempotencyField?: string;
  /** json.equals на ответе реплея (напр. {duplicate: true}). */
  replayExpect?: Record<string, unknown>;
  /** json-пути, равные между R1 и R2 реплея (напр. requestId). */
  replayInvariant?: string[];
  /** Поля, которых НЕ должно быть в public-проекции (json.absent). */
  projectionDenylist?: string[];
  /** Имена идентичностей для bola/lifecycle (креды — env PROBE_ID_*). */
  identities?: string[];
  /** Поле в ответе R1 с id ресурса (для projection/ssr/free шагов). */
  idField?: string;
  /** Путь ответа R1, ведущий на read-проекцию (напр. "statusUrl"). */
  readPathField?: string;
  /** Шаблон SSR-страницы с {id} для xss-ssr. */
  ssrPath?: string;
  /** Действие-освобождение ресурса для use-after-free:
      method + path-шаблон с {id} + опц. тело. */
  freeAction?: { method: string; path: string; body?: Record<string, unknown> };
  /** Терминальные статусы (для terminal-replay). */
  terminalStates?: string[];
  /** admin-path для lifecycle-флоу (classify/respond/reject mount). */
  lifecycleAdmin?: string;
}

/** Single request to fire (one probe variant). */
export interface Variant {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
  expect: ExpectSpec;
  note?: string;
  /** Stateful-флоу (SLICE-234-40): шаги исполняются последовательно
      в рамках ОДНОГО кейса; cross-step assert получает все obs. */
  flow?: {
    steps: FlowStep[];
    /** Доп. проверки поверх per-step expect: вернуть список проблем. */
    assert?: (obs: import("./verify").HttpObservation[]) => string[];
  };
}

/** Один шаг stateful-флоу. */
export interface FlowStep {
  method: string;
  /** Путь; {stepN.<json-path>} подставляется из ответа шага N (1-based). */
  path: string;
  headers?: Record<string, string>;
  body?: string;
  note?: string;
  /** expect override для этого шага (иначе — expect варианта). */
  expect?: ExpectSpec;
}

/** Семантические asserts по JSON-телу ответа (SLICE-234-40, слой 1). */
export interface JsonExpect {
  /** dot-пути, обязанные существовать: "requestId", "session.id". */
  present?: string[];
  /** dot-пути, которых НЕ должно быть (projection-denylist). */
  absent?: string[];
  /** dot-путь → точное значение. */
  equals?: Record<string, unknown>;
  /** dot-путь → regex (строковое совпадение по String(value)). */
  regex?: Record<string, string>;
  /** Упрощённая openapi-схема (resolved): required + shallow types. */
  schema?: { required?: string[]; props?: Record<string, string> };
  /** Ссылка на openapi-фрагмент; runner резолвит в `schema`. */
  schemaRef?: string;
}

export interface ExpectSpec {
  statusIn?: number[];
  statusNotIn?: number[];
  bodyNotIncludes?: string[];
  /** Response header must contain substring (case-insensitive both sides). */
  headers?: Record<string, string>;
  json?: JsonExpect;
}

/** Контекст прогона для генераторов вариантов (flow/contract). */
export interface ScenarioContext {
  runId?: string;
  target?: string;
}

export interface Scenario {
  name: string;
  layer: Layer;
  /** Verify result against `event` table via X-Request-Id (D-234-38-Q5). */
  dbVerify: boolean;
  /** Real side-effects/payment actions — needs --allow-mutations (Q11). */
  mutating: boolean;
  applies(ep: Endpoint): boolean;
  variants(ep: Endpoint, ctx?: ScenarioContext): Variant[] | Promise<Variant[]>;
}

export interface ProbeOrder {
  target: string;
  endpoints?: string[];
  scenarios?: string[];
  layer?: Layer;
  dbVerify?: boolean;
  deliverTo?: "session" | "file" | "tg";
  maxRequests?: number;
  rps?: number;
  dryRun?: boolean;
  allowMutations?: boolean;
}

export interface CaseResult {
  caseKey: string;
  endpoint: string;
  method: string;
  layer: Layer;
  scenario: string;
  variantHash: string;
  expected: ExpectSpec;
  verdict: Verdict;
  status: number | null;
  requestId: string | null;
  durationMs: number | null;
  note: string;
}

export interface RunSummary {
  runId: string;
  target: string;
  locus: string;
  layer: string;
  started: string;
  ended?: string;
  dryRun: boolean;
  counts: Record<Verdict | "skipped", number>;
  results: CaseResult[];
  reportPath?: string;
}
