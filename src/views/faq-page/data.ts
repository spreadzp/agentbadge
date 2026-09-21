// EPIC-140 (SLICE-140-20): FAQ data — QaPair + RAW_FAQ_ENTRIES (combined from parts).
import { FAQ_ENTRIES_A } from "./faq-entries-a";
import { FAQ_ENTRIES_B } from "./faq-entries-b";

export interface QaPair {
  question: string;
  answer: string;
}

export const RAW_FAQ_ENTRIES: QaPair[] = [...FAQ_ENTRIES_A, ...FAQ_ENTRIES_B];
