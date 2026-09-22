/**
 * Work Request domain types (data shapes only).
 *
 * Extracted from services/work-request-store.ts (EPIC-142-4) so that views
 * can import record types without crossing the layer boundary into
 * server/services. Status flow:
 * received → human_review → needs_information → accepted/declined → completed
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
