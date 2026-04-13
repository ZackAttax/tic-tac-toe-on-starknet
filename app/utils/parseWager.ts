/**
 * Decodes `get_wager` RPC payloads from Starknet.js / provider shapes.
 * Variable-length `game_params` is handled by reading the array length from the flat felt stream.
 */
import { normalizeAddress } from "@/utils/address";
import type { GameId } from "@/utils/ultimateTicTacToe";
import { toUint64BigInt } from "@/utils/getGameParse";

const devWarn = (...args: unknown[]) => {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.warn(...args);
  }
};

const toScalarString = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (
    typeof v === "number" ||
    typeof v === "bigint" ||
    typeof v === "boolean"
  ) {
    return String(v);
  }
  return "";
};

const toHexAddress = (v: unknown): string => {
  try {
    const b = BigInt(toScalarString(v));
    return "0x" + b.toString(16);
  } catch {
    return String(v);
  }
};

const ZERO_PAD = normalizeAddress("0x0");

function isEffectivelyZeroAddress(addr: string): boolean {
  if (!addr) return true;
  const n = normalizeAddress(addr);
  return n === ZERO_PAD || n === normalizeAddress("0x00");
}

/**
 * Nested-object decoder only: require an explicit value and a normalizable Starknet address.
 * When `allowZero` is false, the zero address is rejected (invalid for that slot).
 */
function parseNestedAddressField(
  value: unknown,
  allowZero: boolean
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  let normalized: string;
  try {
    normalized = normalizeAddress(toHexAddress(value));
  } catch {
    return null;
  }
  if (!normalized) return null;
  if (!allowZero && isEffectivelyZeroAddress(normalized)) return null;
  return normalized;
}

export type WagerStatusTag =
  | "Open"
  | "Matched"
  | "Resolved"
  | "Cancelled"
  | "Expired";

const STATUS_ORDER: WagerStatusTag[] = [
  "Open",
  "Matched",
  "Resolved",
  "Cancelled",
  "Expired",
];

function statusFromDiscriminant(d: number): WagerStatusTag | null {
  if (!Number.isInteger(d) || d < 0 || d >= STATUS_ORDER.length) return null;
  return STATUS_ORDER[d]!;
}

export type WagerRecordParsed = {
  wager_id: bigint;
  status: WagerStatusTag;
  config: {
    game_adapter: string;
    token: string;
    stake: bigint;
    deadlines: { accept_by: bigint; resolve_by: bigint };
    designated_opponent: string;
    game_params: bigint[];
  };
  creator: string;
  opponent: string;
  match_ref: { adapter: string; match_id: bigint };
};

/** Cairo u128 in a single felt — best-effort for stake limbs. */
function feltToU128(v: unknown): bigint | null {
  const s = toScalarString(v);
  if (s === "") return null;
  try {
    const n = BigInt(s);
    if (n < 0n) return null;
    return n;
  } catch {
    return null;
  }
}

function readU256LoHi(low: unknown, high: unknown): bigint | null {
  const a = feltToU128(low);
  const b = feltToU128(high);
  if (a === null || b === null) return null;
  return (b << 128n) + a;
}

function parseWagerRecordFromFlat(values: unknown[]): WagerRecordParsed | null {
  if (values.length < 14) {
    devWarn("[parseWager] flat too short", values.length);
    return null;
  }

  let i = 0;
  const wager_id = toUint64BigInt(values[i++]);
  const statusDisc = Number(toScalarString(values[i++]));
  const status = statusFromDiscriminant(statusDisc);
  if (wager_id === null || status === null) return null;

  const game_adapter = normalizeAddress(toHexAddress(values[i++]));
  const token = normalizeAddress(toHexAddress(values[i++]));
  const stake = readU256LoHi(values[i++], values[i++]);
  const accept_by = toUint64BigInt(values[i++]);
  const resolve_by = toUint64BigInt(values[i++]);
  const designated_opponent = normalizeAddress(toHexAddress(values[i++]));
  const paramsLenRaw = values[i++];
  let paramsLen = Number(toScalarString(paramsLenRaw));
  if (!Number.isInteger(paramsLen) || paramsLen < 0) {
    devWarn("[parseWager] bad game_params length", paramsLenRaw);
    return null;
  }
  if (i + paramsLen + 4 > values.length) {
    devWarn("[parseWager] truncated at game_params", {
      need: i + paramsLen + 4,
      have: values.length,
    });
    return null;
  }
  const game_params: bigint[] = [];
  for (let p = 0; p < paramsLen; p++) {
    const f = values[i++];
    try {
      game_params.push(BigInt(toScalarString(f)));
    } catch {
      devWarn("[parseWager] bad game_params felt", p);
      return null;
    }
  }

  const creator = normalizeAddress(toHexAddress(values[i++]));
  const opponent = normalizeAddress(toHexAddress(values[i++]));
  const match_adapter = normalizeAddress(toHexAddress(values[i++]));
  const match_id = toUint64BigInt(values[i++]);

  if (stake === null || accept_by === null || resolve_by === null || match_id === null) {
    return null;
  }

  if (i !== values.length) {
    devWarn("[parseWager] trailing felts (fail-closed)", values.length - i);
    return null;
  }

  return {
    wager_id,
    status,
    config: {
      game_adapter,
      token,
      stake,
      deadlines: { accept_by, resolve_by },
      designated_opponent,
      game_params,
    },
    creator,
    opponent,
    match_ref: { adapter: match_adapter, match_id },
  };
}

function tryParseWagerFromNestedObject(raw: unknown): WagerRecordParsed | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!("wager_id" in o) || !("status" in o) || !("config" in o)) return null;

  const wager_id = toUint64BigInt(o.wager_id);
  if (wager_id === null) return null;

  let status: WagerStatusTag | null = null;
  if (typeof o.status === "string" && STATUS_ORDER.includes(o.status as WagerStatusTag)) {
    status = o.status as WagerStatusTag;
  } else {
    status = statusFromDiscriminant(Number(toScalarString(o.status)));
  }
  if (status === null) return null;

  const cfgRaw = o.config;
  if (cfgRaw == null || typeof cfgRaw !== "object" || Array.isArray(cfgRaw)) return null;
  const c = cfgRaw as Record<string, unknown>;
  if (!("game_adapter" in c) || !("token" in c) || !("designated_opponent" in c)) {
    return null;
  }
  const dl = c.deadlines;
  if (dl == null || typeof dl !== "object" || Array.isArray(dl)) return null;
  const dlr = dl as Record<string, unknown>;

  const stakeRaw = c.stake;
  let stake: bigint | null = null;
  if (stakeRaw == null) {
    return null;
  }
  if (typeof stakeRaw === "object" && !Array.isArray(stakeRaw)) {
    const sr = stakeRaw as Record<string, unknown>;
    stake = readU256LoHi(sr.low, sr.high);
  } else {
    try {
      stake = BigInt(toScalarString(stakeRaw));
      if (stake < 0n) stake = null;
    } catch {
      stake = null;
    }
  }
  if (stake === null) return null;

  const accept_by = toUint64BigInt(dlr.accept_by);
  const resolve_by = toUint64BigInt(dlr.resolve_by);
  if (accept_by === null || resolve_by === null) return null;

  if (!("game_params" in c) || !Array.isArray(c.game_params)) {
    return null;
  }
  const game_params: bigint[] = [];
  for (const x of c.game_params) {
    try {
      game_params.push(BigInt(toScalarString(x)));
    } catch {
      return null;
    }
  }

  const mrRaw = o.match_ref;
  if (mrRaw == null || typeof mrRaw !== "object" || Array.isArray(mrRaw)) return null;
  const mr = mrRaw as Record<string, unknown>;
  if (!("adapter" in mr)) return null;
  if (!("creator" in o) || !("opponent" in o)) return null;

  const game_adapter = parseNestedAddressField(c.game_adapter, false);
  const token = parseNestedAddressField(c.token, false);
  const designated_opponent = parseNestedAddressField(c.designated_opponent, true);
  const creator = parseNestedAddressField(o.creator, false);
  const opponent = parseNestedAddressField(o.opponent, true);
  const match_adapter = parseNestedAddressField(mr.adapter, true);

  if (
    game_adapter === null ||
    token === null ||
    designated_opponent === null ||
    creator === null ||
    opponent === null ||
    match_adapter === null
  ) {
    return null;
  }

  const match_id = toUint64BigInt(mr.match_id);
  if (match_id === null) return null;

  return {
    wager_id,
    status,
    config: {
      game_adapter,
      token,
      stake,
      deadlines: { accept_by, resolve_by },
      designated_opponent,
      game_params,
    },
    creator,
    opponent,
    match_ref: {
      adapter: match_adapter,
      match_id,
    },
  };
}

/**
 * Normalize starknet.js / RPC return shapes for `get_wager`.
 */
export function parseCallContractWagerResult(raw: unknown): WagerRecordParsed | null {
  const direct = tryParseWagerFromNestedObject(raw);
  if (direct) return direct;

  let values: unknown[] = [];
  if (Array.isArray(raw)) {
    values = raw;
  } else if (raw !== null && typeof raw === "object" && "result" in raw) {
    const res = (raw as { result: unknown }).result;
    if (Array.isArray(res)) {
      values = res;
    } else {
      const nested = tryParseWagerFromNestedObject(res);
      if (nested) return nested;
    }
  }

  if (values.length === 1 && values[0] != null && typeof values[0] === "object") {
    const nested = tryParseWagerFromNestedObject(values[0]);
    if (nested) return nested;
  }

  if (values.length > 0) {
    return parseWagerRecordFromFlat(values);
  }

  if (typeof __DEV__ !== "undefined" && __DEV__) {
    const top =
      raw === null ? "null" : Array.isArray(raw) ? "array" : typeof raw;
    devWarn("[get_wager] could not parse result", { topType: top });
  }
  return null;
}

/**
 * Derive TicTacToe `game_id` from escrow state using `match_ref` only (not `WagerStatus`).
 * Returns null when there is no match yet or protocol invariants fail.
 */
export function getLinkedGameIdFromWagerRecord(
  rec: WagerRecordParsed
): GameId | null {
  if (rec.match_ref.match_id === 0n) return null;
  if (isEffectivelyZeroAddress(rec.match_ref.adapter)) return null;
  if (isEffectivelyZeroAddress(rec.config.game_adapter)) return null;
  if (rec.match_ref.adapter !== rec.config.game_adapter) {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      devWarn("[getLinkedGameId] match_ref.adapter != config.game_adapter");
    }
    return null;
  }
  return rec.match_ref.match_id.toString();
}
