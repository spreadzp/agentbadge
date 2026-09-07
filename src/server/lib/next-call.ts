/**
 * NextCall interface — SLICE-123-3
 *
 * Provides AI-agents with the exact next request to make after a response.
 * Embedded as `next_call` in key API responses.
 */
export interface NextCall {
  method: string;
  path: string;
  body?: object;
  authorization?: string;
  why: string;
  repeat_every_s?: number;
  until?: string;
}
