/**
 * In-memory Work Request Store (MVP).
 *
 * SLICE-46-9: Stores work requests with status flow.
 * Status: received → human_review → needs_information → accepted/declined → completed
 * Types live in lib/work-request-types.ts (EPIC-142-4 layer boundary).
 */

import type {
  WorkRequestData,
  WorkRequestRecord,
  WorkRequestStatus,
} from "../lib/work-request-types";

export type { WorkRequestData, WorkRequestRecord, WorkRequestStatus };

class WorkRequestStore {
  private records = new Map<string, WorkRequestRecord>();
  private counter = 0;

  create(data: WorkRequestData, contact?: { channel: string }): WorkRequestRecord {
    const id = `wr-${++this.counter}-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    const record: WorkRequestRecord = {
      id,
      status: "received",
      request: data,
      preferred_contact: contact,
      created_at: now,
      updated_at: now,
    };
    this.records.set(id, record);
    return record;
  }

  get(id: string): WorkRequestRecord | null {
    return this.records.get(id) ?? null;
  }

  updateStatus(id: string, status: WorkRequestStatus): WorkRequestRecord | null {
    const record = this.records.get(id);
    if (!record) return null;
    record.status = status;
    record.updated_at = new Date().toISOString();
    return record;
  }

  clear(): void {
    this.records.clear();
    this.counter = 0;
  }
}

export const workRequestStore = new WorkRequestStore();
