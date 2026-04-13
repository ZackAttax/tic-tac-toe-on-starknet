/**
 * Escrow `require_known_wager` panics with short string `unknown` for invalid ids.
 * Use to separate “wager does not exist” from generic RPC / parse failures.
 */
export function errorIndicatesUnknownWager(error: unknown): boolean {
  const s = error instanceof Error ? error.message : String(error);
  if (s.length < 3) return false;
  if (/timeout|ECONNREFUSED|network|fetch failed|502|503|504/i.test(s)) return false;
  if (!/\bunknown\b/i.test(s)) return false;
  return /panic|revert|execution|assert|fail|contract|starknet|rpc|error/i.test(s);
}
