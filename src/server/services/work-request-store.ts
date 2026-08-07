/**
 * In-memory Work Request Store (MVP).
 *
 * SLICE-46-9: Stores work requests with status flow.
 * Status: received → human_review → needs_information → accepted/declined → completed
 */

export type WorkRequestStatus =
  | "received"
  | "human_review"
  | "needs_information"
  | "accepted"
  | "declined"
  | "completed";

export interface WorkRequestData {
  title: string;
  summary: string;
  requirements?: string[];
}

export interface WorkRequestRecord {
  id: string;
  status: WorkRequestStatus;
  request: WorkRequestData;
  preferred_contact?: { channel: string };
  created_at: string;
  updated_at: string;
}

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
