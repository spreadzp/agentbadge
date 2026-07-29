import { describe, it, expect } from "vitest";
import { Layout } from "../src/views/layout";

describe("Layout — footer", () => {
  it("renders footer with social links", () => {
    const html = Layout("<p>test</p>").toString();

    // Footer element
    expect(html).toContain("<footer");

    // Social links — Discord/Telegram now point to /contact (internal)
    expect(html).toContain('href="/contact"');
    expect(html).toContain('href="https://github.com/hashgraph"');

    // Old external links should NOT be present
    expect(html).not.toContain('href="https://discord.gg/hedera"');
    expect(html).not.toContain('href="https://t.me/hedera"');

    // Aria labels
    expect(html).toContain('aria-label="Discord"');
    expect(html).toContain('aria-label="Telegram"');
    expect(html).toContain('aria-label="GitHub"');
  });

  it("Discord and Telegram links are internal (no target=_blank)", () => {
    const html = Layout("<p>test</p>").toString();

    // Find the Discord link block and verify no target=_blank
    const discordIdx = html.indexOf('aria-label="Discord"');
    const discordBlock = html.substring(discordIdx - 200, discordIdx + 50);
    expect(discordBlock).not.toContain('target="_blank"');

    // Find the Telegram link block and verify no target=_blank
    const telegramIdx = html.indexOf('aria-label="Telegram"');
    const telegramBlock = html.substring(telegramIdx - 200, telegramIdx + 50);
    expect(telegramBlock).not.toContain('target="_blank"');
  });

  it("GitHub link remains external with target=_blank", () => {
    const html = Layout("<p>test</p>").toString();

    const githubIdx = html.indexOf('aria-label="GitHub"');
    const githubBlock = html.substring(githubIdx - 200, githubIdx + 50);
    expect(githubBlock).toContain('target="_blank"');
    expect(githubBlock).toContain('rel="noopener"');
  });

  it("renders project description in footer", () => {
    const html = Layout("<p>test</p>").toString();
    expect(html).toContain("AgentGate");
    expect(html).toContain("Hedera");
  });

  it("footer has consistent slate-* styling", () => {
    const html = Layout("<p>test</p>").toString();
    expect(html).toContain("border-slate-800");
    expect(html).toContain("bg-slate-900");
  });
});
