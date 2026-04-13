import { describe, expect, it } from "vitest";
import {
  getLinkedGameIdFromWagerRecord,
  parseCallContractWagerResult,
  type WagerRecordParsed,
} from "@/utils/parseWager";

/** Minimal flat `get_wager` stream: empty `game_params`, `stake = 1000` (low only). */
function sampleFlatMatchedWagerFelts(): unknown[] {
  const gameAdapter = 256n;
  const token = 512n;
  const stakeLow = 1000n;
  const stakeHigh = 0n;
  const acceptBy = 100n;
  const resolveBy = 200n;
  const designated = 0n;
  const paramsLen = 0;
  const creator = 768n;
  const opponent = 1024n;
  const matchAdapter = gameAdapter;
  const matchId = 99n;

  return [
    42n, // wager_id
    1n, // Matched
    gameAdapter,
    token,
    stakeLow,
    stakeHigh,
    acceptBy,
    resolveBy,
    designated,
    BigInt(paramsLen),
    creator,
    opponent,
    matchAdapter,
    matchId,
  ];
}

describe("parseCallContractWagerResult", () => {
  it("parses flat felts with empty game_params", () => {
    const w = parseCallContractWagerResult(sampleFlatMatchedWagerFelts());
    expect(w).not.toBeNull();
    expect(w!.wager_id).toBe(42n);
    expect(w!.status).toBe("Matched");
    expect(w!.config.stake).toBe(1000n);
    expect(w!.match_ref.match_id).toBe(99n);
  });

  it("parses result-wrapped array", () => {
    const inner = sampleFlatMatchedWagerFelts();
    const w = parseCallContractWagerResult({ result: inner });
    expect(w).not.toBeNull();
    expect(w!.wager_id).toBe(42n);
  });

  it("parses flat with one game_param felt", () => {
    const base = sampleFlatMatchedWagerFelts();
    const extended = [...base.slice(0, 9), 1n, 7n, ...base.slice(10)];
    expect(extended.length).toBe(15);
    const w = parseCallContractWagerResult(extended);
    expect(w).not.toBeNull();
    expect(w!.config.game_params).toEqual([7n]);
  });

  it("returns null on length mismatch (fail-closed)", () => {
    expect(parseCallContractWagerResult(sampleFlatMatchedWagerFelts().slice(0, 10))).toBeNull();
  });

  it("nested object without config.stake fails closed", () => {
    const raw = {
      wager_id: 1n,
      status: 0n,
      config: {
        game_adapter: 256n,
        token: 512n,
        deadlines: { accept_by: 100n, resolve_by: 200n },
        designated_opponent: 0n,
        game_params: [],
      },
      creator: 768n,
      opponent: 1024n,
      match_ref: { adapter: 256n, match_id: 0n },
    };
    expect(parseCallContractWagerResult(raw)).toBeNull();
  });

  it("nested object missing config.game_adapter fails closed", () => {
    const raw = {
      wager_id: 1n,
      status: 0n,
      config: {
        token: 512n,
        stake: 1n,
        deadlines: { accept_by: 100n, resolve_by: 200n },
        designated_opponent: 0n,
        game_params: [],
      },
      creator: 768n,
      opponent: 1024n,
      match_ref: { adapter: 256n, match_id: 0n },
    };
    expect(parseCallContractWagerResult(raw)).toBeNull();
  });

  it("nested object missing match_ref.adapter fails closed", () => {
    const raw = {
      wager_id: 1n,
      status: 0n,
      config: {
        game_adapter: 256n,
        token: 512n,
        stake: 1n,
        deadlines: { accept_by: 100n, resolve_by: 200n },
        designated_opponent: 0n,
        game_params: [],
      },
      creator: 768n,
      opponent: 1024n,
      match_ref: { match_id: 0n },
    };
    expect(parseCallContractWagerResult(raw)).toBeNull();
  });
});

describe("getLinkedGameIdFromWagerRecord", () => {
  it("returns game id string when match_ref matches config adapter", () => {
    const rec: WagerRecordParsed = {
      wager_id: 1n,
      status: "Expired",
      config: {
        game_adapter: "0x0000000000000000000000000000000000000000000000000000000000000100",
        token: "0x1",
        stake: 1n,
        deadlines: { accept_by: 1n, resolve_by: 2n },
        designated_opponent: "0x0",
        game_params: [],
      },
      creator: "0x2",
      opponent: "0x3",
      match_ref: {
        adapter: "0x0000000000000000000000000000000000000000000000000000000000000100",
        match_id: 55n,
      },
    };
    expect(getLinkedGameIdFromWagerRecord(rec)).toBe("55");
  });

  it("returns null when match_id is zero", () => {
    const rec: WagerRecordParsed = {
      wager_id: 1n,
      status: "Open",
      config: {
        game_adapter: "0x100",
        token: "0x1",
        stake: 1n,
        deadlines: { accept_by: 1n, resolve_by: 2n },
        designated_opponent: "0x0",
        game_params: [],
      },
      creator: "0x2",
      opponent: "0x0",
      match_ref: { adapter: "0x0", match_id: 0n },
    };
    expect(getLinkedGameIdFromWagerRecord(rec)).toBeNull();
  });

  it("returns null when adapters disagree", () => {
    const rec: WagerRecordParsed = {
      wager_id: 1n,
      status: "Matched",
      config: {
        game_adapter: "0x0000000000000000000000000000000000000000000000000000000000000100",
        token: "0x1",
        stake: 1n,
        deadlines: { accept_by: 1n, resolve_by: 2n },
        designated_opponent: "0x0",
        game_params: [],
      },
      creator: "0x2",
      opponent: "0x3",
      match_ref: {
        adapter: "0x0000000000000000000000000000000000000000000000000000000000000200",
        match_id: 1n,
      },
    };
    expect(getLinkedGameIdFromWagerRecord(rec)).toBeNull();
  });
});
