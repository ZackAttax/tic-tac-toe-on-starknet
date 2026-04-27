/**
 * Decodes `get_game` RPC payloads from various Starknet.js / provider shapes.
 * Keep all serialization variance here so UI and hooks stay unaware.
 */
import { normalizeAddress } from "@/utils/address";
import type { BoardSet, Game, GameId, LocalBoard } from "@/utils/ultimateTicTacToe";

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

const toNum = (v: unknown): number => {
  if (typeof v === "bigint") return Number(v);
  const n = Number(toScalarString(v));
  return Number.isFinite(n) ? n : NaN;
};

const U64_MAX = (1n << 64n) - 1n;

/** On-chain `u64` values without lossy conversion to `number` (avoids drift above `MAX_SAFE_INTEGER`). */
export function toUint64BigInt(v: unknown): bigint | null {
  if (typeof v === "bigint") {
    if (v < 0n || v > U64_MAX) return null;
    return v;
  }
  const s = toScalarString(v);
  if (s === "") return null;
  try {
    const n = BigInt(s);
    if (n < 0n || n > U64_MAX) return null;
    return n;
  } catch {
    return null;
  }
}

const toHexAddress = (v: unknown): string => {
  try {
    const b = BigInt(toScalarString(v));
    return "0x" + b.toString(16);
  } catch {
    return String(v);
  }
};

function normalizeLocalBoard(raw: unknown): LocalBoard | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    if (raw.length < 3) return null;
    const x_bits = toNum(raw[0]);
    const o_bits = toNum(raw[1]);
    const status = toNum(raw[2]);
    if (
      !Number.isFinite(x_bits) ||
      !Number.isFinite(o_bits) ||
      !Number.isFinite(status)
    )
      return null;
    return { x_bits, o_bits, status };
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (!("x_bits" in o) || !("o_bits" in o) || !("status" in o)) return null;
    const x_bits = toNum(o.x_bits);
    const o_bits = toNum(o.o_bits);
    const status = toNum(o.status);
    if (
      !Number.isFinite(x_bits) ||
      !Number.isFinite(o_bits) ||
      !Number.isFinite(status)
    )
      return null;
    return { x_bits, o_bits, status };
  }
  return null;
}

/** Fail closed on ambiguous or incomplete shapes. */
export function normalizeBoardSet(raw: unknown): BoardSet | null {
  if (raw == null) {
    devWarn("[normalizeBoardSet] null input");
    return null;
  }

  const BOARD_KEYS = [
    "b0",
    "b1",
    "b2",
    "b3",
    "b4",
    "b5",
    "b6",
    "b7",
    "b8",
  ] as const;

  if (Array.isArray(raw)) {
    if (raw.length === 27) {
      const out: Partial<BoardSet> = {};
      for (let i = 0; i < 9; i++) {
        const lb = normalizeLocalBoard(raw.slice(i * 3, i * 3 + 3));
        if (!lb) {
          devWarn("[normalizeBoardSet] invalid triplet at", i);
          return null;
        }
        const bk = BOARD_KEYS[i]!;
        out[bk] = lb;
      }
      return out as BoardSet;
    }
    if (raw.length === 9) {
      const out: Partial<BoardSet> = {};
      for (let i = 0; i < 9; i++) {
        const lb = normalizeLocalBoard(raw[i]);
        if (!lb) {
          devWarn("[normalizeBoardSet] invalid board at", i);
          return null;
        }
        const bk = BOARD_KEYS[i]!;
        out[bk] = lb;
      }
      return out as BoardSet;
    }
    devWarn("[normalizeBoardSet] bad array length", raw.length);
    return null;
  }

  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const out: Partial<BoardSet> = {};
    for (let i = 0; i < 9; i++) {
      const key = BOARD_KEYS[i]!;
      const alt = o[String(i)];
      const chunk = o[key] ?? alt;
      const lb = normalizeLocalBoard(chunk);
      if (!lb) {
        devWarn("[normalizeBoardSet] missing/invalid", key);
        return null;
      }
      out[key] = lb;
    }
    return out as BoardSet;
  }

  devWarn("[normalizeBoardSet] unsupported shape", typeof raw);
  return null;
}

export const EXPECTED_GET_GAME_FLAT_LEN = 2 + 9 * 3 + 3 + 2; // 34 (+ move_timeout_secs, turn_deadline)

function parseGameFromFlatValues(values: unknown[], gameId: GameId): Game | null {
  if (values.length !== EXPECTED_GET_GAME_FLAT_LEN) {
    devWarn(
      "[parseGame] expected length",
      EXPECTED_GET_GAME_FLAT_LEN,
      "got",
      values.length
    );
    return null;
  }
  const player_x = normalizeAddress(toHexAddress(values[0]));
  const player_o = normalizeAddress(toHexAddress(values[1]));
  const boardsSlice = values.slice(2, 2 + 27);
  const boards = normalizeBoardSet(boardsSlice);
  if (!boards) return null;
  const next_board = toNum(values[29]);
  const turn = toNum(values[30]);
  const status = toNum(values[31]);
  const move_timeout_secs = toUint64BigInt(values[32]);
  const turn_deadline = toUint64BigInt(values[33]);
  if (
    !Number.isFinite(next_board) ||
    !Number.isFinite(turn) ||
    !Number.isFinite(status) ||
    move_timeout_secs === null ||
    turn_deadline === null
  ) {
    return null;
  }
  return {
    player_x,
    player_o,
    boards,
    next_board,
    turn,
    status,
    move_timeout_secs,
    turn_deadline,
    gameId,
  };
}

function tryParseGameFromNestedObject(raw: unknown, gameId: GameId): Game | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!("player_x" in o) || !("player_o" in o) || !("boards" in o)) return null;
  const player_x = normalizeAddress(toHexAddress(o.player_x));
  const player_o = normalizeAddress(toHexAddress(o.player_o));
  const boards = normalizeBoardSet(o.boards);
  if (!boards) return null;
  const next_board = toNum(o.next_board);
  const turn = toNum(o.turn);
  const status = toNum(o.status);
  const move_timeout_secs = toUint64BigInt(o.move_timeout_secs);
  const turn_deadline = toUint64BigInt(o.turn_deadline);
  if (
    !Number.isFinite(next_board) ||
    !Number.isFinite(turn) ||
    !Number.isFinite(status) ||
    move_timeout_secs === null ||
    turn_deadline === null
  ) {
    return null;
  }
  return {
    player_x,
    player_o,
    boards,
    next_board,
    turn,
    status,
    move_timeout_secs,
    turn_deadline,
    gameId,
  };
}

/**
 * Normalize starknet.js / RPC return shapes: top-level struct, `{ result }` as
 * array or struct, or 34-felt flat array.
 */
export function parseCallContractGameResult(
  raw: unknown,
  gameId: GameId
): Game | null {
  const direct = tryParseGameFromNestedObject(raw, gameId);
  if (direct) return direct;

  let values: unknown[] = [];

  if (Array.isArray(raw)) {
    values = raw;
  } else if (raw !== null && typeof raw === "object" && "result" in raw) {
    const res = (raw as { result: unknown }).result;
    if (Array.isArray(res)) {
      values = res;
    } else {
      const fromResult = tryParseGameFromNestedObject(res, gameId);
      if (fromResult) return fromResult;
    }
  }

  if (values.length === 1 && values[0] != null && typeof values[0] === "object") {
    const nested = tryParseGameFromNestedObject(values[0], gameId);
    if (nested) return nested;
  }

  if (values.length === EXPECTED_GET_GAME_FLAT_LEN) {
    return parseGameFromFlatValues(values, gameId);
  }

  if (typeof __DEV__ !== "undefined" && __DEV__) {
    const top =
      raw === null ? "null" : Array.isArray(raw) ? "array" : typeof raw;
    console.warn("[getGame] could not parse result", {
      topType: top,
      valuesLength: values.length,
    });
  }
  return null;
}
