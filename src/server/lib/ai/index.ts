/**
 * EPIC-232 (SLICE-232-1): AI automation foundation barrel —
 * provider seam, outbox store, worker, policy/budget guards.
 * AI never writes decisions — AiRun is advisory-only (§16.5).
 */

export { AI_FIELD_LIMITS, AiJobContractError, capError, enqueueAiJob } from "./jobs";
export { appendAiRun, latestAiRunFor } from "./runs";
export { resolvePolicy, setPolicyMode, setPolicyThreshold } from "./policies";
export type { ResolvedPolicy } from "./policies";
export {
  applyBudgetDegradation,
  checkBudget,
  resetBudgetDegraded,
  resolveEffectiveMode,
  utcDayStart,
  utcMonthStart,
} from "./budget";
export type { BudgetState, BudgetStateName } from "./budget";
export { createAiAlertSender } from "./alerts";
export type { AiAlertSender } from "./alerts";
export {
  LlmError,
  OpenAiCompatibleProvider,
  createOpenAiProvider,
} from "./provider";
export type {
  FetchLike,
  LlmCompleteRequest,
  LlmCompleteResult,
  LlmErrorKind,
  LlmProvider,
  OpenAiProviderOptions,
} from "./provider";
export {
  getScenarioRunner,
  registerScenarioRunner,
  resetScenarioRunners,
} from "./scenarios";
export type {
  AiScenarioInput,
  AiScenarioPrompt,
  AiScenarioRunner,
} from "./scenarios";
export { loadPrompt, promptVersionFor, resetPromptCache } from "./prompts";
export type { LoadedPrompt } from "./prompts";
export { createMemoryAiStore, pickAiStores } from "./db-stores";
export { InMemoryAiStore } from "./store-memory";
export { DbAiStore } from "./store-db";
export { drainAiJobs, startAiWorker, stopAiWorker } from "./worker";
export type { AiDrainResult, DrainAiDeps } from "./worker";
export {
  AI_SUBJECT_AGENT_REQUEST,
  INTAKE_AI_SCENARIOS,
  enqueueAiIntakeJobs,
  loadAiSuggestions,
  registerAiIntakeHook,
  resetAiIntakeHook,
  wireAiIntake,
} from "./intake";
export type { AiSuggestionView, EnqueueIntakeResult } from "./intake";
export {
  INTAKE_RUNNER_SCENARIOS,
  registerIntakeRunners,
} from "./intake-runners";
export {
  AI_JOB_STATUSES,
  AI_MODES,
  AI_RUN_STATUSES,
  AI_SCENARIOS,
} from "./types";
export type {
  AiJobInsert,
  AiJobRecord,
  AiJobStatus,
  AiMode,
  AiRunInsert,
  AiRunRecord,
  AiRunStatus,
  AiScenario,
  AiStore,
  AiUsage,
  AutomationPolicyPatch,
  AutomationPolicyRecord,
  PolicyChangeInsert,
  PolicyChangeRecord,
} from "./types";
