/**
 * SLICE-69-10: `agentbadge robots` — AI-Agent-Friendly robots.txt Generator
 */

import { writeFile } from "node:fs/promises";
import {
  registerCommand,
  type CommandResult,
  type ParsedArgs,
  type ParsedFlags,
} from "../router";

const AI_BOTS = [
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
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
] as const;

const TRAINING_BOTS = new Set([
  "ClaudeBot",
  "GPTBot",
  "ChatGPT-User",
  "Google-Extended",
  "Meta-ExternalAgent",
  "Meta-ExternalFetcher",
  "MistralAI-User",
  "Applebot-Extended",
  "Amazonbot",
  "CCBot",
  "Bytespider",
]);

export interface RobotsInput {
  url: string;
  mode: "allow-all" | "block-training";
}

export function registerRobotsCommand(): void {
  registerCommand({
    name: "robots",
    description: "Generate an AI-agent-friendly robots.txt",
    args: [{ name: "url", required: true, description: "Target URL (for sitemap reference)" }],
    flags: [
      { name: "output", shortName: "o", type: "string", description: "Output path (default: stdout)" },
      { name: "mode", shortName: "m", type: "string", description: "Generation mode: allow-all|block-training", default: "allow-all" },
    ],
    handler: robotsHandler,
  });
}

async function robotsHandler(args: ParsedArgs, flags: ParsedFlags): Promise<CommandResult> {
  const url = args.positional[0];
  if (!url) {
    return { exitCode: 1, stdout: "", stderr: "Missing required argument: url" };
  }

  const mode = typeof flags.mode === "string" ? flags.mode : "allow-all";
  const outputPath = typeof flags.output === "string" ? flags.output : undefined;

  if (mode !== "allow-all" && mode !== "block-training") {
    return { exitCode: 1, stdout: "", stderr: `Invalid mode: ${mode}. Use 'allow-all' or 'block-training'.` };
  }

  const txt = generateRobotsTxt({ url, mode: mode as "allow-all" | "block-training" });

  if (outputPath) {
    await writeFile(outputPath, txt, "utf-8");
    return { exitCode: 0, stdout: `robots.txt written to ${outputPath}`, stderr: "", outputFile: outputPath };
  }

  return { exitCode: 0, stdout: txt, stderr: "" };
}

export function generateRobotsTxt(input: RobotsInput): string {
  const baseUrl = input.url.replace(/\/+$/, "");
  const lines: string[] = [];

  for (const bot of AI_BOTS) {
    lines.push(`User-agent: ${bot}`);

    if (input.mode === "allow-all") {
      lines.push("Allow: /");
    } else if (input.mode === "block-training") {
      if (TRAINING_BOTS.has(bot)) {
        lines.push("Disallow: /");
      } else {
        lines.push("Allow: /");
      }
    }

    lines.push("");
  }

  lines.push(`Sitemap: ${baseUrl}/sitemap.xml`);

  return lines.join("\n");
}
