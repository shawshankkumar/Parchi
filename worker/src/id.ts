// opencode-style, time-sortable ID generator (TypeScript port).
// Format per CONTRACT.md:
//   "cmt_" + 12 hex chars (6 bytes = Date.now() * 0x1000 + counter)
//            + 14 base62 random
//   = 26 chars total (after the "cmt_" prefix).
//
// Monotonic within a millisecond, so `ORDER BY id` == chronological order.
// Port of https://github.com/anomalyco/opencode/blob/dev/packages/app/src/utils/id.ts
// with prefix "cmt". Uses crypto.getRandomValues (available in Workers runtime).

const PREFIX = "cmt";
const HEX_LENGTH = 12; // 6 bytes => 12 hex chars
const RANDOM_LENGTH = 14; // base62 random suffix
const BASE62 =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// State for monotonic generation within a single isolate/ms.
let lastTimestamp = 0;
let counter = 0;

function randomBase62(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += BASE62[bytes[i] % 62];
  }
  return out;
}

/**
 * Generate a new time-sortable id, e.g. "cmt_018f3c2a9b00aZ9x...".
 */
export function newId(now: number = Date.now()): string {
  // Bump the counter when called repeatedly within the same millisecond so
  // that ids stay strictly increasing (and therefore chronologically sortable).
  if (now > lastTimestamp) {
    lastTimestamp = now;
    counter = 0;
  } else {
    counter++;
  }

  // 6-byte time component: Date.now() * 0x1000 + counter (12-bit counter room).
  // Build a 48-bit value as a hex string. BigInt keeps full precision since
  // (Date.now() * 0x1000) exceeds Number.MAX_SAFE_INTEGER headroom concerns.
  const value = BigInt(now) * 0x1000n + BigInt(counter & 0xfff);
  let hex = value.toString(16);
  if (hex.length > HEX_LENGTH) {
    // Keep the low 12 hex chars (48 bits) — still monotonic in practice.
    hex = hex.slice(-HEX_LENGTH);
  } else {
    hex = hex.padStart(HEX_LENGTH, "0");
  }

  return `${PREFIX}_${hex}${randomBase62(RANDOM_LENGTH)}`;
}

/** Cheap shape check for a comment id. */
export function isCommentId(id: string): boolean {
  return (
    typeof id === "string" &&
    id.startsWith(`${PREFIX}_`) &&
    id.length === PREFIX.length + 1 + HEX_LENGTH + RANDOM_LENGTH
  );
}
