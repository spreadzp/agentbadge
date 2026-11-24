/**
 * EPIC-231 (SLICE-231-8, D-231-5/D7): «→ Backlog task» export —
 * writes a Backlog.md task file for an ACCEPTED opportunity and
 * links it via store.linkBacklogTask → status LINKED.
 *
 * createBacklogTaskWriter allocates the next myproj-NNNN id inside
 * the tasks dir and writes the file atomically ('wx'); the result
 * carries rollback() so a refused CAS never orphans a card.
 * linkDemandBacklog is the shared op both surfaces call; a repeat
 * click on an already-linked row returns the existing taskId
 * without touching the FS (AC#3).
 *
 * The tasks dir is env-configured (DEMAND_BACKLOG_TASKS_DIR) with a
 * repo-relative default — in prod there is no backlog checkout and
 * the gesture refuses loudly instead of writing into the void.
 */

import { mkdirSync } from "node:fs";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildBacklogCard, type BacklogCard, BACKLOG_EXAMPLE_LIMIT } from "./backlog-card";
import { buildBacklogTaskMarkdown } from "./backlog-card";
import { buildDemandEvent, emitDemandHooks } from "./events";
import type { DemandEventInput, DemandStore } from "./store";
import type { DemandOpportunityRecord } from "./types";

// ─── writer ─────────────────────────────────────────────────────

export interface BacklogWriteResult {
  taskId: string;
  filePath: string;
  /** Removes the just-written file — used when the CAS link loses. */
  rollback(): Promise<void>;
}

export interface BacklogTaskWriter {
  write(card: BacklogCard): Promise<BacklogWriteResult>;
}

const ID_RE = /^myproj-(\d+)/i;
const ORDINAL_RE = /^ordinal:\s*(\d+)/m;
const ORDINAL_STEP = 1000;
const ALLOC_ATTEMPTS = 8;

const slugify = (title: string): string =>
  title
    .replace(/[/\\:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);

/**
 * Filesystem writer — scans the tasks dir once per write, takes
 * max(myproj-NNNN)+1, writes 'wx' (fail-if-exists), retries the
 * scan on collision. Id allocation racing `backlog task create`
 * is handled by the retry loop, not by a lock.
 */
export function createBacklogTaskWriter(tasksDir: string): BacklogTaskWriter {
  const scan = async (): Promise<{ nextId: number; nextOrdinal: number }> => {
    mkdirSync(tasksDir, { recursive: true });
    const files = await readdir(tasksDir);
    let maxId = 0;
    let maxOrdinal = 0;
    for (const f of files) {
      const m = ID_RE.exec(f);
      if (m) maxId = Math.max(maxId, Number(m[1]));
      if (!f.endsWith(".md")) continue;
      const head = (await readFile(resolve(tasksDir, f), "utf8")).slice(
        0,
        800,
      );
      const om = ORDINAL_RE.exec(head);
      if (om) maxOrdinal = Math.max(maxOrdinal, Number(om[1]));
    }
    return { nextId: maxId + 1, nextOrdinal: maxOrdinal + ORDINAL_STEP };
  };

  return {
    async write(card) {
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < ALLOC_ATTEMPTS; attempt++) {
        const { nextId, nextOrdinal } = await scan();
        const taskId = `MYPROJ-${nextId}`;
        const filePath = resolve(
          tasksDir,
          `myproj-${nextId} - ${slugify(card.title)}.md`,
        );
        const body = buildBacklogTaskMarkdown(
          taskId,
          card,
          new Date().toISOString(),
          nextOrdinal,
        );
        try {
          await writeFile(filePath, body, { flag: "wx" });
          return {
            taskId,
            filePath,
            rollback: async () => {
              await unlink(filePath).catch(() => {});
            },
          };
        } catch (e) {
          lastErr = e;
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        }
      }
      throw lastErr;
    },
  };
}

/**
 * Tasks-dir resolution: env override, else the monorepo convention
 * <server cwd>/../../../../backlog/tasks. Absent dir is created by
 * the writer (mkdir -p) — a typo'd env still fails at writeFile.
 */
export function defaultBacklogTasksDir(): string {
  return (
    process.env.DEMAND_BACKLOG_TASKS_DIR ??
    resolve(process.cwd(), "../../../../backlog/tasks")
  );
}

export function defaultBacklogWriter(): BacklogTaskWriter {
  return createBacklogTaskWriter(defaultBacklogTasksDir());
}

// ─── op ─────────────────────────────────────────────────────────

export type LinkBacklogResult =
  | {
      ok: true;
      opportunity: DemandOpportunityRecord;
      /** Persisted inside the link tx — input shape, not the row. */
      event: DemandEventInput | null;
      taskId: string;
      /** repeat click — card existed, nothing re-written. */
      alreadyLinked: boolean;
    }
  | {
      ok: false;
      reason:
        | "missing"
        | "illegal_status"
        | "status_mismatch"
        | "already_linked"
        | "write_failed";
    };

/**
 * «→ Backlog task» — ACCEPTED-only gesture. Sequence: guard →
 * write card → CAS link (expected.status=ACCEPTED) → hooks. CAS
 * loss rolls the file back so a raced click never orphans a card;
 * an already-linked row short-circuits before touching the FS.
 */
export async function linkDemandBacklog(
  store: DemandStore,
  opportunityId: string,
  actor: string,
  deps: { writer: BacklogTaskWriter },
): Promise<LinkBacklogResult> {
  const cur = await store.getOpportunity(opportunityId);
  if (!cur) return { ok: false, reason: "missing" };
  if (cur.backlogTaskId !== null) {
    return {
      ok: true,
      opportunity: cur,
      event: null,
      taskId: cur.backlogTaskId,
      alreadyLinked: true,
    };
  }
  if (cur.status !== "ACCEPTED") {
    return { ok: false, reason: "illegal_status" };
  }

  const cluster = await store.getCluster(cur.clusterId);
  const signals = await store.listSignals({
    clusterId: cur.clusterId,
    canonicalOnly: true,
    limit: BACKLOG_EXAMPLE_LIMIT,
  });
  const card = buildBacklogCard(cur, cluster, signals);

  let written: BacklogWriteResult;
  try {
    written = await deps.writer.write(card);
  } catch {
    return { ok: false, reason: "write_failed" };
  }

  const event = buildDemandEvent(
    "demand.opportunity.linked",
    "INTERNAL",
    {
      opportunityId: cur.id,
      backlogTaskId: written.taskId,
      actor,
    },
    `opp-link:${cur.id}:${written.taskId}`,
  );
  const r = await store.linkBacklogTask(
    cur.id,
    written.taskId,
    { status: "ACCEPTED" },
    event,
  );
  if (!r.linked) {
    await written.rollback();
    return {
      ok: false,
      reason: r.reason === "missing" ? "status_mismatch" : r.reason,
    };
  }
  emitDemandHooks("opportunity", cur.id, [event]);
  return {
    ok: true,
    opportunity: r.record,
    event,
    taskId: written.taskId,
    alreadyLinked: false,
  };
}
