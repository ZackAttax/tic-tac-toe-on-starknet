/** Convert decimal token amount string (e.g. "1.5") to raw u256-style bigint using fixed decimals. */
export function humanStakeToRawAmount(
  input: string,
  decimals: number
): bigint | null {
  const t = input.trim();
  if (!t) return null;
  const parts = t.split(".");
  if (parts.length > 2) return null;
  const wholeRaw = parts[0] ?? "";
  let frac = parts[1] ?? "";
  if (frac && !/^\d+$/.test(frac)) return null;
  const wholeNorm = wholeRaw === "" ? "0" : wholeRaw;
  if (!/^\d+$/.test(wholeNorm)) return null;
  frac = frac.padEnd(decimals, "0").slice(0, decimals);
  const combined = wholeNorm + frac;
  try {
    const n = BigInt(combined === "" ? "0" : combined);
    return n;
  } catch {
    return null;
  }
}
