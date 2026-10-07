/**
 * EPIC-178 (SLICE-178-1/178-2): manifest registry — single point of truth.
 * Slices add entries here (path + contentType + builder); routes and the
 * gen script never know about individual manifests.
 */

import type { DiscoverySources } from "./sources";
import { buildLlmsTxt, buildLlmsFullTxt } from "./llms";
import { buildAgentCard } from "./agent-card";
import {
  buildAgentEvaluation,
  buildOwnerQuestions,
} from "./evaluation";
import {
  buildApiCatalog,
  buildErc8004Agent,
  buildMcpServerCard,
  buildOauthProtectedResource,
  buildSecurityTxt,
} from "./wellknown";
import { buildDidWebDocument } from "./did";

export interface ManifestEntry {
  /** URL path the manifest is served at. */
  path: string;
  /** File name under public/ for the snapshot (relative, no leading /).
   *  Empty string = env-dependent → boot-generated only, no snapshot
   *  (D-178-11: snapshots only for static-deterministic manifests). */
  publicPath: string;
  /** Response Content-Type (may include parameters, e.g. linkset profile). */
  contentType: string;
  /** Cache-Control max-age seconds (default 300). */
  cacheMaxAge?: number;
  /** OpenAPI summary for describeRoute. */
  summary?: string;
  /** If set — entry is a 301 redirect, `build` is ignored. */
  redirectTo?: (src: DiscoverySources) => string;
  /** Feature gate — entry is registered but returns 404 when false. */
  enabled?: (src: DiscoverySources) => boolean;
  build?: (src: DiscoverySources) => string;
}

export const MANIFEST_REGISTRY: ManifestEntry[] = [
  {
    path: "/llms.txt",
    publicPath: "llms.txt",
    contentType: "text/plain; charset=utf-8",
    cacheMaxAge: 300,
    summary: "LLM-friendly catalog (llmstxt.org)",
    build: buildLlmsTxt,
  },
  {
    path: "/llms-full.txt",
    publicPath: "llms-full.txt",
    contentType: "text/plain; charset=utf-8",
    cacheMaxAge: 300,
    summary: "Full-text LLM context (concatenated site content)",
    build: buildLlmsFullTxt,
  },
  {
    path: "/.well-known/agent-card.json",
    publicPath: ".well-known/agent-card.json",
    contentType: "application/a2a+json",
    cacheMaxAge: 3600,
    summary: "Agent Card — A2A v1.0",
    build: buildAgentCard,
  },
  {
    // A2A v0.x discovery path → canonical agent-card.json (D-178-4).
    path: "/.well-known/agent.json",
    publicPath: "",
    contentType: "application/json",
    summary: "Deprecated A2A v0.x path — 301 to agent-card.json",
    redirectTo: (src) => `${src.baseUrl}/.well-known/agent-card.json`,
  },
  {
    path: "/.well-known/api-catalog",
    publicPath: ".well-known/api-catalog",
    contentType:
      'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
    cacheMaxAge: 3600,
    summary: "API Catalog — RFC 9727 linkset",
    build: buildApiCatalog,
  },
  {
    path: "/.well-known/erc8004-agent.json",
    publicPath: ".well-known/erc8004-agent.json",
    contentType: "application/json",
    cacheMaxAge: 3600,
    summary: "EIP-8004 agent registration (registration-v1)",
    build: buildErc8004Agent,
  },
  {
    path: "/.well-known/mcp/server-card.json",
    publicPath: ".well-known/mcp/server-card.json",
    contentType: "application/json",
    cacheMaxAge: 3600,
    summary: "MCP server card — tools introspected from live registry",
    build: buildMcpServerCard,
  },
  {
    path: "/.well-known/oauth-protected-resource",
    publicPath: ".well-known/oauth-protected-resource",
    contentType: "application/json",
    cacheMaxAge: 3600,
    summary: "OAuth Protected Resource metadata (RFC 9728)",
    build: buildOauthProtectedResource,
  },
  {
    path: "/.well-known/security.txt",
    // Time-dependent (Expires=now+1y) → boot-generated, no static snapshot
    // (a committed file would rot the drift-check every regen).
    publicPath: "",
    contentType: "text/plain; charset=utf-8",
    cacheMaxAge: 3600,
    summary: "security.txt — RFC 9116",
    build: buildSecurityTxt,
  },
  {
    path: "/.well-known/agent-evaluation.json",
    publicPath: ".well-known/agent-evaluation.json",
    contentType: "application/json",
    cacheMaxAge: 3600,
    summary: "Verification ladder — how external agents check our claims (5s→full)",
    build: buildAgentEvaluation,
  },
  {
    path: "/.well-known/owner-questions.json",
    publicPath: ".well-known/owner-questions.json",
    contentType: "application/json",
    cacheMaxAge: 3600,
    summary: "Operator/fleet FAQ for evaluator agents (solo/team/venue)",
    build: buildOwnerQuestions,
  },
  {
    // did:web document — registered only when DID_SIGNING_KEY yields
    // key material (D-178-9/178-7). publicPath "": env-dependent →
    // boot-generated only, never snapshotted (D-178-11).
    path: "/.well-known/did.json",
    publicPath: "",
    contentType: "application/did+json",
    cacheMaxAge: 3600,
    summary: "DID document (did:web) — gated by DID_SIGNING_KEY",
    enabled: (src) => src.didEnabled === true && src.didKey !== undefined,
    build: (src) => JSON.stringify(buildDidWebDocument(src), null, 2) + "\n",
  },
];
