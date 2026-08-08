const AI_BOTS = [
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Google-Agent",
  "Google-CloudVertexBot",
  "Meta-ExternalAgent",
  "Meta-ExternalFetcher",
  "MistralAI-User",
  "Applebot",
  "Applebot-Extended",
  "Amazonbot",
  "bingbot",
  "DuckAssistBot",
  "CCBot",
  "Bytespider",
];

export interface RobotsTxtOptions {
  allowAll?: boolean;
  disallow?: string[];
  allow?: string[];
  sitemap?: string;
}

export function generateRobotsTxt(opts: RobotsTxtOptions): string {
  const disallowSet = new Set(opts.disallow ?? []);
  const allowSet = new Set(opts.allow ?? []);

  const lines: string[] = [];

  for (const bot of AI_BOTS) {
    lines.push(`User-agent: ${bot}`);
    if (disallowSet.has(bot)) {
      lines.push("Disallow: /");
    } else if (allowSet.has(bot) || opts.allowAll) {
      lines.push("Allow: /");
    }
    lines.push("");
  }

  if (opts.sitemap) {
    lines.push(`Sitemap: ${opts.sitemap}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}
