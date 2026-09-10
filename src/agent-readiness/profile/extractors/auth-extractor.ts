import type { Assertion } from "../../rule-engine/assertion-builder";
import type { AuthSection } from "../profile-schema";
import { SECTION_CATEGORY_MAP } from "../section-map";
import { computeSectionMeta, filterByCategories } from "./section-meta-helper";

/**
 * SLICE-101-4: Auth Extractor.
 *
 * Pure function: extracts auth section from assertions.
 * Filters by SECTION_CATEGORY_MAP.auth categories (bot_auth, identity, sandbox).
 * Returns undefined if zero applicable assertions.
 */

export function extractAuth(assertions: Assertion[]): AuthSection | undefined {
  const categories = SECTION_CATEGORY_MAP.auth;
  const applicable = filterByCategories(assertions, categories);

  if (applicable.length === 0) return undefined;

  const methods: { type: string; flows?: string[]; url?: string }[] = [];
  let did: string | undefined;
  let webBotAuth = false;

  for (const a of applicable) {
    if (a.status !== "VERIFIED" && a.status !== "INFERRED") continue;

    for (const e of a.evidence) {
      const url = (e as { url?: string }).url ?? "";
      const detail = (e as { semantic_detail?: string }).semantic_detail ?? "";

      // OAuth2 — from oauth-protected-resource or openapi security schemes
      if (
        url.includes("oauth-protected-resource") ||
        url.includes("oauth") ||
        detail.includes("oauth2") ||
        detail.includes('"oauth"')
      ) {
        if (!methods.some((m) => m.type === "oauth2")) {
          methods.push({
            type: "oauth2",
            flows: detail.includes("client_credentials") ? ["client_credentials"] : undefined,
            url: url || undefined,
          });
        }
      }

      // API key — from header/auth evidence
      if (
        detail.includes("api_key") ||
        detail.includes("apiKey") ||
        detail.includes("x-api-key")
      ) {
        if (!methods.some((m) => m.type === "api_key")) {
          methods.push({ type: "api_key" });
        }
      }

      // Bearer — from openapi security schemes
      if (detail.includes("bearer") || detail.includes("Bearer")) {
        if (!methods.some((m) => m.type === "bearer")) {
          methods.push({ type: "bearer" });
        }
      }

      // DID — from did.json evidence
      if (url.includes("did.json") || url.includes("did:") || detail.includes("did:")) {
        const didMatch = detail.match(/did:[a-z0-9]+(?::[a-zA-Z0-9._-]+)+/);
        if (didMatch) {
          did = didMatch[0];
        }
        if (!methods.some((m) => m.type === "did")) {
          methods.push({ type: "did", url: url || undefined });
        }
      }

      // Web bot auth — HTTP Message Signatures
      if (
        url.includes("http-message-signatures") ||
        detail.includes("http-message-signatures") ||
        detail.includes("signature") ||
        a.category === "bot_auth"
      ) {
        webBotAuth = true;
      }
    }
  }

  const meta = computeSectionMeta(applicable);

  return {
    data: {
      methods,
      web_bot_auth: webBotAuth,
      did,
    },
    ...meta,
  };
}
