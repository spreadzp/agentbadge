// EPIC-140 (SLICE-140-17): semantic-checkers.ts split — one file per checker.
import { type SemanticChecker, parseJsonBody, type OpenApiSpec } from "./helpers";

export const checkerSandboxDeclared: SemanticChecker = (sources) => {
  const guideSnap = sources.guide;
  const openapiSnap = sources.openapi;
  const llmsSnap = sources.llms;
  const hasAnySource = guideSnap || openapiSnap || llmsSnap;
  if (!hasAnySource) return { outcome: "no_source", detail: "No source snapshots available" };

  let sandboxMentioned = false;
  let sandboxUrl = false;

  // Check guide for sandbox/test environment
  const guideBody = guideSnap?.body ?? "";
  if (guideBody) {
    const lower = guideBody.toLowerCase();
    if (lower.includes("sandbox") || lower.includes("test environment") || lower.includes("test mode") || lower.includes("staging")) {
      sandboxMentioned = true;
      // Check for URL pattern
      if (lower.includes("http") && (lower.includes("sandbox") || lower.includes("staging") || lower.includes("test"))) {
        sandboxUrl = true;
      }
      // Check guide JSON for sandbox/testEnvironment field
      const guideJson = parseJsonBody(guideSnap) as Record<string, unknown> | null;
      if (guideJson) {
        const sandbox = (guideJson as Record<string, unknown>).sandbox as Record<string, unknown> | undefined;
        const testEnv = (guideJson as Record<string, unknown>).testEnvironment as Record<string, unknown> | undefined;
        const staging = (guideJson as Record<string, unknown>).staging as Record<string, unknown> | undefined;
        const sandboxObj = sandbox ?? testEnv ?? staging;
        if (sandboxObj) {
          if (typeof sandboxObj === "string" && sandboxObj.includes("http")) sandboxUrl = true;
          if (typeof sandboxObj === "object" && sandboxObj !== null) {
            const url = (sandboxObj as Record<string, unknown>).url as string | undefined;
            const baseUrl = (sandboxObj as Record<string, unknown>).baseUrl as string | undefined;
            if (url?.includes("http") || baseUrl?.includes("http")) sandboxUrl = true;
          }
        }
      }
    }
  }

  // Check OpenAPI servers for sandbox
  if (openapiSnap?.body) {
    const spec = parseJsonBody(openapiSnap) as OpenApiSpec | null;
    if (spec) {
      const servers = (spec as unknown as Record<string, unknown>).servers as Array<Record<string, unknown>> | undefined;
      if (servers) {
        for (const server of servers) {
          const url = server?.url as string | undefined;
          const desc = server?.description as string | undefined;
          if (url && (url.includes("sandbox") || url.includes("staging") || url.includes("test"))) {
            sandboxMentioned = true;
            sandboxUrl = true;
          }
          if (desc && (desc.toLowerCase().includes("sandbox") || desc.toLowerCase().includes("test"))) {
            sandboxMentioned = true;
            if (url) sandboxUrl = true;
          }
        }
      }
    }
  }

  // Check llms.txt for sandbox section
  const llmsBody = llmsSnap?.body ?? "";
  if (llmsBody) {
    const lower = llmsBody.toLowerCase();
    if (lower.includes("sandbox") || lower.includes("test environment") || lower.includes("staging")) {
      sandboxMentioned = true;
      if (lower.includes("http") && (lower.includes("sandbox") || lower.includes("staging"))) {
        sandboxUrl = true;
      }
    }
  }

  if (sandboxMentioned && sandboxUrl) {
    return { outcome: "found", detail: "Sandbox/test environment declared with base URL" };
  }
  if (sandboxMentioned) {
    return { outcome: "partial", detail: "Sandbox mentioned by name but no base URL provided" };
  }
  return { outcome: "absent", detail: "No sandbox or test environment found in any source" };
};

// ─── AB-157: Agent policy machine-readable ──────────────────────────────────
