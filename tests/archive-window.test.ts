/**
 * SLICE-217-5 tests: archive window math (pure, no IO).
 *
 * Covered:
 *  - floorToUtcDay / floorToUtcWeek UTC boundaries
 *  - computeWindow daily/weekly: null cursor, due/not-due, catch-up
 *  - parseExplicitWindow validation
 *  - DST-insensitivity (UTC only), month/year boundaries
 */
import { describe, it, expect } from "vitest";

import {
  computeWindow,
  floorToUtcDay,
  floorToUtcWeek,
  parseExplicitWindow,
} from "../src/server/lib/report/archive-window";

const DAY = 86_400_000;
const iso = (s: string) => Date.parse(s);

describe("floorToUtcDay", () => {
  it("floors to UTC midnight", () => {
    expect(floorToUtcDay(iso("2026-11-10T15:42:37Z"))).toBe(
      iso("2026-11-10T00:00:00Z"),
    );
  });

  it("already-at-midnight is idempotent", () => {
    const midnight = iso("2026-11-10T00:00:00Z");
    expect(floorToUtcDay(midnight)).toBe(midnight);
  });

  it("handles month boundary (Nov 30 → Dec 1 unaffected)", () => {
    expect(floorToUtcDay(iso("2026-11-30T23:59:59Z"))).toBe(
      iso("2026-11-30T00:00:00Z"),
    );
  });

  it("handles year boundary", () => {
    expect(floorToUtcDay(iso("2026-12-31T23:59:59Z"))).toBe(
      iso("2026-12-31T00:00:00Z"),
    );
  });
});

describe("floorToUtcWeek", () => {
  it("floors Monday-anchored weeks (default)", () => {
    // 2026-11-11 is a Wednesday
    expect(floorToUtcWeek(iso("2026-11-11T15:00:00Z"))).toBe(
      iso("2026-11-09T00:00:00Z"),
    );
  });

  it("Sunday belongs to the week started on previous Monday", () => {
    // 2026-11-15 is a Sunday
    expect(floorToUtcWeek(iso("2026-11-15T23:59:59Z"))).toBe(
      iso("2026-11-09T00:00:00Z"),
    );
  });

  it("Monday itself floors to itself", () => {
    expect(floorToUtcWeek(iso("2026-11-09T00:00:00Z"))).toBe(
      iso("2026-11-09T00:00:00Z"),
    );
  });

  it("supports alternative week start (Sunday)", () => {
    // 2026-11-11 Wed with Sunday-start → floor = 2026-11-08
    expect(floorToUtcWeek(iso("2026-11-11T15:00:00Z"), 0)).toBe(
      iso("2026-11-08T00:00:00Z"),
    );
  });
});

describe("computeWindow daily", () => {
  const now = iso("2026-11-10T12:00:00Z"); // Tuesday noon UTC

  it("null cursor → yesterday 00:00–24:00 UTC", () => {
    expect(computeWindow("daily", null, now)).toEqual({
      from: iso("2026-11-09T00:00:00Z"),
      to: iso("2026-11-10T00:00:00Z"),
    });
  });

  it("cursor at yesterday's end, mid-day now → today not complete → null", () => {
    const cursorThrough = iso("2026-11-10T00:00:00Z");
    expect(computeWindow("daily", cursorThrough, now)).toBeNull();
  });

  it("cursor at yesterday's end, after midnight → today window due", () => {
    const cursorThrough = iso("2026-11-10T00:00:00Z");
    const justAfter = iso("2026-11-11T00:00:01Z");
    expect(computeWindow("daily", cursorThrough, justAfter)).toEqual({
      from: iso("2026-11-10T00:00:00Z"),
      to: iso("2026-11-11T00:00:00Z"),
    });
  });

  it("boundary: now=23:59 → today still incomplete", () => {
    const cursorThrough = iso("2026-11-10T00:00:00Z");
    const beforeMidnight = iso("2026-11-10T23:59:59Z");
    expect(computeWindow("daily", cursorThrough, beforeMidnight)).toBeNull();
  });

  it("catch-up: cursor 5 days behind → returns FIRST unsent day, not freshest", () => {
    const cursorThrough = iso("2026-11-05T00:00:00Z"); // Nov 5 end-of-day
    expect(computeWindow("daily", cursorThrough, now)).toEqual({
      from: iso("2026-11-05T00:00:00Z"),
      to: iso("2026-11-06T00:00:00Z"),
    });
  });

  it("mid-day cursor (seeded at now) normalizes to containing day", () => {
    // Seed throughAt=now Wed 15:00 → window = that whole day once complete
    const seeded = iso("2026-11-10T15:00:00Z");
    const nextDay = iso("2026-11-11T01:00:00Z");
    expect(computeWindow("daily", seeded, nextDay)).toEqual({
      from: iso("2026-11-10T00:00:00Z"),
      to: iso("2026-11-11T00:00:00Z"),
    });
  });

  it("to is exclusive — consecutive windows never overlap", () => {
    const w1 = computeWindow("daily", null, now);
    expect(w1).not.toBeNull();
    const w2 = computeWindow("daily", w1!.to, w1!.to + DAY);
    expect(w2).toEqual({ from: w1!.to, to: w1!.to + DAY });
  });
});

describe("computeWindow weekly", () => {
  // 2026-11-10 is a Tuesday, week = Mon 2026-11-09 .. Sun 2026-11-15
  const midWeek = iso("2026-11-11T12:00:00Z"); // Wednesday

  it("null cursor → previous complete Mon–Sun week", () => {
    expect(computeWindow("weekly", null, midWeek)).toEqual({
      from: iso("2026-11-02T00:00:00Z"),
      to: iso("2026-11-09T00:00:00Z"),
    });
  });

  it("current week incomplete → null", () => {
    const cursorThrough = iso("2026-11-09T00:00:00Z"); // Mon
    expect(computeWindow("weekly", cursorThrough, midWeek)).toBeNull();
  });

  it("next Monday → previous week due", () => {
    const cursorThrough = iso("2026-11-09T00:00:00Z");
    const nextMonday = iso("2026-11-16T00:00:01Z");
    expect(computeWindow("weekly", cursorThrough, nextMonday)).toEqual({
      from: iso("2026-11-09T00:00:00Z"),
      to: iso("2026-11-16T00:00:00Z"),
    });
  });

  it("mid-week cursor normalizes to week start", () => {
    const seeded = iso("2026-11-11T15:00:00Z"); // Wed mid-week
    const afterWeek = iso("2026-11-16T12:00:00Z");
    expect(computeWindow("weekly", seeded, afterWeek)).toEqual({
      from: iso("2026-11-09T00:00:00Z"),
      to: iso("2026-11-16T00:00:00Z"),
    });
  });

  it("catch-up: cursor 3 weeks behind → first unsent week", () => {
    const cursorThrough = iso("2026-10-26T00:00:00Z"); // Mon
    expect(computeWindow("weekly", cursorThrough, midWeek)).toEqual({
      from: iso("2026-10-26T00:00:00Z"),
      to: iso("2026-11-02T00:00:00Z"),
    });
  });
});

describe("parseExplicitWindow", () => {
  it("parses valid ISO pair", () => {
    expect(parseExplicitWindow("2026-11-01T00:00:00Z", "2026-11-08T00:00:00Z"))
      .toEqual({
        from: iso("2026-11-01T00:00:00Z"),
        to: iso("2026-11-08T00:00:00Z"),
      });
  });

  it("accepts date-only ISO", () => {
    const w = parseExplicitWindow("2026-11-01", "2026-11-02");
    expect(w.from).toBe(iso("2026-11-01T00:00:00Z"));
    expect(w.to).toBe(iso("2026-11-02T00:00:00Z"));
  });

  it("throws on garbage input", () => {
    expect(() => parseExplicitWindow("not-a-date", "2026-11-08")).toThrow();
    expect(() => parseExplicitWindow("2026-11-01", "zzz")).toThrow();
  });

  it("throws when from >= to", () => {
    expect(() =>
      parseExplicitWindow("2026-11-08", "2026-11-01"),
    ).toThrow();
    expect(() =>
      parseExplicitWindow("2026-11-01", "2026-11-01"),
    ).toThrow();
  });
});
