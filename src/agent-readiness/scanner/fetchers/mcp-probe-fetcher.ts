export interface McpProbeResult {
  source: "mcp-probe";
  data: {
    initialize: {
      status: number;
      protocolVersion?: string;
      capabilities?: Record<string, unknown>;
      serverInfo?: { name?: string; version?: string };
    };
    toolsList: {
      status: number;
      tools: Array<{ name: string; inputSchema?: Record<string, unknown> }>;
    };
    toolsCall: {
      status: number;
      result?: unknown;
    };
    sse: {
      status: number;
      supported: boolean;
    };
    cors: {
      status: number;
      allowOrigin: string | null;
    };
  };
}

type FetchFn = typeof fetch;

export async function fetchMcpProbe(
  baseUrl: string,
  fetchFn?: FetchFn,
): Promise<McpProbeResult> {
  const url = `${baseUrl}/mcp`;
  const _fetch = fetchFn ?? fetch;

  // 1. initialize
  let initialize: McpProbeResult["data"]["initialize"] = { status: 0 };
  try {
    const initResp = await _fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "agentbadge-cli", version: "1.0.0" },
        },
      }),
    });
    initialize.status = initResp.status;
    if (initResp.ok) {
      const text = await initResp.text();
      const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
      const json = dataLine ? JSON.parse(dataLine.slice(6)) : JSON.parse(text);
      initialize.protocolVersion = json.result?.protocolVersion;
      initialize.capabilities = json.result?.capabilities;
      initialize.serverInfo = json.result?.serverInfo;
    }
  } catch {
    // keep defaults
  }

  // 2. tools/list
  let toolsList: McpProbeResult["data"]["toolsList"] = { status: 0, tools: [] };
  try {
    const tlResp = await _fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 2 }),
    });
    toolsList.status = tlResp.status;
    if (tlResp.ok) {
      const text = await tlResp.text();
      const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
      const json = dataLine ? JSON.parse(dataLine.slice(6)) : JSON.parse(text);
      toolsList.tools = json.result?.tools ?? [];
    }
  } catch {
    // keep defaults
  }

  // 3. tools/call (call first tool if available)
  let toolsCall: McpProbeResult["data"]["toolsCall"] = { status: 0 };
  try {
    const firstTool = toolsList.tools[0];
    if (firstTool) {
      const tcResp = await _fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          id: 3,
          params: { name: firstTool.name, arguments: {} },
        }),
      });
      toolsCall.status = tcResp.status;
      if (tcResp.ok) {
        const text = await tcResp.text();
        const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
        toolsCall.result = dataLine ? JSON.parse(dataLine.slice(6)) : JSON.parse(text);
      }
    }
  } catch {
    // keep defaults
  }

  // 4. SSE check
  let sse: McpProbeResult["data"]["sse"] = { status: 0, supported: false };
  try {
    const sseResp = await _fetch(url, {
      headers: { Accept: "text/event-stream" },
    });
    sse.status = sseResp.status;
    sse.supported = sseResp.ok && (sseResp.headers.get("content-type") ?? "").includes("text/event-stream");
  } catch {
    // keep defaults
  }

  // 5. CORS check
  let cors: McpProbeResult["data"]["cors"] = { status: 0, allowOrigin: null };
  try {
    const corsResp = await _fetch(url, { method: "OPTIONS" });
    cors.status = corsResp.status;
    cors.allowOrigin = corsResp.headers.get("access-control-allow-origin");
  } catch {
    // keep defaults
  }

  return { source: "mcp-probe", data: { initialize, toolsList, toolsCall, sse, cors } };
}
