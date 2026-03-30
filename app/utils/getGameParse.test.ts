import { describe, expect, it } from "vitest";
import {
  EXPECTED_GET_GAME_FLAT_LEN,
  normalizeBoardSet,
  parseCallContractGameResult,
} from "@/utils/getGameParse";
import type { BoardSet } from "@/utils/ultimateTicTacToe";

const GAME_ID = "7";

function emptyLocal() {
  return { x_bits: 0, o_bits: 0, status: 0 };
}

function emptyBoardSet(): BoardSet {
  const L = emptyLocal;
  return {
    b0: L(),
    b1: L(),
    b2: L(),
    b3: L(),
    b4: L(),
    b5: L(),
    b6: L(),
    b7: L(),
    b8: L(),
  };
}

/** 32 felts: addresses, 9×(x_bits,o_bits,status), next_board, turn, game_status */
function sampleFlatFelts(): unknown[] {
  const row: unknown[] = [1n, 2n];
  for (let i = 0; i < 9; i++) {
    row.push(0, 0, 0);
  }
  row.push(9, 0, 0);
  expect(row.length).toBe(EXPECTED_GET_GAME_FLAT_LEN);
  return row;
}

describe("parseCallContractGameResult", () => {
  it("parses top-level decoded Game-shaped object", () => {
    const boards = emptyBoardSet();
    const raw = {
      player_x: 1n,
      player_o: 2n,
      boards,
      next_board: 9,
      turn: 0,
      status: 0,
    };
    const g = parseCallContractGameResult(raw, GAME_ID);
    expect(g).not.toBeNull();
    expect(g!.gameId).toBe(GAME_ID);
    expect(g!.next_board).toBe(9);
    expect(g!.boards.b0.status).toBe(0);
  });

  it("parses result-wrapped decoded struct", () => {
    const boards = emptyBoardSet();
    const raw = {
      result: {
        player_x: 1n,
        player_o: 2n,
        boards,
        next_board: 4,
        turn: 1,
        status: 0,
      },
    };
    const g = parseCallContractGameResult(raw, GAME_ID);
    expect(g).not.toBeNull();
    expect(g!.next_board).toBe(4);
    expect(g!.turn).toBe(1);
  });

  it("parses flat 32-felt array", () => {
    const g = parseCallContractGameResult(sampleFlatFelts(), GAME_ID);
    expect(g).not.toBeNull();
    expect(g!.next_board).toBe(9);
    expect(g!.turn).toBe(0);
    expect(g!.status).toBe(0);
  });

  it("returns null for flat array with wrong length (31 felts, fail-closed)", () => {
    const truncated = sampleFlatFelts().slice(0, 31);
    expect(truncated.length).toBe(31);
    expect(parseCallContractGameResult(truncated, GAME_ID)).toBeNull();
  });

  it("returns null when nested Game has incomplete BoardSet (missing b8)", () => {
    const boards = emptyBoardSet();
    const { b8: _b8, ...incompleteBoards } = boards;
    const raw = {
      player_x: 1n,
      player_o: 2n,
      boards: incompleteBoards,
      next_board: 9,
      turn: 0,
      status: 0,
    };
    expect(parseCallContractGameResult(raw, GAME_ID)).toBeNull();
  });

  it("returns null when top-level fields coerce to non-finite numbers (bad status)", () => {
    const boards = emptyBoardSet();
    const raw = {
      player_x: 1n,
      player_o: 2n,
      boards,
      next_board: 9,
      turn: 0,
      status: "not-a-number",
    };
    expect(parseCallContractGameResult(raw, GAME_ID)).toBeNull();
  });
});

describe("normalizeBoardSet (fail-closed)", () => {
  it("returns null when a named local board is missing", () => {
    const boards = emptyBoardSet();
    const { b8: _drop, ...missingOne } = boards;
    expect(normalizeBoardSet(missingOne)).toBeNull();
  });

  it("returns null when a local board has non-numeric status (coercion fails)", () => {
    const malformed = {
      ...emptyBoardSet(),
      b3: { x_bits: 0, o_bits: 0, status: "invalid" },
    };
    expect(normalizeBoardSet(malformed as unknown)).toBeNull();
  });
});
