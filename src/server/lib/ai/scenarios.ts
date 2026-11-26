/**
 * EPIC-232 (SLICE-232-1): scenario-runner registry (O3 seam).
 *
 * A runner turns an AiJob into the concrete prompt triple
 * (system/user/jsonSchema). Foundation ships NO production runners —
 * scenario slices (232-2 classification/summary, 232-4 search, ...)
 * register theirs here; the worker resolves jobs through the map and
 * fails jobs with `no_runner` for unregistered scenarios.
 */

import type { AiJobRecord, AiStore } from "./types";

export interface AiScenarioPrompt {
  system: string;
  user: string;
  jsonSchema?: {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
  maxTokens?: number;
  temperature?: number;
  /**
   * Stamped onto AiRun.promptVersion (O1 — prompt-drift control).
   * Runners that load `prompts/<scenario>.md` pass its content hash;
   * programmatic prompts pass promptVersionFor(text) or a literal tag.
   */
  promptVersion?: string;
}

export interface AiScenarioInput {
  job: AiJobRecord;
  store: AiStore;
}

export type AiScenarioRunner = (
  input: AiScenarioInput,
) => Promise<AiScenarioPrompt>;

const runners = new Map<string, AiScenarioRunner>();

export function registerScenarioRunner(
  scenario: string,
  runner: AiScenarioRunner,
): void {
  runners.set(scenario, runner);
}

export function getScenarioRunner(
  scenario: string,
): AiScenarioRunner | undefined {
  return runners.get(scenario);
}

/** Test hook — runner registrations are process-global. */
export function resetScenarioRunners(): void {
  runners.clear();
}
