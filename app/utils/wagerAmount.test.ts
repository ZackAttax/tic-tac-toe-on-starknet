import { describe, expect, it } from "vitest";
import { humanStakeToRawAmount } from "@/utils/wagerAmount";
import { WAGER_TOKEN_DECIMALS } from "@/utils/wagerStackConfig";

describe("humanStakeToRawAmount", () => {
  it("parses whole and fractional amounts", () => {
    expect(humanStakeToRawAmount("1", WAGER_TOKEN_DECIMALS)).toBe(10n ** 18n);
    expect(humanStakeToRawAmount("0.5", WAGER_TOKEN_DECIMALS)).toBe(5n * 10n ** 17n);
    expect(humanStakeToRawAmount("0", WAGER_TOKEN_DECIMALS)).toBe(0n);
  });
});
