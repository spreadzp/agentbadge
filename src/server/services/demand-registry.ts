/**
 * Demand Registry — in-memory store for capability demand aggregation.
 *
 * SLICE-46-12: Agents register demand for capabilities the team doesn't list.
 * Same query (normalized) increments count. Priority levels based on count.
 * Demand does NOT auto-create capabilities — human review required.
 */

export type DemandPriority = "backlog" | "candidate" | "priority";

export interface DemandRecord {
  id: string;
  capability_query: string;
  normalized_query: string;
  count: number;
  first_seen: string;
  last_seen: string;
  contexts: string[];
  priority: DemandPriority;
}

class DemandStore {
  private records = new Map<string, DemandRecord>();
  private counter = 0;

  private normalize(query: string): string {
    return query.trim().toLowerCase().replace(/\s+/g, " ");
  }

  private computePriority(count: number): DemandPriority {
    if (count >= 20) return "priority";
    if (count >= 5) return "candidate";
    return "backlog";
  }

  request(capability_query: string, context?: string): DemandRecord {
    const normalized = this.normalize(capability_query);
    const now = new Date().toISOString();
    const existing = this.records.get(normalized);

    if (existing) {
      existing.count += 1;
      existing.last_seen = now;
      existing.priority = this.computePriority(existing.count);
      if (context && !existing.contexts.includes(context)) {
        existing.contexts.push(context);
        if (existing.contexts.length > 50) {
          existing.contexts = existing.contexts.slice(-50);
        }
      }
      return existing;
    }

    const id = `demand-${++this.counter}`;
    const record: DemandRecord = {
      id,
      capability_query,
      normalized_query: normalized,
      count: 1,
      first_seen: now,
      last_seen: now,
      contexts: context ? [context] : [],
      priority: "backlog",
    };
    this.records.set(normalized, record);
    return record;
  }

  get(id: string): DemandRecord | undefined {
    for (const record of this.records.values()) {
      if (record.id === id) return record;
    }
    return undefined;
  }

  list(): DemandRecord[] {
    return Array.from(this.records.values()).sort((a, b) => b.count - a.count);
  }

  clear(): void {
    this.records.clear();
    this.counter = 0;
  }
}

export const demandStore = new DemandStore();
