import { describe, expect, it } from "vitest";
import { getAcceptEligibility } from "@/utils/acceptEligibility";
import type { WagerRecordParsed } from "@/utils/parseWager";

const base = (): WagerRecordParsed => ({
  wager_id: 1n,
  status: "Open",
  config: {
    game_adapter: "0x100",
    token: "0x200",
    stake: 10n,
    deadlines: {
      accept_by: 1000n,
      resolve_by: 2000n,
    },
    designated_opponent: "0x0",
    game_params: [],
  },
  creator: "0x0000000000000000000000000000000000000000000000000000000000000001",
  opponent: "0x0",
  match_ref: { adapter: "0x0", match_id: 0n },
});

describe("getAcceptEligibility", () => {
  it("allows open wager for non-creator before deadline", () => {
    const r = base();
    const wallet =
      "0x0000000000000000000000000000000000000000000000000000000000000002";
    expect(getAcceptEligibility(r, wallet, 500).ok).toBe(true);
  });

  it("rejects creator", () => {
    const r = base();
    const wallet =
      "0x0000000000000000000000000000000000000000000000000000000000000001";
    expect(getAcceptEligibility(r, wallet, 500).ok).toBe(false);
  });

  it("rejects after accept_by", () => {
    const r = base();
    const wallet =
      "0x0000000000000000000000000000000000000000000000000000000000000002";
    expect(getAcceptEligibility(r, wallet, 1001).ok).toBe(false);
  });

  it("rejects wrong designated opponent", () => {
    const r = base();
    r.config.designated_opponent =
      "0x00000000000000000000000000000000000000000000000000000000000000aa";
    const wallet =
      "0x00000000000000000000000000000000000000000000000000000000000000bb";
    expect(getAcceptEligibility(r, wallet, 500).ok).toBe(false);
  });

  it("compares accept_by in bigint space (large u64, no Number rounding)", () => {
    const r = base();
    const wallet =
      "0x0000000000000000000000000000000000000000000000000000000000000002";
    r.config.deadlines.accept_by = 18446744073709551615n;
    expect(getAcceptEligibility(r, wallet, 1_700_000_000).ok).toBe(true);
    r.config.deadlines.accept_by = 1000n;
    expect(getAcceptEligibility(r, wallet, 1001).ok).toBe(false);
  });
});
