// SLICE-259-40 (engine gap): the credential_security / aauth / auth_probe
// rule families declared check.type "cross_evidence" — but cross-evidence
// only produces a `cross` verdict when ≥2 OpenAPI-type sources are present,
// so single-source rules could never reach VERIFIED ("evidence found but
// does not confirm"). The flags ARE computed by the fetchers — these
// checkers read them honestly.
import { type SemanticChecker, type Snapshots, parseJsonBody } from "./helpers";

type FlagMap = Record<string, unknown>;

/** credential_security snapshot body = snapJson(CredentialSecurityResult). */
function credentialFlags(snapshots: Snapshots): FlagMap | null {
  const snap = snapshots.credential_security;
  if (!snap?.body) return null;
  const parsed = parseJsonBody(snap) as { data?: FlagMap } | null;
  return parsed?.data ?? null;
}

/** aauth snapshot body = snapJson(AAuthResult). */
function aauthFlags(snapshots: Snapshots): FlagMap | null {
  const snap = snapshots.aauth;
  if (!snap?.body) return null;
  const parsed = parseJsonBody(snap) as { data?: FlagMap } | null;
  return parsed?.data ?? null;
}

/** auth_probe snapshot body = snapJson(AuthProbeResult). */
function authProbeData(snapshots: Snapshots): FlagMap | null {
  const snap = snapshots.auth_probe;
  if (!snap?.body) return null;
  return parseJsonBody(snap) as FlagMap | null;
}

function flagChecker(
  flag: string,
  expected: unknown,
  label: string,
): SemanticChecker {
  return (sources) => {
    const flags = credentialFlags(sources);
    if (!flags) return { outcome: "no_source", detail: "credential_security source not fetched" };
    return flags[flag] === expected
      ? { outcome: "found", detail: `${label}: ${flag}=${String(expected)}` }
      : { outcome: "absent", detail: `${label}: ${flag}=${String(flags[flag])}` };
  };
}

/** AB-128: OAuth2 preferred over static API keys. */
export const checkerCredentialOauth2Preferred: SemanticChecker = (sources) => {
  const flags = credentialFlags(sources);
  if (!flags) return { outcome: "no_source", detail: "credential_security source not fetched" };
  if (flags.usesOAuth2 && !flags.usesStaticApiKey)
    return { outcome: "found", detail: "OAuth2 schemes present, no apiKey schemes" };
  const detail = !flags.usesOAuth2
    ? "no oauth2 securityScheme in OpenAPI"
    : "static apiKey scheme present in OpenAPI";
  return { outcome: "absent", detail };
};

/** AB-129: credentials via headers, never query params. */
export const checkerCredentialHeaderTransport: SemanticChecker = (sources) => {
  const flags = credentialFlags(sources);
  if (!flags) return { outcome: "no_source", detail: "credential_security source not fetched" };
  if (flags.credentialsInHeader && !flags.credentialsInQuery)
    return { outcome: "found", detail: "credentials in headers only" };
  if (flags.credentialsInQuery)
    return { outcome: "absent", detail: "credentials accepted via query parameters" };
  return { outcome: "absent", detail: "no header credential scheme detected" };
};

/** AB-145: no static apiKey schemes in OpenAPI security. */
export const checkerCredentialNoStaticKeys = flagChecker(
  "usesStaticApiKey",
  false,
  "No static API keys",
);

/** AB-130: scopes_supported published. */
export const checkerCredentialScopesDefined = flagChecker(
  "scopesDefined",
  true,
  "OAuth scopes",
);

/** AB-131/AB-143: revocation_endpoint published (and reachable — the source
 * fetches metadata; reachability is the endpoint's own probe, treated as
 * declared once published). */
export const checkerCredentialRevocation = flagChecker(
  "revocationSupported",
  true,
  "Revocation endpoint",
);

/** AB-132: introspection_endpoint. */
export const checkerCredentialIntrospection = flagChecker(
  "introspectionSupported",
  true,
  "Introspection endpoint",
);

/** AB-133: private_key_jwt auth method. */
export const checkerCredentialPrivateKeyJwt = flagChecker(
  "privateKeyJwtSupported",
  true,
  "private_key_jwt",
);

/** AB-134: RFC 8693 token exchange grant. */
export const checkerCredentialTokenExchange = flagChecker(
  "tokenExchangeSupported",
  true,
  "Token exchange",
);

/** AB-138: DPoP. */
export const checkerCredentialDpop = flagChecker(
  "dpopSupported",
  true,
  "DPoP",
);

/** AB-139: mTLS-bound tokens. */
export const checkerCredentialMtls = flagChecker(
  "mtlsBoundTokens",
  true,
  "mTLS-bound tokens",
);

/** AB-136: agent_authorization grant in OAuth metadata. */
export const checkerAauthAgentGrant: SemanticChecker = (sources) => {
  const flags = aauthFlags(sources);
  if (!flags) return { outcome: "no_source", detail: "aauth source not fetched" };
  return flags.agentGrantSupported
    ? { outcome: "found", detail: "agent_authorization grant advertised" }
    : { outcome: "absent", detail: "agent_authorization grant not in grant_types_supported" };
};

/** AB-137: scope_descriptions published in aauth.json. */
export const checkerAauthScopeDescriptions: SemanticChecker = (sources) => {
  const flags = aauthFlags(sources);
  if (!flags) return { outcome: "no_source", detail: "aauth source not fetched" };
  const list = flags.scopeDescriptions;
  return Array.isArray(list) && list.length > 0
    ? { outcome: "found", detail: `${list.length} scope_descriptions published` }
    : { outcome: "absent", detail: "no scope_descriptions in aauth.json" };
};

/** AB-141: token endpoint returns expires_in. */
export const checkerAuthProbeTokenExpires: SemanticChecker = (sources) => {
  const data = authProbeData(sources);
  if (!data) return { outcome: "no_source", detail: "auth probe not run (no credentials supplied)" };
  const exp = data.tokenExpiresIn;
  return typeof exp === "number" && exp > 0
    ? { outcome: "found", detail: `token expires_in=${exp}` }
    : { outcome: "absent", detail: `token response lacks expires_in (status=${String(data.status)})` };
};

/** AB-142: refresh_token grant advertised in OAuth metadata. */
export const checkerOauthRefreshGrant: SemanticChecker = (sources) => {
  const snap = sources.oauth_authorization_server;
  if (!snap?.body) return { outcome: "no_source", detail: "oauth metadata not fetched" };
  try {
    const meta = JSON.parse(snap.body) as { grant_types_supported?: unknown };
    const grants = meta.grant_types_supported;
    return Array.isArray(grants) && grants.includes("refresh_token")
      ? { outcome: "found", detail: "refresh_token grant advertised" }
      : { outcome: "absent", detail: "refresh_token not in grant_types_supported" };
  } catch {
    return { outcome: "absent", detail: "oauth metadata not valid JSON" };
  }
};

const LOC_TAG = /<loc>/g;

function countSitemapUrls(body: string | null | undefined): number {
  if (!body) return 0;
  const matches = body.match(LOC_TAG);
  return matches ? matches.length : 0;
}

/** AB-077: openapi.json serves a parseable spec with declared paths. */
export const checkerOpenapiStandardValid: SemanticChecker = (sources) => {
  const snap = sources.openapi_standard;
  if (!snap?.body) return { outcome: "no_source", detail: "openapi.json not fetched" };
  const spec = parseJsonBody(snap) as { paths?: Record<string, unknown>; openapi?: string } | null;
  if (!spec) return { outcome: "absent", detail: "openapi.json is not valid JSON" };
  const pathCount = spec.paths ? Object.keys(spec.paths).length : 0;
  return spec.openapi && pathCount > 0
    ? { outcome: "found", detail: `OpenAPI ${spec.openapi} spec valid — ${pathCount} paths declared` }
    : { outcome: "absent", detail: "openapi.json parsed but lacks openapi version or paths" };
};

/** AB-114: ai-sitemap.xml covers ≥50% of sitemap.xml URLs. */
export const checkerAiSitemapCoverage: SemanticChecker = (sources) => {
  const ai = sources.ai_sitemap;
  const main = sources.sitemap;
  if (!ai?.body && !main?.body)
    return { outcome: "no_source", detail: "sitemap sources not fetched" };
  const aiCount = countSitemapUrls(ai?.body);
  const mainCount = countSitemapUrls(main?.body);
  if (mainCount === 0)
    return { outcome: "absent", detail: "main sitemap has no URLs to cover" };
  const ratio = aiCount / mainCount;
  return ratio >= 0.5
    ? { outcome: "found", detail: `ai-sitemap covers ${aiCount}/${mainCount} URLs (${Math.round(ratio * 100)}%)` }
    : { outcome: "absent", detail: `ai-sitemap covers only ${aiCount}/${mainCount} URLs (${Math.round(ratio * 100)}% < 50%)` };
};
