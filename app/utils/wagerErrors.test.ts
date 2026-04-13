import { describe, expect, it } from "vitest";
import { errorIndicatesUnknownWager } from "@/utils/wagerEscrowErrors";

describe("errorIndicatesUnknownWager", () => {
  it("detects typical Cairo unknown wager revert wording", () => {
    expect(
      errorIndicatesUnknownWager(
        new Error("Execution failed: panic with [unknown]")
      )
    ).toBe(true);
  });

  it("does not treat generic network errors as unknown wager", () => {
    expect(errorIndicatesUnknownWager(new Error("ECONNREFUSED"))).toBe(false);
    expect(errorIndicatesUnknownWager(new Error("timeout"))).toBe(false);
  });
});
