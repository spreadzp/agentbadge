import type { AgentReadinessRule } from "../rule.schema";
import type { Status } from "../shared.schema";

export interface SourceData {
  data: Record<string, unknown>;
}

export type EvaluateInput = Record<string, SourceData>;

export interface EvaluateResult {
  status: Status;
}

export interface EvaluableRule extends AgentReadinessRule {
  evaluate(sources: EvaluateInput): EvaluateResult;
}

function makeEvaluable(
  rule: AgentReadinessRule,
  checkFn: (sources: EvaluateInput) => boolean,
): EvaluableRule {
  return {
    ...rule,
    evaluate(sources: EvaluateInput): EvaluateResult {
      return { status: checkFn(sources) ? "VERIFIED" : "GAP" };
    },
  };
}

export const AB128: EvaluableRule = makeEvaluable(
  {
    rule_id: "AB-128",
    version: "1.0.0",
    name: "OAuth2 preferred over static API keys",
    category: "bot_auth",
    severity: "high",
    counted_in_score: true,
    check: {
      type: "cross_evidence",
      sources: ["credential_security"],
    },
    fix: {
      eligible: true,
      type: "assisted",
      note: "Use OAuth2 security schemes in OpenAPI instead of static API keys for agent-authenticatable access",
    },
  },
  (s) => {
    const cs = s.credential_security?.data;
    return !!cs?.usesOAuth2 && !cs?.usesStaticApiKey;
  },
);

export const AB129: EvaluableRule = makeEvaluable(
  {
    rule_id: "AB-129",
    version: "1.0.0",
    name: "Credentials passed via headers (not query params)",
    category: "bot_auth",
    severity: "high",
    counted_in_score: true,
    check: {
      type: "cross_evidence",
      sources: ["credential_security"],
    },
    fix: {
      eligible: true,
      type: "assisted",
      note: "Pass credentials via Authorization header, not query parameters which can be logged",
    },
  },
  (s) => {
    const cs = s.credential_security?.data;
    return !!cs?.credentialsInHeader && !cs?.credentialsInQuery;
  },
);

export const AB130: EvaluableRule = makeEvaluable(
  {
    rule_id: "AB-130",
    version: "1.0.0",
    name: "OAuth scopes defined",
    category: "bot_auth",
    severity: "medium",
    counted_in_score: true,
    check: {
      type: "cross_evidence",
      sources: ["credential_security"],
    },
    fix: {
      eligible: true,
      type: "assisted",
      note: "Define scopes_supported in OAuth metadata so agents can request appropriate access",
    },
  },
  (s) => {
    const cs = s.credential_security?.data;
    return !!cs?.scopesDefined;
  },
);

export const AB131: EvaluableRule = makeEvaluable(
  {
    rule_id: "AB-131",
    version: "1.0.0",
    name: "Token revocation endpoint available",
    category: "bot_auth",
    severity: "medium",
    counted_in_score: true,
    check: {
      type: "cross_evidence",
      sources: ["credential_security"],
    },
    fix: {
      eligible: true,
      type: "assisted",
      note: "Provide a revocation_endpoint in OAuth metadata for token lifecycle management",
    },
  },
  (s) => {
    const cs = s.credential_security?.data;
    return !!cs?.revocationSupported;
  },
);

export const AB132: EvaluableRule = makeEvaluable(
  {
    rule_id: "AB-132",
    version: "1.0.0",
    name: "Token introspection endpoint available",
    category: "bot_auth",
    severity: "low",
    counted_in_score: false,
    check: {
      type: "cross_evidence",
      sources: ["credential_security"],
    },
    fix: {
      eligible: false,
      type: "none",
      note: "Provide an introspection_endpoint in OAuth metadata for resource server token validation",
    },
  },
  (s) => {
    const cs = s.credential_security?.data;
    return !!cs?.introspectionSupported;
  },
);

export const AB133: EvaluableRule = makeEvaluable(
  {
    rule_id: "AB-133",
    version: "1.0.0",
    name: "Private key JWT auth method supported",
    category: "bot_auth",
    severity: "low",
    counted_in_score: false,
    check: {
      type: "cross_evidence",
      sources: ["credential_security"],
    },
    fix: {
      eligible: false,
      type: "none",
      note: "Support private_key_jwt in token_endpoint_auth_methods_supported for asymmetric client authentication",
    },
  },
  (s) => {
    const cs = s.credential_security?.data;
    return !!cs?.privateKeyJwtSupported;
  },
);

export const AB134: EvaluableRule = makeEvaluable(
  {
    rule_id: "AB-134",
    version: "1.0.0",
    name: "Token Exchange (RFC 8693) supported",
    category: "bot_auth",
    severity: "medium",
    counted_in_score: false,
    check: {
      type: "cross_evidence",
      sources: ["credential_security"],
    },
    fix: {
      eligible: false,
      type: "none",
      note: "Support urn:ietf:params:oauth:grant-type:token-exchange for delegation flows",
    },
  },
  (s) => {
    const cs = s.credential_security?.data;
    return !!cs?.tokenExchangeSupported;
  },
);
