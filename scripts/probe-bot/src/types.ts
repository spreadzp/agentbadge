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
}

/** Single request to fire (one probe variant). */
export interface Variant {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
  expect: ExpectSpec;
  note?: string;
}

export interface ExpectSpec {
  statusIn?: number[];
  statusNotIn?: number[];
  bodyNotIncludes?: string[];
  /** Response header must contain substring (case-insensitive both sides). */
  headers?: Record<string, string>;
}

export interface Scenario {
  name: string;
  layer: Layer;
  /** Verify result against `event` table via X-Request-Id (D-234-38-Q5). */
  dbVerify: boolean;
  /** Real side-effects/payment actions — needs --allow-mutations (Q11). */
  mutating: boolean;
  applies(ep: Endpoint): boolean;
  variants(ep: Endpoint): Variant[] | Promise<Variant[]>;
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
