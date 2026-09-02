import type { AgentReadinessRule } from "../rule.schema";
import type { Status } from "../shared.schema";
import type { EvaluateInput } from "./AB128";

export interface EvaluableRule extends AgentReadinessRule {
  evaluate(sources: EvaluateInput): { status: Status };
}

function makeEvaluable(
  rule: AgentReadinessRule,
  checkFn: (sources: EvaluateInput) => boolean,
): EvaluableRule {
  return {
    ...rule,
    evaluate(sources: EvaluateInput): { status: Status } {
      return { status: checkFn(sources) ? "VERIFIED" : "GAP" };
    },
  };
}

export const AB135: EvaluableRule = makeEvaluable(
  {
    rule_id: "AB-135",
    version: "1.0.0",
    name: "AAuth metadata endpoint available",
    category: "bot_auth",
    severity: "medium",
    counted_in_score: true,
    check: {
      type: "http_fetch",
      target: "/.well-known/aauth.json",
      sources: ["aauth"],
    },
    fix: {
      eligible: true,
      type: "assisted",
      note: "Publish /.well-known/aauth.json with agent authorization grant metadata",
    },
  },
  (s) => {
    const aauth = s.aauth?.data;
    return !!aauth?.aauthFound;
  },
);

export const AB136: EvaluableRule = makeEvaluable(
  {
    rule_id: "AB-136",
    version: "1.0.0",
    name: "Agent Authorization Grant supported",
    category: "bot_auth",
    severity: "medium",
    counted_in_score: true,
    check: {
      type: "cross_evidence",
      sources: ["aauth"],
    },
    fix: {
      eligible: true,
      type: "assisted",
      note: "Add urn:ietf:params:oauth:grant-type:agent_authorization to grant_types_supported in OAuth metadata",
    },
  },
  (s) => {
    const aauth = s.aauth?.data;
    return !!aauth?.agentGrantSupported;
  },
);

export const AB137: EvaluableRule = makeEvaluable(
  {
    rule_id: "AB-137",
    version: "1.0.0",
    name: "AAuth scope descriptions published",
    category: "bot_auth",
    severity: "low",
    counted_in_score: false,
    check: {
      type: "cross_evidence",
      sources: ["aauth"],
    },
    fix: {
      eligible: false,
      type: "none",
      note: "Publish scope_descriptions in aauth.json so agents can discover available scopes",
    },
  },
  (s) => {
    const aauth = s.aauth?.data;
    return Array.isArray(aauth?.scopeDescriptions) && aauth.scopeDescriptions.length > 0;
  },
);

export const AB138: EvaluableRule = makeEvaluable(
  {
    rule_id: "AB-138",
    version: "1.0.0",
    name: "DPoP token binding supported",
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
      note: "Support DPoP (RFC 9449) by providing dpop_signing_alg_values_supported in OAuth metadata",
    },
  },
  (s) => {
    const cs = s.credential_security?.data;
    return !!cs?.dpopSupported;
  },
);

export const AB139: EvaluableRule = makeEvaluable(
  {
    rule_id: "AB-139",
    version: "1.0.0",
    name: "mTLS-bound access tokens",
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
      note: "Support mTLS certificate-bound access tokens (RFC 8705) via tls_client_certificate_bound_access_tokens",
    },
  },
  (s) => {
    const cs = s.credential_security?.data;
    return !!cs?.mtlsBoundTokens;
  },
);

const AUTH_MD_KEYWORDS = ["agent", "session", "scoped", "oauth", "token"];

export const AB140: EvaluableRule = makeEvaluable(
  {
    rule_id: "AB-140",
    version: "1.0.0",
    name: "Auth.md documents agent auth flow",
    category: "documentation",
    severity: "low",
    counted_in_score: true,
    check: {
      type: "content_parse",
      sources: ["auth_md"],
    },
    fix: {
      eligible: true,
      type: "assisted",
      note: "Document agent authentication flow in auth.md, mentioning OAuth2, session-scoped tokens, and agent identity",
    },
  },
  (s) => {
    const body = (s.auth_md as { body?: string } | undefined)?.body;
    if (!body) return false;
    const lower = body.toLowerCase();
    return AUTH_MD_KEYWORDS.some((kw) => lower.includes(kw));
  },
);
