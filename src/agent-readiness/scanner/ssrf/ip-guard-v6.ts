/** IPv6 text expansion helpers (split out of ip-guard.ts for the
 *  300-line file cap). */

/** Expand any IPv6 textual form (compressed `::`, dotted-quad tail,
 *  mixed case) into 8 hextets; null on malformed input. Needed for
 *  prefix checks — literal-regex matching misses compressed forms
 *  (`fd::1` vs `fd00::`, `0:0:0:0:0:ffff:7f00:1` vs `::ffff:127.0.0.1`). */
export function expandIpv6ToHextets(ip: string): number[] | null {
  const normalized = unbracketV6(ip).toLowerCase();
  let head = normalized;
  const v4Tail: number[] = [];
  const dotMatch = normalized.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotMatch) {
    const octs = dotMatch[1].split(".").map(Number);
    if (octs.some((o) => o > 255)) return null;
    v4Tail.push((octs[0] << 8) | octs[1], (octs[2] << 8) | octs[3]);
    head = normalized.slice(0, dotMatch.index);
    if (head.endsWith(":") && !head.endsWith("::")) head = head.slice(0, -1);
  }
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":").filter((s) => s.length) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":").filter((s) => s.length) : [];
  const hexRe = /^[0-9a-f]{1,4}$/;
  if (![...left, ...right].every((h) => hexRe.test(h))) return null;
  if (halves.length === 1) {
    if (left.length + v4Tail.length !== 8) return null;
    return [...left.map((h) => parseInt(h, 16)), ...v4Tail];
  }
  const missing = 8 - left.length - right.length - v4Tail.length;
  if (missing < 0) return null;
  return [
    ...left.map((h) => parseInt(h, 16)),
    ...new Array<number>(missing).fill(0),
    ...right.map((h) => parseInt(h, 16)),
    ...v4Tail,
  ];
}

export function hextetsToV4(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/** WHATWG URL keeps brackets on IPv6 hostnames
 *  (new URL("http://[::1]/").hostname === "[::1]") — normalize before
 *  range checks or every bracketed literal bypasses the guard. */
export function unbracketV6(ip: string): string {
  return ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
}
