import { normalizeAddress } from "@/utils/address";
import type { WagerRecordParsed } from "@/utils/parseWager";

const ZERO = normalizeAddress("0x0");

/** Latest block time as integer seconds; `bigint` avoids mixing u64 deadlines with lossy `number`. */
function chainNowSecsToBigInt(chainNowUnixSecs: number): bigint | null {
  if (!Number.isFinite(chainNowUnixSecs) || chainNowUnixSecs < 0) {
    return null;
  }
  return BigInt(Math.floor(chainNowUnixSecs));
}

function isZeroDesignated(addr: string): boolean {
  const t = (addr || "").trim();
  if (!t) return true;
  try {
    const n = normalizeAddress(t);
    return n === ZERO;
  } catch {
    /** Invalid address is not the “open” sentinel. */
    return false;
  }
}

export type AcceptEligibility =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "not_open"
        | "creator"
        | "wrong_opponent"
        | "accept_expired"
        | "invalid_clock";
    };

/**
 * Pure check: may this wallet call `escrow.accept(wager_id)` without reverting
 * for opponent / deadline reasons (does not check ERC20 balance or allowance).
 */
export function getAcceptEligibility(
  record: WagerRecordParsed,
  walletAddress: string,
  chainNowUnixSecs: number
): AcceptEligibility {
  const now = chainNowSecsToBigInt(chainNowUnixSecs);
  if (now === null) {
    return { ok: false, reason: "invalid_clock" };
  }
  if (record.status !== "Open") {
    return { ok: false, reason: "not_open" };
  }
  const me = normalizeAddress(walletAddress);
  const creator = normalizeAddress(record.creator);
  if (!me || me === creator) {
    return { ok: false, reason: "creator" };
  }
  const designated = normalizeAddress(record.config.designated_opponent);
  const openOpponent = isZeroDesignated(record.config.designated_opponent);
  if (!openOpponent && designated !== me) {
    return { ok: false, reason: "wrong_opponent" };
  }
  const acceptBy = record.config.deadlines.accept_by;
  if (now > acceptBy) {
    return { ok: false, reason: "accept_expired" };
  }
  return { ok: true };
}

export function canResolveWagerUi(params: {
  status: WagerRecordParsed["status"];
  chainNowUnixSecs: number;
  resolveBy: bigint;
  gameStatus: number;
}): boolean {
  const { status, chainNowUnixSecs, resolveBy, gameStatus } = params;
  if (status !== "Matched") return false;
  const now = chainNowSecsToBigInt(chainNowUnixSecs);
  if (now === null) return false;
  if (now > resolveBy) return false;
  if (gameStatus === 0) return false;
  return true;
}
