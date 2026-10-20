/**
 * SLICE-200-01: regression tests for MCP parity tools.
 *
 * F2 — get_team must hit /agent-guide/team (was broken path).
 * F3 — text/html responses are converted to readable text
 *      (htmlToText in getEndpoint), JSON passes through raw.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { createNamespace, type NamespaceRegistry } from "@agentbadge/mcp";
import { registerParityTools } from "../../src/mcp/parity-tools";

function makeNs(): NamespaceRegistry {
  const ns = createNamespace(`test-parity-${Math.random().toString(36).slice(2)}`);
  registerParityTools(ns);
  return ns;
}

describe("SLICE-200-01 F2: get_team targets /agent-guide/team", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches the /agent-guide/team endpoint", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ members: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const ns = makeNs();
    const result = await ns.handleHttpToolCall("get_team", {});

    expect(result.isError).toBeFalsy();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toMatch(/\/agent-guide\/team$/);
  });
});

describe("SLICE-200-01 F3: htmlToText conversion in getEndpoint", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("converts HTML response to readable text (tags stripped, entities decoded)", async () => {
    const html = [
      "<html><head><style>body{color:red}</style><script>evil()</script></head>",
      "<body><h1>Team &amp; Roles</h1>",
      "<ul><li>Alice</li><li>Bob&nbsp;Smith</li></ul>",
      "<p>Contact&nbsp;us</p></body></html>",
    ].join("");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(html, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      ),
    );

    const ns = makeNs();
    const result = await ns.handleHttpToolCall("get_team", {});
    const text = result.content[0].text;

    expect(result.isError).toBeFalsy();
    expect(text).not.toContain("<");
    expect(text).not.toContain("evil()");
    expect(text).not.toContain("color:red");
    expect(text).toContain("Team & Roles");
    expect(text).toContain("- Alice");
    expect(text).toContain("- Bob Smith");
    expect(text).toContain("Contact us");
  });

  it("passes JSON responses through unchanged", async () => {
    const json = JSON.stringify({ team: ["alice", "bob"] });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(json, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const ns = makeNs();
    const result = await ns.handleHttpToolCall("get_team", {});

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe(json);
  });

  it("marks non-ok responses as errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 500 })),
    );

    const ns = makeNs();
    const result = await ns.handleHttpToolCall("get_team", {});
    expect(result.isError).toBe(true);
  });
});
