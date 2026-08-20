import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { clearCommands, runCommand, getCommand } from "../../../../src/agent-readiness/cli/router";
import { registerRobotsCommand, generateRobotsTxt } from "../../../../src/agent-readiness/cli/commands/robots";

let tempDir: string;

beforeEach(async () => {
  clearCommands();
  registerRobotsCommand();
  tempDir = await mkdtemp(join(tmpdir(), "agentbadge-robots-"));
});

describe("generateRobotsTxt", () => {
  it("allow-all mode: includes all 21 AI agents with Allow: /", () => {
    const txt = generateRobotsTxt({
      url: "https://example.com",
      mode: "allow-all",
    });
    const agents = [
      "ClaudeBot", "Claude-SearchBot", "Claude-User",
      "GPTBot", "OAI-SearchBot", "ChatGPT-User",
      "PerplexityBot", "Perplexity-User",
      "Google-Extended", "Google-Agent", "Google-CloudVertexBot",
      "Meta-ExternalAgent", "Meta-ExternalFetcher",
      "MistralAI-User",
      "Applebot", "Applebot-Extended",
      "Amazonbot",
      "bingbot",
      "DuckAssistBot",
      "CCBot",
      "Bytespider",
    ];
    for (const agent of agents) {
      expect(txt).toContain(`User-agent: ${agent}`);
    }
    expect(txt).toContain("Allow: /");
  });

  it("allow-all mode: includes Sitemap line with URL", () => {
    const txt = generateRobotsTxt({
      url: "https://example.com",
      mode: "allow-all",
    });
    expect(txt).toContain("Sitemap: https://example.com/sitemap.xml");
  });

  it("block-training mode: blocks training crawlers with Disallow: /", () => {
    const txt = generateRobotsTxt({
      url: "https://example.com",
      mode: "block-training",
    });
    expect(txt).toContain("User-agent: ClaudeBot");
    expect(txt).toContain("Disallow: /");
    expect(txt).toContain("User-agent: GPTBot");
    expect(txt).toContain("User-agent: Google-Extended");
  });

  it("block-training mode: allows search-index crawlers", () => {
    const txt = generateRobotsTxt({
      url: "https://example.com",
      mode: "block-training",
    });
    expect(txt).toContain("User-agent: PerplexityBot");
    expect(txt).toContain("User-agent: OAI-SearchBot");
    expect(txt).toContain("User-agent: Claude-SearchBot");
  });

  it("both modes include Sitemap line", () => {
    const allowAll = generateRobotsTxt({ url: "https://example.com", mode: "allow-all" });
    const blockTraining = generateRobotsTxt({ url: "https://example.com", mode: "block-training" });
    expect(allowAll).toContain("Sitemap: https://example.com/sitemap.xml");
    expect(blockTraining).toContain("Sitemap: https://example.com/sitemap.xml");
  });

  it("handles URL with trailing slash", () => {
    const txt = generateRobotsTxt({
      url: "https://example.com/",
      mode: "allow-all",
    });
    expect(txt).toContain("Sitemap: https://example.com/sitemap.xml");
    expect(txt).not.toContain("https://example.com//sitemap.xml");
  });
});

describe("robots command registration", () => {
  it("is registered with name 'robots'", () => {
    const cmd = getCommand("robots");
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe("robots");
  });

  it("returns error for missing url argument", async () => {
    const result = await runCommand(["robots"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing required argument");
  });

  it("outputs to stdout by default", async () => {
    const result = await runCommand(["robots", "https://example.com"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("User-agent: ClaudeBot");
    expect(result.stdout).toContain("Sitemap: https://example.com/sitemap.xml");
  });

  it("writes to file with --output", async () => {
    const outputPath = join(tempDir, "robots.txt");
    const result = await runCommand(["robots", "https://example.com", "--output", outputPath]);
    expect(result.exitCode).toBe(0);
    expect(result.outputFile).toBe(outputPath);
    const content = await readFile(outputPath, "utf-8");
    expect(content).toContain("User-agent: ClaudeBot");
    expect(content).toContain("Sitemap: https://example.com/sitemap.xml");
  });

  it("supports --mode block-training", async () => {
    const result = await runCommand(["robots", "https://example.com", "--mode", "block-training"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Disallow: /");
  });
});
