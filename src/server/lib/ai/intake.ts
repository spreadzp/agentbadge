/**
 * EPIC-232 (SLICE-232-2, D-232-5): intake seam — enqueue AiJobs for
 * the E1/E2 scenarios when an interaction request commits, plus the
 * admin-side suggestion view-model.
 *
 * Enqueue path rides the post-commit `onInteractionEvent` seam
 * (agent-interaction/events.ts — same seam the TG notify uses):
 * INTERNAL `interaction.request.received` carries the immutable
 * payloadSha256 snapshot (D-232-5 inputHash). Enqueue is gated twice:
 * kill-switch (`config.ai?.enabled`) at fire time, then per-scenario
 * declared policy mode ≠ off. The job is an OUTBOX row — the worker
 * still re-checks every gate at drain time, so a stale queue row can
 * never force a provider call.
 *
 * §16.5: nothing here writes classification/decision fields — the
 * only artifacts are AiJob/AiRun rows rendered as advisory
 * suggestions.
 */

import { getConfig } from "../../../config/env";
import type { AiEnvConfig } from "../../../config/env/ai-types";
import type { InteractionEventInput } from "../request-inbox/interaction-store";
import { onInteractionEvent } from "../agent-interaction/events";
import { getDatabase } from "../database";
import { pickRequestInboxStores } from "../request-inbox/db-stores";
import type { RequestInboxStores } from "../request-inbox/store";

import type { KnowledgeStore } from "../knowledge/store";
import { pickKnowledgeStores } from "../knowledge/db-stores";

import { registerAiComparisonHook } from "./compare";
import { pickAiStores } from "./db-stores";
import { registerIntakeRunners } from "./intake-runners";
import { registerKnowledgeSearchRunner } from "./knowledge-runner";
import { enqueueAiJob } from "./jobs";
import type { AiRunRecord, AiStore } from "./types";

/** Scenarios enqueued on every new intake request (E1+E2+E3). */
export const INTAKE_AI_SCENARIOS = [
  "classification",
  "summary",
  "knowledge_search",
] as const;

export const AI_SUBJECT_AGENT_REQUEST = "agent_request";

export interface EnqueueIntakeResult {
  scenario: string;
  jobId: string;
  duplicate: boolean;
}

/**
 * Queue one job per non-off scenario for a committed intake request.
 * `inputRef` points at the subject row; `inputHash` pins the payload
 * snapshot (events carry sha256 — cheap join, no re-hash).
 */
export async function enqueueAiIntakeJobs(
  aiStore: AiStore,
  input: {
    requestId: string;
    inputHash?: string | null;
  },
  scenarios: readonly string[] = INTAKE_AI_SCENARIOS,
): Promise<EnqueueIntakeResult[]> {
  const out: EnqueueIntakeResult[] = [];
  for (const scenario of scenarios) {
    const policy = await aiStore.getPolicy(scenario);
    if ((policy?.mode ?? "off") === "off") continue;
    const { job, duplicate } = await enqueueAiJob(aiStore, {
      scenario,
      subjectType: AI_SUBJECT_AGENT_REQUEST,
      subjectId: input.requestId,
      inputRef: `interaction:${input.requestId}`,
      inputHash: input.inputHash ?? null,
    });
    out.push({ scenario, jobId: job.id, duplicate });
  }
  return out;
}

// ─── event hook ─────────────────────────────────────────────────

interface IntakeHookOpts {
  aiStore?: AiStore;
  /** Read per-event so a kill-switch flip takes effect immediately. */
  config?: () => AiEnvConfig | undefined;
  scenarios?: readonly string[];
}

let _intakeHook: (() => void) | null = null;

function isIntakeReceived(ev: InteractionEventInput): boolean {
  return (
    ev.kind === "interaction.request.received" &&
    ev.visibility === "INTERNAL"
  );
}

/**
 * Post-commit listener: INTERNAL request.received → enqueueAiIntakeJobs.
 * Returns an unsubscribe fn; a second call while registered is a no-op
 * returning the existing unsubscribe (tests remount wiring often).
 */
export function registerAiIntakeHook(opts: IntakeHookOpts = {}): () => void {
  if (_intakeHook) return _intakeHook;
  const readCfg = opts.config ?? (() => getConfig().ai);
  _intakeHook = onInteractionEvent((requestId, event) => {
    if (!isIntakeReceived(event)) return;
    const cfg = readCfg();
    if (!cfg?.enabled) return; // kill-switch — never even queue
    const payload = event.payload as Record<string, unknown> | null;
    const inputHash =
      typeof payload?.payloadSha256 === "string" ? payload.payloadSha256 : null;
    const store = opts.aiStore ?? pickAiStores(getDatabase());
    void enqueueAiIntakeJobs(
      store,
      { requestId, inputHash },
      opts.scenarios,
    ).catch(() => {
      /* fire-and-forget: enqueue failure must not surface at intake */
    });
  });
  return _intakeHook;
}

/** Test hook — unsubscribes + clears the process-global registration. */
export function resetAiIntakeHook(): void {
  _intakeHook?.();
  _intakeHook = null;
}

/**
 * One-call wiring (background.ts): bind the inbox stores into the
 * intake runners + register the enqueue hook. Inert when the ai env
 * section is absent — the hook's enabled-gate short-circuits.
 */
export function wireAiIntake(
  deps: {
    stores?: RequestInboxStores;
    aiStore?: AiStore;
    /** 232-4 E3 seam — undefined → pick from db; null → NOT_AVAILABLE. */
    knowledge?: KnowledgeStore | null;
    config?: () => AiEnvConfig | undefined;
  } = {},
): void {
  const stores = deps.stores ?? pickRequestInboxStores(getDatabase());
  const aiStore = deps.aiStore ?? pickAiStores(getDatabase());
  registerIntakeRunners({ stores });
  registerKnowledgeSearchRunner({
    stores,
    knowledge:
      deps.knowledge === undefined
        ? pickKnowledgeStores(getDatabase())
        : deps.knowledge,
  });
  registerAiIntakeHook({ aiStore, config: deps.config });
  // 232-3 E7: lazy shadow comparison — classified events →
  // ai.agreement.computed audit rows (never surfaces shadow output).
  registerAiComparisonHook({ stores, aiStore });
}

// ─── admin suggestion view-model (§16.5 — advisory only) ────────

export interface AiSuggestionView {
  scenario: string;
  /** AiRun id — null when no visible run exists (232-7 aiRunRef). */
  runId: string | null;
  /** Latest run status, or "none" when the subject has no run yet. */
  status: string;
  /** modeAtTime on the run (declared policy when no run). */
  mode: string;
  output: unknown;
  confidence: number | null;
  /** Declared policy threshold (O2 — null until calibrated). */
  threshold: number | null;
  /** confidence < threshold → flag the human-review path. */
  belowThreshold: boolean;
  model: string | null;
  promptVersion: string | null;
  latencyMs: number | null;
  error: string | null;
  createdAt: string | null;
}

/**
 * Latest run + policy threshold per intake scenario for one request.
 * Read-only — the admin page renders this as an advisory block next
 * to (never inside) the human classification form.
 *
 * BLIND (D-232-5, slice 232-3): runs recorded under modeAtTime=shadow
 * never reach the operator surface — shadow agreement only counts if
 * the human decided without seeing the AI output. Skipped/error runs
 * with modeAtTime=off stay visible (no AI output exists to leak).
 */
export async function loadAiSuggestions(
  aiStore: AiStore,
  requestId: string,
  scenarios: readonly string[] = INTAKE_AI_SCENARIOS,
): Promise<AiSuggestionView[]> {
  const out: AiSuggestionView[] = [];
  for (const scenario of scenarios) {
    const [runs, policy] = await Promise.all([
      aiStore.listRuns({
        subjectType: AI_SUBJECT_AGENT_REQUEST,
        subjectId: requestId,
        scenario,
        limit: 10,
      }),
      aiStore.getPolicy(scenario),
    ]);
    const run: AiRunRecord | undefined = runs.find(
      (r) => r.modeAtTime !== "shadow",
    );
    const threshold = policy?.confidenceThreshold ?? null;
    const confidence = run?.confidence ?? null;
    out.push({
      scenario,
      runId: run?.id ?? null,
      status: run?.status ?? "none",
      mode: run?.modeAtTime ?? policy?.mode ?? "off",
      output: run?.output ?? null,
      confidence,
      threshold,
      belowThreshold:
        confidence !== null && threshold !== null && confidence < threshold,
      model: run?.model ?? null,
      promptVersion: run?.promptVersion ?? null,
      latencyMs: run?.latencyMs ?? null,
      error: run?.error ?? null,
      createdAt: run?.createdAt ?? null,
    });
  }
  return out;
}
