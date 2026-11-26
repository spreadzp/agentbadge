/**
 * EPIC-232 (SLICE-232-1, O1): versioned prompt registry.
 *
 * Prompts live as `lib/ai/prompts/<scenario>.md`; the content hash
 * (`sha256` first 12 hex) is stamped into `AiRun.promptVersion` so
 * agreement history stays comparable across prompt edits (landmine:
 * prompt drift). Files are lazily read + cached; a missing file
 * returns null — scenario runners decide whether a prompt is
 * required or constructed programmatically.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "prompts");

export function promptVersionFor(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
}

export interface LoadedPrompt {
  text: string;
  version: string;
}

const cache = new Map<string, LoadedPrompt | null>();

/**
 * Load `prompts/<scenario>.md`. `dir` override exists for tests and
 * for runners that keep prompts elsewhere — defaults to the registry
 * directory next to this module.
 */
export function loadPrompt(
  scenario: string,
  dir: string = PROMPTS_DIR,
): LoadedPrompt | null {
  const key = `${dir}:${scenario}`;
  if (cache.has(key)) return cache.get(key)!;
  let loaded: LoadedPrompt | null = null;
  try {
    const text = readFileSync(join(dir, `${scenario}.md`), "utf8");
    if (text.trim().length > 0) {
      loaded = { text, version: promptVersionFor(text) };
    }
  } catch {
    // ENOENT → no prompt registered for this scenario yet.
    loaded = null;
  }
  cache.set(key, loaded);
  return loaded;
}

/** Test hook — prompt contents are cached process-wide. */
export function resetPromptCache(): void {
  cache.clear();
}
