/**
 * Generate a 26-character Crockford Base32 ULID.
 * Time-sortable, unique, no I/L/O/U characters.
 * Matches regex: /^[0-9A-HJKMNP-TV-Z]{26}$/
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENCODING_LEN = 32;
const TIME_LEN = 10;
const RANDOM_LEN = 16;

export function generateReportId(timestamp: number = Date.now()): string {
  return encodeTime(timestamp) + encodeRandom();
}

function encodeTime(now: number): string {
  let str = "";
  let time = now;
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = time % ENCODING_LEN;
    str = ENCODING[mod] + str;
    time = Math.floor(time / ENCODING_LEN);
  }
  return str;
}

function encodeRandom(): string {
  let str = "";
  for (let i = 0; i < RANDOM_LEN; i++) {
    str += ENCODING[Math.floor(Math.random() * ENCODING_LEN)];
  }
  return str;
}
