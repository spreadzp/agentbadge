/**
 * Changelog route — GET /changelog
 * SLICE-18-11: Public SSR changelog page (freshness signal for GEO).
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Layout } from "../../views/layout";
import { PageMeta } from "../lib/page-meta";
import { defaultCoreSchemas } from "../lib/json-ld";
import { BUILD_DATE, GIT_COMMIT } from "../lib/build-info";

export const changelogRoutes = new Hono();

interface ChangelogEntry {
  date: string;
  version?: string;
  title: string;
  items: string[];
}

function parseChangelog(): ChangelogEntry[] {
  const candidates = [
    resolve(process.cwd(), "../../CHANGELOG.md"),
    resolve(process.cwd(), "../../../CHANGELOG.md"),
    resolve(process.cwd(), "CHANGELOG.md"),
  ];

  let content: string | null = null;
  for (const p of candidates) {
    if (existsSync(p)) {
      content = readFileSync(p, "utf-8");
      break;
    }
  }

  if (!content) {
    return [
      {
        date: BUILD_DATE,
        title: "No changelog found",
        items: ["Changelog file not found. Build date: " + BUILD_DATE],
      },
    ];
  }

  const entries: ChangelogEntry[] = [];
  const lines = content.split("\n");
  let current: ChangelogEntry | null = null;

  for (const line of lines) {
    // Heading level 2: ## YYYY-MM-DD ...
    const h2 = line.match(/^## (\d{4}-\d{2}-\d{2})(?:\s+[—-]\s+(.+))?$/);
    if (h2) {
      if (current) entries.push(current);
      current = {
        date: h2[1],
        title: h2[2] ?? h2[1],
        items: [],
      };
      continue;
    }

    // List items
    if (current && line.match(/^\s*[-*]\s+/)) {
      const item = line.replace(/^\s*[-*]\s+/, "").trim();
      if (item) current.items.push(item);
    }
  }

  if (current) entries.push(current);

  return entries.filter((e) => e.items.length > 0);
}

changelogRoutes.get(
  "/changelog",
  describeRoute({
    tags: ["Content"],
    summary: "Changelog page — public SSR changelog (GEO freshness signal)",
    description:
      "Returns a server-rendered HTML changelog page with version entries parsed from CHANGELOG.md, newest first.",
    responses: {
      200: { description: "HTML changelog page" },
    },
  }),
  (c) => {
    const entries = parseChangelog();
    const meta = PageMeta["/changelog"];

    const entriesHtml = entries
      .map(
        (e) => `
      <article class="rounded-lg border border-slate-800 bg-slate-900 p-6">
        <div class="flex items-center gap-3">
          <time datetime="${e.date}" class="text-sm font-mono text-emerald-400">${e.date}</time>
          <h2 class="text-lg font-semibold text-white">${e.title}</h2>
        </div>
        <ul class="mt-4 space-y-2 text-sm text-slate-300">
          ${e.items.map((item) => `<li class="flex gap-2"><span class="text-emerald-400">▸</span><span>${item}</span></li>`).join("\n")}
        </ul>
      </article>`,
      )
      .join("\n");

    const html = `
      <div class="mx-auto max-w-3xl">
        <div class="mb-8">
          <span class="inline-block rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">Changelog · Build ${GIT_COMMIT}</span>
          <h1 class="mt-4 text-3xl font-semibold text-white">Changelog</h1>
          <p class="mt-2 text-slate-400">All notable changes to AgentBadge, newest first. Dates in ISO 8601.</p>
        </div>
        <div class="space-y-6">
          ${entriesHtml}
        </div>
      </div>`;

    return c.html(Layout(html, meta?.title, meta, defaultCoreSchemas()).toString());
  },
);
