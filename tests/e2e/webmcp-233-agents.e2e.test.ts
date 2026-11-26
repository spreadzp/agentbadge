import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { Hono } from "hono";
import { agentsPageTools } from "../../src/server/lib/agent-interaction/webmcp-page-tools";

/**
 * SLICE-233-6: /for-agents — the keyless WebMCP carrier page.
 * webmcpPageScope injects exactly the 5 agent-interaction tools;
 * execute() runs through the real route surface (fetch bridge onto
 * app.request, webmcp-v2-inbox precedent).
 *
 * Locks: exactly-5 roster, feature-detect no-op, zero agb_ in page
 * context (D-233-8), REST parity of discover + search-knowledge,
 * webmcp.json cross-link.
 */

const AGENT_TOOLS = [
  "discover",
  "search-agent-qa",
  "search-knowledge",
  "poll-request",
  "submit-request",
];

let app: Hono;
let realFetch: typeof fetch;
const fetches: string[] = [];

beforeAll(async () => {
  const { createApp } = await import("../../src/server/index");
  app = createApp();
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.startsWith("/")) {
      fetches.push(url);
      return app.request(url, init as never) as unknown as Response;
    }
    return realFetch(input, init);
  }) as typeof fetch;
}, 60000);

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("GET /for-agents — injected tool shelf", () => {
  it("injects registerTool for exactly the 5 keyless tools", async () => {
    const res = await app.request("/for-agents");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();

    // Feature-detect: no modelContext → plain page, no errors (the
    // inject script is gated on 'modelContext' in document).
    expect(html).toContain("if ('modelContext' in document)");

    const names = [
      ...html.matchAll(/registerTool\(\{\s*name:\s*"([^"]+)"/g),
    ].map((m) => m[1]);
    expect(names).toEqual(AGENT_TOOLS);
  });

  it("page-context script carries no agb_ credential (D-233-8)", async () => {
    const res = await app.request("/for-agents");
    const html = await res.text();
    // The injected block starts at the feature-detect gate — slice to
    // the actual registerTool script, not the page prose around it.
    const start = html.indexOf("if ('modelContext' in document)");
    const script = html.slice(start, html.indexOf("</script>", start));
    // The invariant is a keyless CONTEXT: no key value, no auth header.
    // (The word "agb_" may appear in prose descriptions — what must
    // never appear is a credential or a way to present one.)
    expect(script).not.toMatch(/agb_[A-Za-z0-9_-]{16,}/);
    expect(script.toLowerCase()).not.toContain("authorization");
    expect(script).not.toContain("verified-agent");
  });
});

describe("tool execute() → REST parity", () => {
  const exec = async (name: string, args: Record<string, unknown>) =>
    (await agentsPageTools()
      .find((t) => t.name === name)!
      .execute(args, { signal: new AbortController().signal })) as Record<
      string,
      unknown
    >;

  it("discover → agent-interaction manifest (roster + rest_equivalent)", async () => {
    const out = await exec("discover", {});
    expect(fetches.at(-1)).toBe(
      "/.well-known/agent-interaction.json?src=webmcp",
    );
    expect(out.mcp_endpoint).toBe("/mcp/agent-interaction");
    const tools = out.tools as { name: string; status: string }[];
    expect(tools.some((t) => t.name === "agentbadge_search_knowledge")).toBe(
      true,
    );
    // next_call guidance attached (D-256-Q19 contract).
    expect(out.next_call).toBeDefined();
  });

  it("search-knowledge → /api/v1/agent/knowledge/search results shape", async () => {
    const out = await exec("search-knowledge", { query: "escrow settlement" });
    expect(fetches.at(-1)).toContain("/api/v1/agent/knowledge/search?");
    expect(fetches.at(-1)).toContain("q=escrow+settlement");
    expect(fetches.at(-1)).toContain("src=webmcp");
    expect(Array.isArray(out.results)).toBe(true);
    expect(out.query).toBe("escrow settlement");
  });

  it("search-knowledge rejects short query client-side (no fetch)", async () => {
    const before = fetches.length;
    const out = await exec("search-knowledge", { query: "x" });
    expect(out.code).toBe("invalid_input");
    expect(fetches.length).toBe(before);
  });
});

describe("GET /.well-known/webmcp.json — cross-link", () => {
  it("lists the new tools + points at agent-interaction manifest", async () => {
    const res = await app.request("/.well-known/webmcp.json");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tools: { name: string }[];
      agentInteractionManifest: string;
    };
    expect(body.agentInteractionManifest).toBe(
      "/.well-known/agent-interaction.json",
    );
    const names = body.tools.map((t) => t.name);
    expect(names).toContain("discover");
    expect(names).toContain("search-knowledge");
    expect(names).toContain("submit-request");
  });
});
