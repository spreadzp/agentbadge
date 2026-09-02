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

export const AB141: EvaluableRule = makeEvaluable(
  {
    rule_id: "AB-141",
    version: "1.0.0",
    name: "Short-lived access tokens",
    category: "bot_auth",
    severity: "medium",
    counted_in_score: true,
    check: {
      type: "cross_evidence",
      sources: ["auth_probe"],
    },
    fix: {
      eligible: true,
      type: "assisted",
      note: "Ensure token endpoint returns expires_in field so agents know token lifetime",
    },
  },
  (s) => {
    const ap = s.auth_probe as { tokenExpiresIn?: number } | undefined;
    return typeof ap?.tokenExpiresIn === "number" && ap.tokenExpiresIn > 0;
  },
);

export const AB142: EvaluableRule = makeEvaluable(
  {
    rule_id: "AB-142",
    version: "1.0.0",
    name: "Refresh token rotation supported",
    category: "bot_auth",
    severity: "medium",
    counted_in_score: false,
    check: {
      type: "cross_evidence",
      sources: ["oauth_authorization_server"],
    },
    fix: {
      eligible: false,
      type: "none",
      note: "Include refresh_token in grant_types_supported to enable token rotation",
    },
  },
  (s) => {
    const oauth = s.oauth_authorization_server as { body?: string } | undefined;
    if (!oauth?.body) return false;
    try {
      const meta = JSON.parse(oauth.body);
      const grants = meta.grant_types_supported;
      return Array.isArray(grants) && grants.includes("refresh_token");
    } catch {
      return false;
    }
  },
);

export const AB143: EvaluableRule = makeEvaluable(
  {
    rule_id: "AB-143",
    version: "1.0.0",
    name: "Token revocation endpoint reachable",
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
      note: "Provide a revocation_endpoint in OAuth metadata and ensure it is reachable",
    },
  },
  (s) => {
    const cs = s.credential_security?.data;
    return !!cs?.revocationSupported;
  },
);

const VAULT_KEYWORDS = ["vault", "scoped", "session", "rotate", "ephemeral"];

export const AB144: EvaluableRule = makeEvaluable(
  {
    rule_id: "AB-144",
    version: "1.0.0",
    name: "Auth.md documents credential vault pattern",
    category: "documentation",
    severity: "low",
    counted_in_score: false,
    check: {
      type: "content_parse",
      sources: ["auth_md"],
    },
    fix: {
      eligible: false,
      type: "none",
      note: "Document credential vault pattern in auth.md: centralized storage, rotation, and scoped token issuance",
    },
  },
  (s) => {
    const body = (s.auth_md as { body?: string } | undefined)?.body;
    if (!body) return false;
    const lower = body.toLowerCase();
    return VAULT_KEYWORDS.some((kw) => lower.includes(kw));
  },
);

export const AB145: EvaluableRule = makeEvaluable(
  {
    rule_id: "AB-145",
    version: "1.0.0",
    name: "No static API keys in OpenAPI security",
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
      note: "Remove apiKey security schemes from OpenAPI spec — use OAuth2 instead for agent-authenticatable access",
    },
  },
  (s) => {
    const cs = s.credential_security?.data;
    return cs?.usesStaticApiKey === false;
  },
);
