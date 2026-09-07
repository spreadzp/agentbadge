import { describe, it, expect } from "vitest";
import { Hono } from "hono";

// SLICE-123-1: Test agents.json (JSON Feed 1.1) and agents.rss (RSS 2.0)

interface MockDirectoryEntry {
  did: string;
  tokenId: string;
  serial: number;
  accountId: string;
  name: string;
  capabilities: string[];
  endpoint: string;
  tier: string;
  timestamp: number;
  skills?: string[];
}

const mockAgents: MockDirectoryEntry[] = [
  {
    did: "did:hedera:0.0.123",
    tokenId: "0.0.456",
    serial: 1,
    accountId: "0.0.123",
    name: "TestAgent Alpha",
    capabilities: ["api_call", "data_provide"],
    endpoint: "https://alpha.example.com",
    tier: "basic",
    timestamp: 1700000000,
  },
  {
    did: "did:hedera:0.0.456",
    tokenId: "0.0.789",
    serial: 2,
    accountId: "0.0.456",
    name: "TestAgent Beta",
    capabilities: ["orchestration", "payment"],
    endpoint: "https://beta.example.com",
    tier: "premium",
    timestamp: 1700001000,
    skills: ["web_search", "code_review"],
  },
];

function createFeedApp() {
  const app = new Hono();
  const baseUrl = "https://agentbadge.xyz";

  app.get("/agents.json", () => {
    const feed = {
      version: "https://jsonfeed.org/version/1.1",
      title: "AgentBadge — Registered Agents",
      description: "Directory of AI agents registered on AgentBadge with on-chain passports on Hedera.",
      home_page_url: baseUrl,
      feed_url: `${baseUrl}/agents.json`,
      items: mockAgents.map((a) => ({
        id: a.did,
        url: `${baseUrl}/agents/${encodeURIComponent(a.did)}`,
        title: a.name,
        content_text: `Agent: ${a.name}\nDID: ${a.did}\nCapabilities: ${a.capabilities.join(", ")}\nTier: ${a.tier}\nEndpoint: ${a.endpoint}`,
        date_published: new Date(a.timestamp * 1000).toISOString(),
        tags: a.capabilities,
      })),
    };
    return new Response(JSON.stringify(feed, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60",
      },
    });
  });

  app.get("/agents.rss", () => {
    function escapeXml(s: string): string {
      return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
    }
    const items = mockAgents
      .map((a) => {
        const link = `${baseUrl}/agents/${encodeURIComponent(a.did)}`;
        const pubDate = new Date(a.timestamp * 1000).toUTCString();
        return `    <item>
      <title>${escapeXml(a.name)}</title>
      <link>${link}</link>
      <description>${escapeXml(`DID: ${a.did}, Capabilities: ${a.capabilities.join(", ")}, Tier: ${a.tier}`)}</description>
      <guid>${a.did}</guid>
      <pubDate>${pubDate}</pubDate>
    </item>`;
      })
      .join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>AgentBadge — Registered Agents</title>
    <link>${baseUrl}</link>
    <description>Directory of AI agents registered on AgentBadge with on-chain passports on Hedera.</description>
    <language>en</language>
${items}
  </channel>
</rss>`;
    return new Response(xml, {
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "public, max-age=60",
      },
    });
  });

  return app;
}

describe("SLICE-123-1: /agents.json (JSON Feed 1.1)", () => {
  const app = createFeedApp();

  it("returns 200", async () => {
    const res = await app.request("/agents.json");
    expect(res.status).toBe(200);
  });

  it("returns application/json content type", async () => {
    const res = await app.request("/agents.json");
    expect(res.headers.get("Content-Type")).toContain("application/json");
  });

  it("returns valid parseable JSON", async () => {
    const res = await app.request("/agents.json");
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it("has version field set to JSON Feed 1.1 URL", async () => {
    const res = await app.request("/agents.json");
    const data = await res.json();
    expect(data.version).toBe("https://jsonfeed.org/version/1.1");
  });

  it("has title field", async () => {
    const res = await app.request("/agents.json");
    const data = await res.json();
    expect(data.title).toContain("AgentBadge");
  });

  it("has items array", async () => {
    const res = await app.request("/agents.json");
    const data = await res.json();
    expect(Array.isArray(data.items)).toBe(true);
  });

  it("items have id, url, title, content_text, date_published", async () => {
    const res = await app.request("/agents.json");
    const data = await res.json();
    const item = data.items[0];
    expect(item).toHaveProperty("id");
    expect(item).toHaveProperty("url");
    expect(item).toHaveProperty("title");
    expect(item).toHaveProperty("content_text");
    expect(item).toHaveProperty("date_published");
  });

  it("item id is the agent DID", async () => {
    const res = await app.request("/agents.json");
    const data = await res.json();
    expect(data.items[0].id).toBe("did:hedera:0.0.123");
  });

  it("has feed_url field", async () => {
    const res = await app.request("/agents.json");
    const data = await res.json();
    expect(data.feed_url).toContain("/agents.json");
  });

  it("has home_page_url field", async () => {
    const res = await app.request("/agents.json");
    const data = await res.json();
    expect(data).toHaveProperty("home_page_url");
  });
});

describe("SLICE-123-1: /agents.rss (RSS 2.0)", () => {
  const app = createFeedApp();

  it("returns 200", async () => {
    const res = await app.request("/agents.rss");
    expect(res.status).toBe(200);
  });

  it("returns application/rss+xml content type", async () => {
    const res = await app.request("/agents.rss");
    expect(res.headers.get("Content-Type")).toContain("application/rss+xml");
  });

  it("returns valid XML starting with <?xml", async () => {
    const res = await app.request("/agents.rss");
    const text = await res.text();
    expect(text.startsWith("<?xml")).toBe(true);
  });

  it("has <rss version='2.0'>", async () => {
    const res = await app.request("/agents.rss");
    const text = await res.text();
    expect(text).toContain("<rss");
    expect(text).toContain('version="2.0"');
  });

  it("has <channel> with title", async () => {
    const res = await app.request("/agents.rss");
    const text = await res.text();
    expect(text).toContain("<channel>");
    expect(text).toContain("<title>AgentBadge");
  });

  it("has <item> entries", async () => {
    const res = await app.request("/agents.rss");
    const text = await res.text();
    expect(text).toContain("<item>");
  });

  it("items have <title>, <link>, <description>, <guid>, <pubDate>", async () => {
    const res = await app.request("/agents.rss");
    const text = await res.text();
    expect(text).toContain("<title>");
    expect(text).toContain("<link>");
    expect(text).toContain("<description>");
    expect(text).toContain("<guid>");
    expect(text).toContain("<pubDate>");
  });

  it("has Cache-Control header", async () => {
    const res = await app.request("/agents.rss");
    expect(res.headers.get("Cache-Control")).toContain("max-age=60");
  });
});
