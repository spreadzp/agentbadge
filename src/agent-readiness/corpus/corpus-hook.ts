/**
 * SLICE-103-2: Pipeline hook — fire-and-forget corpus append after scan.
 *
 * This hook MUST NEVER throw — if corpus write fails, the scan response is unaffected.
 */

import type { CorpusStore, CorpusAppendResult } from "./corpus-store";
import { extractCorpusRecord, type CorpusExtractionInput } from "./corpus-extractor";

/**
 * Hook a scan result into the corpus.
 * Fire-and-forget — errors are caught and logged, never thrown.
 */
export async function hookScanToCorpus(
  input: CorpusExtractionInput,
  store: CorpusStore,
): Promise<CorpusAppendResult> {
  try {
    const record = extractCorpusRecord(input);
    return await store.append(record);
  } catch (err) {
    console.warn(`[corpus] Hook error: ${(err as Error).message}`);
    return { success: false, error: (err as Error).message };
  }
}
