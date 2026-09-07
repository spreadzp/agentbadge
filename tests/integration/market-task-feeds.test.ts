import { describe, it, expect } from "vitest";
import { Hono } from "hono";

// SLICE-123-2: Test /market/tasks.json (JSON Feed 1.1) and /market/tasks.rss (RSS 2.0)

interface MockTask {
  taskId: string;
  posterDid: string;
  title: string;
  description: string;
  status: string;
  reward: number;
  createdAt: number;
  capabilities: string[];
}

const mockTasks: MockTask[] = [
  {
    taskId: "01JTEST001",
    posterDid: "did:hedera:0.0.123",
    title: "Data Analysis Task",
    description: "Analyze medical dataset for anomalies",
    status: "posted",
    reward: 50,
    createdAt: 1700000000,
    capabilities: ["data_analysis", "medical"],
  },
  {
    taskId: "01JTEST002",
    posterDid: "did:hedera:0.0.456",
    title: "Web Scraping Task",
    description: "Scrape product data from e-commerce site",
    status: "posted",
    reward: 25,
    createdAt: 1700001000,
    capabilities: ["web_scraping"],
  },
  {
    taskId: "01JTEST003",
    posterDid: "did:hedera:0.0.789",
    title: "Cancelled Task",
    description: "This should not appear",
    status: "cancelled",
    reward: 10,
    createdAt: 1700002000,
    capabilities: ["test"],
  },
];

function createMarketFeedApp() {
  const app = new Hono();
  const baseUrl = "https://agentbadge.xyz";

  app.get("/market/tasks.json", () => {
    const openTasks = mockTasks.filter((t) => t.status === "posted");
    const feed = {
      version: "https://jsonfeed.org/version/1.1",
      title: "AgentBadge — Marketplace Tasks",
      description: "Open marketplace tasks available for AI agents on AgentBadge.",
      home_page_url: baseUrl,
      feed_url: `${baseUrl}/market/tasks.json`,
      items: openTasks.map((t) => ({
        id: t.taskId,
        url: `${baseUrl}/market/tasks/${t.taskId}`,
        title: t.title,
        content_text: `Task: ${t.title}\nPosted by: ${t.posterDid}\nReward: ${t.reward} HBAR\nCapabilities: ${t.capabilities.join(", ")}\nStatus: ${t.status}`,
        date_published: new Date(t.createdAt * 1000).toISOString(),
        tags: t.capabilities,
      })),
    };
    return new Response(JSON.stringify(feed, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60",
      },
    });
  });

  app.get("/market/tasks.rss", () => {
    function escapeXml(s: string): string {
      return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
    }
    const openTasks = mockTasks.filter((t) => t.status === "posted");
    const items = openTasks
      .map((t) => {
        const link = `${baseUrl}/market/tasks/${t.taskId}`;
        const pubDate = new Date(t.createdAt * 1000).toUTCString();
        const desc = `Posted by: ${t.posterDid}, Reward: ${t.reward} HBAR, Capabilities: ${t.capabilities.join(", ")}`;
        return `    <item>
      <title>${escapeXml(t.title)}</title>
      <link>${link}</link>
      <description>${escapeXml(desc)}</description>
      <guid>${t.taskId}</guid>
      <pubDate>${pubDate}</pubDate>
    </item>`;
      })
      .join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>AgentBadge — Marketplace Tasks</title>
    <link>${baseUrl}</link>
    <description>Open marketplace tasks available for AI agents on AgentBadge.</description>
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

describe("SLICE-123-2: /market/tasks.json (JSON Feed 1.1)", () => {
  const app = createMarketFeedApp();

  it("returns 200", async () => {
    const res = await app.request("/market/tasks.json");
    expect(res.status).toBe(200);
  });

  it("returns application/json content type", async () => {
    const res = await app.request("/market/tasks.json");
    expect(res.headers.get("Content-Type")).toContain("application/json");
  });

  it("returns valid parseable JSON", async () => {
    const res = await app.request("/market/tasks.json");
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it("has version field set to JSON Feed 1.1 URL", async () => {
    const res = await app.request("/market/tasks.json");
    const data = await res.json();
    expect(data.version).toBe("https://jsonfeed.org/version/1.1");
  });

  it("has title containing Marketplace Tasks", async () => {
    const res = await app.request("/market/tasks.json");
    const data = await res.json();
    expect(data.title).toContain("Marketplace Tasks");
  });

  it("has items array", async () => {
    const res = await app.request("/market/tasks.json");
    const data = await res.json();
    expect(Array.isArray(data.items)).toBe(true);
  });

  it("only includes open/posted tasks (not cancelled)", async () => {
    const res = await app.request("/market/tasks.json");
    const data = await res.json();
    expect(data.items.length).toBe(2);
    expect(data.items.every((i: { id: string }) => i.id !== "01JTEST003")).toBe(true);
  });

  it("items have id, url, title, content_text, date_published", async () => {
    const res = await app.request("/market/tasks.json");
    const data = await res.json();
    const item = data.items[0];
    expect(item).toHaveProperty("id");
    expect(item).toHaveProperty("url");
    expect(item).toHaveProperty("title");
    expect(item).toHaveProperty("content_text");
    expect(item).toHaveProperty("date_published");
  });

  it("item id is the taskId", async () => {
    const res = await app.request("/market/tasks.json");
    const data = await res.json();
    expect(data.items[0].id).toBe("01JTEST001");
  });

  it("has feed_url field", async () => {
    const res = await app.request("/market/tasks.json");
    const data = await res.json();
    expect(data.feed_url).toContain("/market/tasks.json");
  });
});

describe("SLICE-123-2: /market/tasks.rss (RSS 2.0)", () => {
  const app = createMarketFeedApp();

  it("returns 200", async () => {
    const res = await app.request("/market/tasks.rss");
    expect(res.status).toBe(200);
  });

  it("returns application/rss+xml content type", async () => {
    const res = await app.request("/market/tasks.rss");
    expect(res.headers.get("Content-Type")).toContain("application/rss+xml");
  });

  it("returns valid XML starting with <?xml", async () => {
    const res = await app.request("/market/tasks.rss");
    const text = await res.text();
    expect(text.startsWith("<?xml")).toBe(true);
  });

  it("has <rss version='2.0'>", async () => {
    const res = await app.request("/market/tasks.rss");
    const text = await res.text();
    expect(text).toContain("<rss");
    expect(text).toContain('version="2.0"');
  });

  it("has <channel> with title", async () => {
    const res = await app.request("/market/tasks.rss");
    const text = await res.text();
    expect(text).toContain("<channel>");
    expect(text).toContain("Marketplace Tasks");
  });

  it("has <item> entries for open tasks only", async () => {
    const res = await app.request("/market/tasks.rss");
    const text = await res.text();
    expect(text).toContain("<item>");
    expect(text).not.toContain("Cancelled Task");
  });

  it("items have <title>, <link>, <description>, <guid>, <pubDate>", async () => {
    const res = await app.request("/market/tasks.rss");
    const text = await res.text();
    expect(text).toContain("<title>");
    expect(text).toContain("<link>");
    expect(text).toContain("<description>");
    expect(text).toContain("<guid>");
    expect(text).toContain("<pubDate>");
  });

  it("has Cache-Control header with 60s", async () => {
    const res = await app.request("/market/tasks.rss");
    expect(res.headers.get("Cache-Control")).toContain("max-age=60");
  });
});
