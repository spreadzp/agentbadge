// EPIC-264 (SLICE-264-1): admin operator accountability barrel.

export * from "./types";
export * from "./operator-key";
export * from "./store";
export { createOperatorStore } from "./ops";
export { createMemoryOperatorRepos } from "./memory";
export { consumeKeyReveal, mintKeyReveal } from "./key-reveal";
export { createMemoryOperatorStore, pickOperatorStores } from "./db-stores";
export {
  breakGlassAuthUsed,
  logBreakGlassPosture,
  tryBreakGlassKey,
  type BreakGlassAuthResult,
} from "./breakglass";
export {
  applyOperatorSeed,
  createOperator,
  isOperatorName,
  issueOperatorCredential,
  normalizeOperatorName,
  rotateOperatorCredential,
  seedOperatorsFromEnv,
  type LifecycleCreateResult,
  type IssueKeyResult,
  type OperatorSeed,
  type OperatorSeedResult,
  type RotateCredentialResult,
} from "./lifecycle";
