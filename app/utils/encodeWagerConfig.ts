import { normalizeAddress } from "@/utils/address";

export type WagerDeadlinesEncoded = {
  accept_by: bigint;
  resolve_by: bigint;
};

export type WagerConfigEncodeInput = {
  game_adapter: string;
  token: string;
  stake: bigint;
  deadlines: WagerDeadlinesEncoded;
  /** Zero address means open wager (any non-creator may accept). */
  designated_opponent: string;
  /** Cairo `Array<felt252>` payload; empty for default adapter params. */
  game_params: bigint[];
};

/** Split Cairo `u256` into two 128-bit limbs (decimal string felts for RPC). */
export function splitU256(value: bigint): [string, string] {
  if (value < 0n) {
    throw new Error("stake must be non-negative");
  }
  const mask = (1n << 128n) - 1n;
  const low = value & mask;
  const high = value >> 128n;
  return [low.toString(), high.toString()];
}

/**
 * Flat calldata for `IWagerEscrow::create(config: WagerConfig)` (single struct arg).
 * Order matches `tic_tac_toe::protocol::WagerConfig` Serde: adapter, token, stake,
 * deadlines (accept_by, resolve_by), designated_opponent, game_params array.
 */
export function encodeWagerConfigCalldata(input: WagerConfigEncodeInput): string[] {
  const gameAdapter = normalizeAddress(input.game_adapter);
  const token = normalizeAddress(input.token);
  const designated = normalizeAddress(input.designated_opponent);
  if (!gameAdapter || !token || !designated) {
    throw new Error("Invalid address in wager config");
  }
  const [stLo, stHi] = splitU256(input.stake);
  const acceptBy = input.deadlines.accept_by.toString();
  const resolveBy = input.deadlines.resolve_by.toString();
  const len = input.game_params.length;
  const head: string[] = [
    gameAdapter,
    token,
    stLo,
    stHi,
    acceptBy,
    resolveBy,
    designated,
    String(len),
  ];
  const tail = input.game_params.map((f) => f.toString());
  return [...head, ...tail];
}
