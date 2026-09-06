/**
 * SLICE-103-3: Statistics utilities — pure math functions.
 *
 * All functions are deterministic, no side effects.
 * Percentiles use linear interpolation (same method as numpy's default).
 */

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  return percentile(values, 50);
}

export function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Percentile using linear interpolation (numpy default method).
 * @param values - array of numbers
 * @param p - percentile (0-100)
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];

  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;

  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Bucketize a value into a range string.
 * e.g. bucketize(72, 10, 0, 100) → "70-80"
 */
export function bucketize(value: number, bucketSize: number, min: number, max: number): string {
  const clamped = Math.max(min, Math.min(max, value));
  // Edge case: value at max goes into the last bucket
  if (clamped >= max) {
    const lastBucketStart = max - bucketSize;
    return `${lastBucketStart}-${max}`;
  }
  const bucketStart = Math.floor((clamped - min) / bucketSize) * bucketSize + min;
  const bucketEnd = bucketStart + bucketSize;
  return `${bucketStart}-${bucketEnd}`;
}
