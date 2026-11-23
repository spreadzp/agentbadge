// EPIC-140 (SLICE-140-20): FAQ data — QaPair + RAW_FAQ_ENTRIES (combined from parts).
import { FAQ_ENTRIES_A1 } from "./faq-entries-a1";
import { FAQ_ENTRIES_A2 } from "./faq-entries-a2";
import { FAQ_ENTRIES_B1 } from "./faq-entries-b1";
import { FAQ_ENTRIES_B2 } from "./faq-entries-b2";

export interface QaPair {
  question: string;
  answer: string;
}

export const RAW_FAQ_ENTRIES: QaPair[] = [
  ...FAQ_ENTRIES_A1,
  ...FAQ_ENTRIES_A2,
  ...FAQ_ENTRIES_B1,
  ...FAQ_ENTRIES_B2,
];
