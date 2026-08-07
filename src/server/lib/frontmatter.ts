/**
 * Minimal YAML-like frontmatter parser for Markdown articles.
 * Extracts `---` delimited block at the start of a .md file.
 * Supports simple key: value and key: [list] syntax.
 */

export interface ArticleFrontmatter {
  related_capabilities?: string[];
  related_services?: string[];
  [key: string]: unknown;
}

export interface ParsedArticle {
  frontmatter: ArticleFrontmatter;
  body: string;
}

export function parseFrontmatter(content: string): ParsedArticle {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    return { frontmatter: {}, body: content };
  }

  const raw = fmMatch[1];
  const body = fmMatch[2];
  const frontmatter: ArticleFrontmatter = {};

  const lines = raw.split("\n");
  let currentKey = "";
  let currentList: string[] | null = null;

  for (const line of lines) {
    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch && currentList !== null) {
      currentList.push(listMatch[1].trim());
      continue;
    }

    const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const value = kvMatch[2].trim();

      if (value === "") {
        currentKey = key;
        currentList = [];
        (frontmatter as Record<string, unknown>)[key] = currentList;
      } else {
        currentKey = key;
        currentList = null;
        (frontmatter as Record<string, unknown>)[key] = value;
      }
      continue;
    }
  }

  return { frontmatter, body };
}
