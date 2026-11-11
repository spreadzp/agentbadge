/**
 * SLICE-217-5: archive window math — pure calendar-window computation
 * for the Telegram archive/digest pipeline (EPIC-217, D-217-8).
 *
 * Windows are fixed `[from, to)` in unix ms over UTC calendar periods.
 * Only fully completed periods are ever returned — a digest/archive is
 * always for a whole day or whole Mon–Sun week, never a partial one.
 * No IO, no clock access: `now` is injectable everywhere.
 */

export type StreamKind = "daily" | "weekly";

/** Half-open window [from, to) in unix ms. `to` is exclusive. */
export type ArchiveWindow = { from: number; to: number };

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Floor a timestamp to UTC midnight (00:00:00.000Z). */
export function floorToUtcDay(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Floor a timestamp to the start of its UTC week.
 * `weekStartsOn` uses getUTCDay numbering: 0 = Sunday, 1 = Monday.
 */
export function floorToUtcWeek(ts: number, weekStartsOn = 1): number {
  const dayFloor = floorToUtcDay(ts);
  const dow = new Date(dayFloor).getUTCDay();
  const offset = (dow - weekStartsOn + 7) % 7;
  return dayFloor - offset * DAY_MS;
}

/**
 * Next archive window for a stream, given its committed cursor
 * (`throughAt` = exclusive upper bound of the last sent window).
 *
 * Semantics:
 *  - `cursorThrough === null` → the last fully completed period
 *    (yesterday for daily, last Mon–Sun week for weekly).
 *  - Otherwise the first period-aligned window starting at the floor
 *    of `cursorThrough` — if that window's `to` is still in the future,
 *    returns `null` (not due yet). Mid-period cursors (e.g. a fresh
 *    seed of `throughAt = now`) normalize to the containing period.
 *  - A lagging cursor yields the OLDEST unsent window, one per call —
 *    catch-up proceeds window-by-window with no gaps.
 */
export function computeWindow(
  kind: StreamKind,
  cursorThrough: number | null,
  now: number,
): ArchiveWindow | null {
  const period = kind === "daily" ? DAY_MS : WEEK_MS;
  const floor =
    kind === "daily" ? floorToUtcDay : (t: number) => floorToUtcWeek(t);

  if (cursorThrough === null) {
    const to = floor(now);
    return { from: to - period, to };
  }

  const from = floor(cursorThrough);
  const to = from + period;
  return to <= now ? { from, to } : null;
}

/**
 * Parse an ad-hoc `[from, to)` window from ISO strings (CLI use).
 * Throws on unparsable input or when from >= to.
 */
export function parseExplicitWindow(
  fromIso: string,
  toIso: string,
): ArchiveWindow {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from)) {
    throw new Error(`archive-window: unparseable --from "${fromIso}"`);
  }
  if (!Number.isFinite(to)) {
    throw new Error(`archive-window: unparseable --to "${toIso}"`);
  }
  if (from >= to) {
    throw new Error(
      `archive-window: from (${fromIso}) must be before to (${toIso})`,
    );
  }
  return { from, to };
}
