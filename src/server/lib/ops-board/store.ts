/**
 * SLICE-198-1: ops taskboard — read-only scan of a Backlog.md store.
 *
 * OPS_BOARD_DIR points at a backlog root containing `tasks/*.md`
 * (YAML frontmatter + markdown body). We parse frontmatter only —
 * bodies are never loaded into memory or rendered. Parse failures
 * are counted in `skipped`, never thrown: the board must stay up.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export interface BoardTask {
  id: string;
  title: string;
  status: string;
  priority: "high" | "medium" | "low" | "";
  labels: string[];
  milestone: string | null;
  assignee: string[];
  dependencies: string[];
  ordinal: number;
  updatedDate: string;
  /** Optional — not part of Backlog.md schema; mocked tasks may carry it. */
  budget: number | null;
}

export interface EpicStat {
  epic: string;
  total: number;
  done: number;
}

export interface BoardData {
  tasks: BoardTask[];
  /** Statuses in canonical order first, then extras alphabetically. */
  statuses: string[];
  labels: string[];
  milestones: string[];
  epicStats: EpicStat[];
  scannedAt: number;
  /** Files that failed frontmatter/YAML parsing. */
  skipped: number;
}

export interface BoardFilters {
  status?: string;
  label?: string;
  milestone?: string;
  epic?: string;
  assignee?: string;
  q?: string;
  /** Wallet/passport/handle — marks "my" tasks, does NOT filter them out. */
  me?: string;
  budgetMin?: number;
  budgetMax?: number;
}

export type BoardSort = "priority" | "budget_asc" | "budget_desc" | "updated";

/**
 * "My tasks" match: user enters wallet address / passport id / assignee
 * handle — matched case-insensitively as substring against assignee
 * entries, labels and task id (substring so 0x-prefixed partial
 * addresses and passport slugs hit).
 */
export function isMineTask(t: BoardTask, me: string | undefined): boolean {
  if (!me) return false;
  const needle = me.trim().toLowerCase();
  if (!needle) return false;
  return (
    t.assignee.some((a) => a.toLowerCase().includes(needle)) ||
    t.labels.some((l) => l.toLowerCase().includes(needle)) ||
    t.id.toLowerCase().includes(needle)
  );
}

const STATUS_ORDER = ["Draft", "To Do", "In Progress", "Testing", "Done"];
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const FRONT_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

function asStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

// Legacy tasks store labels as one comma-joined string ("a, b, c")
// instead of a YAML array — split so filters/epic-stats work on both.
function asLabels(v: unknown): string[] {
  if (typeof v === "string") v = [v];
  return asStrArray(v)
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

function toTask(fm: Record<string, unknown>): BoardTask {
  const priority = String(fm.priority ?? "").toLowerCase();
  const budget = Number(fm.budget);
  return {
    id: String(fm.id ?? ""),
    title: String(fm.title ?? ""),
    status: String(fm.status ?? "To Do"),
    priority: priority === "high" || priority === "medium" || priority === "low"
      ? priority
      : "",
    labels: asLabels(fm.labels),
    milestone: fm.milestone != null ? String(fm.milestone) : null,
    assignee: asStrArray(fm.assignee),
    dependencies: asStrArray(fm.dependencies),
    ordinal: Number(fm.ordinal) || 0,
    updatedDate: String(fm.updated_date ?? ""),
    budget: Number.isFinite(budget) && fm.budget != null ? budget : null,
  };
}

// SAST note: `dir` is ops-controlled (OPS_BOARD_DIR env), never request
// input; `file` values come from readdir of that dir and are `.md`-filtered.
export async function scanBoard(dir: string): Promise<BoardData> {
  const tasks: BoardTask[] = [];
  let skipped = 0;
  let files: string[] = [];
  try {
    files = (await readdir(join(dir, "tasks"))).filter((f) =>
      f.endsWith(".md"),
    );
  } catch {
    // No tasks dir — empty board, not an error (env may point at a
    // partially-initialised backlog).
  }
  for (const file of files) {
    try {
      const raw = await readFile(join(dir, "tasks", file), "utf8");
      const m = FRONT_RE.exec(raw);
      if (!m) {
        skipped++;
        continue;
      }
      const fm = parseYaml(m[1]) as Record<string, unknown> | null;
      if (!fm || typeof fm !== "object") {
        skipped++;
        continue;
      }
      tasks.push(toTask(fm));
    } catch {
      skipped++;
    }
  }

  const statusSet = new Set(tasks.map((t) => t.status));
  const statuses = [
    ...STATUS_ORDER.filter((s) => statusSet.has(s)),
    ...[...statusSet].filter((s) => !STATUS_ORDER.includes(s)).sort(),
  ];
  const labels = [...new Set(tasks.flatMap((t) => t.labels))].sort();
  const milestones = [
    ...new Set(tasks.map((t) => t.milestone).filter((m): m is string => !!m)),
  ].sort();

  const epicMap = new Map<string, EpicStat>();
  for (const t of tasks) {
    for (const l of t.labels) {
      if (!/^epic-/i.test(l)) continue;
      const s = epicMap.get(l) ?? { epic: l, total: 0, done: 0 };
      s.total++;
      if (t.status === "Done") s.done++;
      epicMap.set(l, s);
    }
  }

  return {
    tasks,
    statuses,
    labels,
    milestones,
    epicStats: [...epicMap.values()].sort((a, b) =>
      a.epic.localeCompare(b.epic),
    ),
    scannedAt: Date.now(),
    skipped,
  };
}

export function filterTasks(
  tasks: BoardTask[],
  f: BoardFilters,
): BoardTask[] {
  const q = f.q?.trim().toLowerCase();
  return tasks.filter((t) => {
    if (f.status && t.status !== f.status) return false;
    if (f.label && !t.labels.includes(f.label)) return false;
    if (f.epic && !t.labels.some((l) => l === f.epic)) return false;
    if (f.milestone && t.milestone !== f.milestone) return false;
    if (f.assignee && !t.assignee.includes(f.assignee)) return false;
    if (
      q &&
      !t.title.toLowerCase().includes(q) &&
      !t.id.toLowerCase().includes(q)
    ) {
      return false;
    }
    if (f.budgetMin != null || f.budgetMax != null) {
      if (t.budget == null) return false;
      if (f.budgetMin != null && t.budget < f.budgetMin) return false;
      if (f.budgetMax != null && t.budget > f.budgetMax) return false;
    }
    return true;
  });
}

export function sortTasks(tasks: BoardTask[], sort: BoardSort): BoardTask[] {
  const byOrdinal = (a: BoardTask, b: BoardTask) => a.ordinal - b.ordinal;
  const arr = [...tasks];
  switch (sort) {
    case "budget_asc":
      return arr.sort(
        (a, b) => (a.budget ?? Infinity) - (b.budget ?? Infinity),
      );
    case "budget_desc":
      return arr.sort(
        (a, b) => (b.budget ?? -Infinity) - (a.budget ?? -Infinity),
      );
    case "updated":
      return arr.sort((a, b) => b.updatedDate.localeCompare(a.updatedDate));
    case "priority":
    default:
      return arr.sort(
        (a, b) =>
          (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3) ||
          byOrdinal(a, b),
      );
  }
}

export interface BoardStore {
  getBoard(): Promise<BoardData>;
  /** Number of real fs scans performed (test/diag hook). */
  scanSeq(): number;
}

export function createBoardStore(dir: string, cacheMs = 30_000): BoardStore {
  let cache: { data: BoardData; expiresAt: number } | null = null;
  let seq = 0;
  return {
    async getBoard() {
      const now = Date.now();
      if (cache && now < cache.expiresAt) return cache.data;
      const data = await scanBoard(dir);
      seq++;
      cache = { data, expiresAt: now + cacheMs };
      return data;
    },
    scanSeq() {
      return seq;
    },
  };
}
