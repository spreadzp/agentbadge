// EPIC-140 (SLICE-140-17): barrel — re-exports helpers, extractors, checkers, SEMANTIC_CHECKERS.
// Preserves the original './semantic-checkers' public API (import path unchanged).

// Shared helpers + types
export * from "./helpers";
// Pricing/rate-limit extractors
export * from "./pricing-extractors";

export { checkerOpenapiOperationDescriptions } from "./openapi-operation-descriptions";
export { checkerOpenapiParameterSemantics } from "./openapi-parameter-semantics";
export { checkerOpenapiExamples } from "./openapi-examples";
export { checkerOpenapiErrorSchemas } from "./openapi-error-schemas";
export { checkerPricingDiscoverability } from "./pricing-discoverability";
export { checkerRateLimitsMachineReadable } from "./rate-limits-machine-readable";
export { checkerPricingLimitsConsistency } from "./pricing-limits-consistency";
export { checkerAuthenticationClarity } from "./authentication-clarity";
export { checkerRetrySemanticsDeclared } from "./retry-semantics-declared";
export { checkerVersioningDeclared } from "./versioning-declared";
export { checkerSandboxDeclared } from "./sandbox-declared";
export { checkerAgentPolicyMachineReadable } from "./agent-policy-machine-readable";
export { checkerCapabilityListDeclared } from "./capability-list-declared";
export { checkerBusinessConstraintsDocumented } from "./business-constraints-documented";
export { checkerSupportPathDeclared } from "./support-path-declared";
export { checkerAiAgentDiscoveryMeta } from "./ai-agent-discovery-meta";
export { checkerHeartbeatMd } from "./heartbeat-md";
export { checkerSkillJsonLd } from "./skill-json-ld";
export { checkerErrorCatalog } from "./error-catalog";
export { checkerAgentFeeds } from "./agent-feeds";
export { checkerNextCallPattern } from "./next-call-pattern";

import type { SemanticChecker } from "./helpers";
import { checkerOpenapiOperationDescriptions } from "./openapi-operation-descriptions";
import { checkerOpenapiParameterSemantics } from "./openapi-parameter-semantics";
import { checkerOpenapiExamples } from "./openapi-examples";
import { checkerOpenapiErrorSchemas } from "./openapi-error-schemas";
import { checkerPricingDiscoverability } from "./pricing-discoverability";
import { checkerRateLimitsMachineReadable } from "./rate-limits-machine-readable";
import { checkerPricingLimitsConsistency } from "./pricing-limits-consistency";
import { checkerAuthenticationClarity } from "./authentication-clarity";
import { checkerRetrySemanticsDeclared } from "./retry-semantics-declared";
import { checkerVersioningDeclared } from "./versioning-declared";
import { checkerSandboxDeclared } from "./sandbox-declared";
import { checkerAgentPolicyMachineReadable } from "./agent-policy-machine-readable";
import { checkerCapabilityListDeclared } from "./capability-list-declared";
import { checkerBusinessConstraintsDocumented } from "./business-constraints-documented";
import { checkerSupportPathDeclared } from "./support-path-declared";
import { checkerAiAgentDiscoveryMeta } from "./ai-agent-discovery-meta";
import { checkerHeartbeatMd } from "./heartbeat-md";
import { checkerSkillJsonLd } from "./skill-json-ld";
import { checkerErrorCatalog } from "./error-catalog";
import { checkerAgentFeeds } from "./agent-feeds";
import { checkerNextCallPattern } from "./next-call-pattern";

export const SEMANTIC_CHECKERS: Record<string, SemanticChecker> = {
  openapi_operation_descriptions: checkerOpenapiOperationDescriptions,
  openapi_parameter_semantics: checkerOpenapiParameterSemantics,
  openapi_examples: checkerOpenapiExamples,
  openapi_error_schemas: checkerOpenapiErrorSchemas,
  pricing_discoverability: checkerPricingDiscoverability,
  rate_limits_machine_readable: checkerRateLimitsMachineReadable,
  pricing_limits_consistency: checkerPricingLimitsConsistency,
  authentication_clarity: checkerAuthenticationClarity,
  retry_semantics_declared: checkerRetrySemanticsDeclared,
  versioning_declared: checkerVersioningDeclared,
  sandbox_declared: checkerSandboxDeclared,
  agent_policy_machine_readable: checkerAgentPolicyMachineReadable,
  capability_list_declared: checkerCapabilityListDeclared,
  business_constraints_documented: checkerBusinessConstraintsDocumented,
  support_path_declared: checkerSupportPathDeclared,
  ai_agent_discovery_meta: checkerAiAgentDiscoveryMeta,
  heartbeat_md: checkerHeartbeatMd,
  skill_json_ld: checkerSkillJsonLd,
  error_catalog: checkerErrorCatalog,
  agent_feeds: checkerAgentFeeds,
  next_call_pattern: checkerNextCallPattern,
};
