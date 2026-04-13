import { describe, expect, it } from "vitest";
import {
  encodeWagerConfigCalldata,
  splitU256,
} from "@/utils/encodeWagerConfig";

describe("splitU256", () => {
  it("splits small values", () => {
    expect(splitU256(0n)).toEqual(["0", "0"]);
    expect(splitU256(1n)).toEqual(["1", "0"]);
  });

  it("splits at 128-bit boundary", () => {
    const x = (1n << 128n) + 5n;
    expect(splitU256(x)).toEqual(["5", "1"]);
  });
});

describe("encodeWagerConfigCalldata", () => {
  it("encodes empty game_params", () => {
    const felts = encodeWagerConfigCalldata({
      game_adapter:
        "0x0000000000000000000000000000000000000000000000000000000000000abc",
      token:
        "0x0000000000000000000000000000000000000000000000000000000000000def",
      stake: 1000n,
      deadlines: {
        accept_by: 100n,
        resolve_by: 200n,
      },
      designated_opponent:
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      game_params: [],
    });
    expect(felts[0]).toContain("abc");
    expect(felts[1]).toContain("def");
    expect(felts[2]).toBe("1000");
    expect(felts[3]).toBe("0");
    expect(felts[4]).toBe("100");
    expect(felts[5]).toBe("200");
    expect(felts[6]).toContain("0");
    expect(felts[7]).toBe("0");
    expect(felts.length).toBe(8);
  });

  it("encodes non-empty game_params with length prefix", () => {
    const felts = encodeWagerConfigCalldata({
      game_adapter:
        "0x0000000000000000000000000000000000000000000000000000000000000abc",
      token:
        "0x0000000000000000000000000000000000000000000000000000000000000def",
      stake: 1n,
      deadlines: { accept_by: 1n, resolve_by: 2n },
      designated_opponent:
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      game_params: [7n, 8n],
    });
    expect(felts[7]).toBe("2");
    expect(felts[8]).toBe("7");
    expect(felts[9]).toBe("8");
  });
});
