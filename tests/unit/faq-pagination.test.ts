import { describe, it, expect } from "vitest";
import {
  paginateFaqEntries,
  FAQ_PER_PAGE,
  getFaqEntries,
  type QaPair,
} from "../../src/views/faq-page";

function makeEntries(n: number): QaPair[] {
  return Array.from({ length: n }, (_, i) => ({
    question: `Question ${i + 1}`,
    answer: `Answer ${i + 1}`,
  }));
}

describe("paginateFaqEntries", () => {
  it("returns at most FAQ_PER_PAGE (8) items for page 1", () => {
    const entries = makeEntries(20);
    const { items, meta } = paginateFaqEntries(entries, 1);
    expect(items.length).toBeLessThanOrEqual(FAQ_PER_PAGE);
    expect(items.length).toBe(8);
    expect(meta.currentPage).toBe(1);
  });

  it("returns correct slice for page 2", () => {
    const entries = makeEntries(20);
    const page1 = paginateFaqEntries(entries, 1);
    const page2 = paginateFaqEntries(entries, 2);
    expect(page2.items[0].question).not.toBe(page1.items[0].question);
    expect(page2.items.length).toBe(8);
    expect(page2.items[0].question).toBe("Question 9");
  });

  it("returns remaining items on last page", () => {
    const entries = makeEntries(10);
    const { items, meta } = paginateFaqEntries(entries, 2);
    expect(meta.totalPages).toBe(2);
    expect(items.length).toBe(2);
    expect(items[0].question).toBe("Question 9");
    expect(items[1].question).toBe("Question 10");
  });

  it("clamps page > totalPages to last page", () => {
    const entries = makeEntries(20);
    const { meta, items } = paginateFaqEntries(entries, 999);
    expect(meta.currentPage).toBe(meta.totalPages);
    expect(meta.currentPage).toBe(3);
    expect(items.length).toBe(4);
  });

  it("clamps page < 1 to page 1", () => {
    const entries = makeEntries(20);
    const { meta } = paginateFaqEntries(entries, 0);
    expect(meta.currentPage).toBe(1);
  });

  it("clamps negative page to page 1", () => {
    const entries = makeEntries(20);
    const { meta } = paginateFaqEntries(entries, -5);
    expect(meta.currentPage).toBe(1);
  });

  it("handles NaN page as page 1", () => {
    const entries = makeEntries(20);
    const { meta } = paginateFaqEntries(entries, NaN);
    expect(meta.currentPage).toBe(1);
  });

  it("sets hasNext/hasPrev correctly on page 1", () => {
    const entries = makeEntries(20);
    const { meta } = paginateFaqEntries(entries, 1);
    expect(meta.hasPrev).toBe(false);
    expect(meta.hasNext).toBe(true);
  });

  it("sets hasNext/hasPrev correctly on middle page", () => {
    const entries = makeEntries(20);
    const { meta } = paginateFaqEntries(entries, 2);
    expect(meta.hasPrev).toBe(true);
    expect(meta.hasNext).toBe(true);
  });

  it("sets hasNext/hasPrev correctly on last page", () => {
    const entries = makeEntries(20);
    const { meta } = paginateFaqEntries(entries, 3);
    expect(meta.hasPrev).toBe(true);
    expect(meta.hasNext).toBe(false);
  });

  it("handles empty array", () => {
    const { items, meta } = paginateFaqEntries([], 1);
    expect(items).toEqual([]);
    expect(meta.totalPages).toBe(1);
    expect(meta.totalArticles).toBe(0);
    expect(meta.hasNext).toBe(false);
    expect(meta.hasPrev).toBe(false);
  });

  it("handles exactly FAQ_PER_PAGE entries (single page)", () => {
    const entries = makeEntries(FAQ_PER_PAGE);
    const { items, meta } = paginateFaqEntries(entries, 1);
    expect(items.length).toBe(FAQ_PER_PAGE);
    expect(meta.totalPages).toBe(1);
    expect(meta.hasNext).toBe(false);
    expect(meta.hasPrev).toBe(false);
  });

  it("calculates totalPages correctly for 9 entries", () => {
    const entries = makeEntries(9);
    const { meta } = paginateFaqEntries(entries, 1);
    expect(meta.totalPages).toBe(2);
    expect(meta.totalArticles).toBe(9);
  });

  it("defaults page param to 1 when undefined", () => {
    const entries = makeEntries(20);
    const { meta } = paginateFaqEntries(entries, undefined);
    expect(meta.currentPage).toBe(1);
  });

  it("works with real FAQ entries from getFaqEntries()", () => {
    const entries = getFaqEntries();
    const { items, meta } = paginateFaqEntries(entries, 1);
    expect(items.length).toBe(FAQ_PER_PAGE);
    expect(meta.totalArticles).toBe(entries.length);
    expect(meta.totalPages).toBe(Math.ceil(entries.length / FAQ_PER_PAGE));
    expect(meta.hasPrev).toBe(false);
    expect(meta.hasNext).toBe(true);
  });
});
