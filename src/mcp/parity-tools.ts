/**
 * SLICE-49-20: MCP/OpenAPI parity tools
 *
 * Thin MCP tool wrappers for OpenAPI endpoints not yet exposed as MCP tools.
 * Each tool calls the corresponding REST endpoint and returns the JSON result.
 *
 * Best practice (MCP SDK): servers should be thin, focused, and easy to build.
 * Each tool wraps a REST endpoint with minimal transformation.
 */

import { z } from "zod";
import { type ToolResult, type NamespaceRegistry, getNamespace } from "@agentgate-hedera/mcp";

function getRegistry(ns?: NamespaceRegistry) {
  return ns ?? getNamespace("all")!;
}

const BASE_URL = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 4021}`;

/**
 * Generic GET wrapper — fetches a REST endpoint and returns JSON as text.
 */
async function getEndpoint(path: string, description: string): Promise<ToolResult> {
  try {
    const resp = await fetch(`${BASE_URL}${path}`);
    const text = await resp.text();
    return {
      content: [{ type: "text", text }],
      isError: !resp.ok,
    };
  } catch (e: any) {
    return {
      content: [{ type: "text", text: `Error fetching ${path}: ${e.message}` }],
      isError: true,
    };
  }
}

/**
 * Generic POST wrapper — sends a JSON body to a REST endpoint and returns JSON as text.
 */
async function postEndpoint(path: string, body: Record<string, unknown>, description: string): Promise<ToolResult> {
  try {
    const resp = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    return {
      content: [{ type: "text", text }],
      isError: !resp.ok,
    };
  } catch (e: any) {
    return {
      content: [{ type: "text", text: `Error posting to ${path}: ${e.message}` }],
      isError: true,
    };
  }
}

// ─── Well-known endpoints ─────────────────────────────────────────

async function getOauthAuthorizationServerHandler(): Promise<ToolResult> {
  return getEndpoint("/.well-known/oauth-authorization-server", "OAuth authorization server metadata");
}

async function getOauthProtectedResourceHandler(): Promise<ToolResult> {
  return getEndpoint("/.well-known/oauth-protected-resource", "OAuth protected resource metadata");
}

async function getWebfingerHandler(args: Record<string, unknown>): Promise<ToolResult> {
  const resource = args.resource as string;
  const path = resource ? `/.well-known/webfinger?resource=${encodeURIComponent(resource)}` : "/.well-known/webfinger";
  return getEndpoint(path, "WebFinger resource discovery");
}

async function getHttpMessageSignaturesDirectoryHandler(): Promise<ToolResult> {
  return getEndpoint("/.well-known/http-message-signatures-directory", "HTTP Message Signatures directory");
}

// ─── DID resolution ───────────────────────────────────────────────

async function resolveDidHandler(args: Record<string, unknown>): Promise<ToolResult> {
  const did = args.did as string;
  return getEndpoint(`/did/${encodeURIComponent(did)}`, "DID resolution");
}

// ─── Admin ────────────────────────────────────────────────────────

async function rebuildCacheHandler(): Promise<ToolResult> {
  return postEndpoint("/admin/rebuild-cache", {}, "Rebuild directory cache from HCS");
}

// ─── Content pages ────────────────────────────────────────────────

async function getFeedHandler(): Promise<ToolResult> {
  return getEndpoint("/feed", "Activity feed");
}

async function getChangelogHandler(): Promise<ToolResult> {
  return getEndpoint("/changelog", "Changelog");
}

async function getFaqHandler(): Promise<ToolResult> {
  return getEndpoint("/faq", "FAQ page");
}

async function getAboutHandler(): Promise<ToolResult> {
  return getEndpoint("/about", "About page");
}

async function getPricingHandler(): Promise<ToolResult> {
  return getEndpoint("/pricing", "Pricing page");
}

async function getPrivacyHandler(): Promise<ToolResult> {
  return getEndpoint("/privacy", "Privacy policy");
}

async function getTermsHandler(): Promise<ToolResult> {
  return getEndpoint("/terms", "Terms of service");
}

async function getServicesHandler(): Promise<ToolResult> {
  return getEndpoint("/services", "Services page");
}

async function getTeamHandler(): Promise<ToolResult> {
  return getEndpoint("/team", "Team page");
}

async function getUseCasesHandler(): Promise<ToolResult> {
  return getEndpoint("/use-cases", "Use cases page");
}

async function getWorkWithUsHandler(): Promise<ToolResult> {
  return getEndpoint("/work-with-us", "Work with us page");
}

// ─── Guides ───────────────────────────────────────────────────────

async function getMarketGuideHandler(): Promise<ToolResult> {
  return getEndpoint("/market-guide", "Market guide");
}

async function getMarketplaceGuideHandler(): Promise<ToolResult> {
  return getEndpoint("/marketplace-guide", "Marketplace guide");
}

async function getMedicalGuideHandler(): Promise<ToolResult> {
  return getEndpoint("/medical-guide", "Medical guide");
}

// ─── Work requests ────────────────────────────────────────────────

async function listWorkRequestsHandler(args: Record<string, unknown>): Promise<ToolResult> {
  const limit = args.limit as number | undefined;
  const offset = args.offset as number | undefined;
  const params = new URLSearchParams();
  if (limit) params.set("limit", String(limit));
  if (offset) params.set("offset", String(offset));
  const qs = params.toString();
  return getEndpoint(`/api/work-requests${qs ? `?${qs}` : ""}`, "List work requests");
}

async function getWorkRequestHandler(args: Record<string, unknown>): Promise<ToolResult> {
  const id = args.id as string;
  return getEndpoint(`/api/work-requests/${encodeURIComponent(id)}`, "Get work request by ID");
}

async function createWorkRequestHandler(args: Record<string, unknown>): Promise<ToolResult> {
  return postEndpoint("/api/work-requests", args, "Create a work request");
}

// ─── Agent by DID ───────────────────────────────────────────────

async function getAgentByDidHandler(args: Record<string, unknown>): Promise<ToolResult> {
  const did = args.did as string;
  return getEndpoint(`/agents/${encodeURIComponent(did)}`, "Agent details by DID");
}

// ─── Agency services & contact (SLICE-56-9) ──────────────────────

async function getServicesInfoHandler(): Promise<ToolResult> {
  return getEndpoint("/agency.json", "Canonical agency profile with services, capabilities, and contacts");
}

async function contactUsHandler(): Promise<ToolResult> {
  return getEndpoint("/agent-guide/team/contact", "Contact information and routing for agency inquiries");
}

// ─── Registration ─────────────────────────────────────────────────

export function registerParityTools(ns?: NamespaceRegistry): void {
  const r = getRegistry(ns);
  // Well-known endpoints
  r.registerTool(
    "get_oauth_authorization_server",
    "Fetch OAuth authorization server metadata (/.well-known/oauth-authorization-server) — RFC 8414. Contains issuer, authorization_endpoint, token_endpoint, scopes_supported, etc.",
    {},
    getOauthAuthorizationServerHandler,
  );

  r.registerTool(
    "get_oauth_protected_resource",
    "Fetch OAuth protected resource metadata (/.well-known/oauth-protected-resource) — RFC 9728. Contains resource, authorization_servers, scopes_supported, etc.",
    {},
    getOauthProtectedResourceHandler,
  );

  r.registerTool(
    "get_webfinger",
    "Fetch WebFinger resource discovery (/.well-known/webfinger) — RFC 7033. Returns resource links for a given URI.",
    {
      resource: z.string().optional().describe("The resource URI to look up (e.g. acct:alice@agentbadge.xyz)"),
    },
    getWebfingerHandler,
  );

  r.registerTool(
    "get_http_message_signatures_directory",
    "Fetch the HTTP Message Signatures directory (/.well-known/http-message-signatures-directory) — lists agents supporting HTTP Message Signatures (RFC 9421).",
    {},
    getHttpMessageSignaturesDirectoryHandler,
  );

  // DID resolution
  r.registerTool(
    "resolve_did",
    "Resolve a DID (did:hcs:tokenId:serial) to its DID document. Returns the on-chain DID document with verification methods and service endpoints.",
    {
      did: z.string().describe("The DID to resolve (e.g. did:hcs:0.0.12345:1)"),
    },
    resolveDidHandler,
  );

  // Admin
  r.registerTool(
    "rebuild_cache",
    "Rebuild the HCS directory cache from on-chain messages. Admin operation — triggers a full rescan of the directory topic.",
    {},
    rebuildCacheHandler,
  );

  // Content pages
  r.registerTool(
    "get_feed",
    "Fetch the activity feed (/feed) — recent agent registrations, task postings, and completions.",
    {},
    getFeedHandler,
  );

  r.registerTool(
    "get_changelog",
    "Fetch the changelog (/changelog) — list of recent product changes and updates.",
    {},
    getChangelogHandler,
  );

  r.registerTool(
    "get_faq",
    "Fetch the FAQ page (/faq) — 12 Q&A pairs about AgentBadge, with FAQPage JSON-LD structured data.",
    {},
    getFaqHandler,
  );

  r.registerTool(
    "get_about",
    "Fetch the About page (/about) — information about AgentBadge project and team.",
    {},
    getAboutHandler,
  );

  r.registerTool(
    "get_pricing",
    "Fetch the Pricing page (/pricing) — passport tier pricing and features comparison.",
    {},
    getPricingHandler,
  );

  r.registerTool(
    "get_privacy",
    "Fetch the Privacy policy (/privacy) — data handling and privacy commitments.",
    {},
    getPrivacyHandler,
  );

  r.registerTool(
    "get_terms",
    "Fetch the Terms of service (/terms) — legal terms for using AgentBadge.",
    {},
    getTermsHandler,
  );

  r.registerTool(
    "get_services",
    "Fetch the Services page (/services) — available agent services and capabilities.",
    {},
    getServicesHandler,
  );

  r.registerTool(
    "get_team",
    "Fetch the Team page (/team) — team members and roles.",
    {},
    getTeamHandler,
  );

  r.registerTool(
    "get_use_cases",
    "Fetch the Use cases page (/use-cases) — 5 real-world scenarios for AgentBadge.",
    {},
    getUseCasesHandler,
  );

  r.registerTool(
    "get_work_with_us",
    "Fetch the Work with us page (/work-with-us) — partnership and collaboration information.",
    {},
    getWorkWithUsHandler,
  );

  // Guides
  r.registerTool(
    "get_market_guide",
    "Fetch the Market guide (/market-guide) — interactive guide for using the marketplace.",
    {},
    getMarketGuideHandler,
  );

  r.registerTool(
    "get_marketplace_guide",
    "Fetch the Marketplace guide (/marketplace-guide) — guide for posting and claiming tasks.",
    {},
    getMarketplaceGuideHandler,
  );

  r.registerTool(
    "get_medical_guide",
    "Fetch the Medical guide (/medical-guide) — demo guide for medical AI agent use case.",
    {},
    getMedicalGuideHandler,
  );

  // Work requests
  r.registerTool(
    "list_work_requests",
    "List work requests (/api/work-requests) — paginated list of submitted work requests.",
    {
      limit: z.number().optional().describe("Maximum number of results (default: 20)"),
      offset: z.number().optional().describe("Pagination offset (default: 0)"),
    },
    listWorkRequestsHandler,
  );

  r.registerTool(
    "get_work_request",
    "Get a work request by ID (/api/work-requests/{id}) — returns the full work request details.",
    {
      id: z.string().describe("Work request ID"),
    },
    getWorkRequestHandler,
  );

  r.registerTool(
    "create_work_request",
    "Create a work request (/api/work-requests) — submit a new work request for agent processing.",
    {
      title: z.string().describe("Work request title"),
      description: z.string().describe("Work request description"),
      contact: z.string().optional().describe("Contact information"),
      budget: z.string().optional().describe("Budget for the work request"),
    },
    createWorkRequestHandler,
  );

  // Agent by DID
  r.registerTool(
    "get_agent_by_did",
    "Get agent details by DID (/agents/{did}) — returns the agent's directory entry with capabilities, tier, and endpoint.",
    {
      did: z.string().describe("Agent DID (e.g. did:hcs:0.0.12345:1)"),
    },
    getAgentByDidHandler,
  );

  // Agency services & contact (SLICE-56-9)
  r.registerTool(
    "get_services_info",
    "Fetch the canonical agency profile (/agency.json) — machine-readable JSON with schema_version, registry_version, services, capabilities, people, and endpoints. Use this to programmatically reason about services and capabilities.",
    {},
    getServicesInfoHandler,
  );

  r.registerTool(
    "contact_us",
    "Fetch contact information and routing (/agent-guide/team/contact) — provides contact details and inquiry routing for the agency.",
    {},
    contactUsHandler,
  );
}
