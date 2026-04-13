import { normalizeAddress } from "@/utils/address";
import { splitU256 } from "@/utils/encodeWagerConfig";

export function parseU256ReturnFelts(felts: string[]): bigint | null {
  if (!Array.isArray(felts) || felts.length < 2) return null;
  try {
    const low = BigInt(felts[0] ?? "0");
    const high = BigInt(felts[1] ?? "0");
    return (high << 128n) + low;
  } catch {
    return null;
  }
}

/** Normalize RPC `callContract` return to a flat felt string array. */
export function flattenCallContractResult(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => (typeof x === "string" ? x : String(x)));
  }
  if (raw !== null && typeof raw === "object" && "result" in raw) {
    const res = (raw as { result: unknown }).result;
    if (Array.isArray(res)) {
      return res.map((x) => (typeof x === "string" ? x : String(x)));
    }
  }
  return [];
}

export type StarknetProviderLike = {
  callContract: (params: {
    contractAddress: string;
    entrypoint: string;
    calldata: string[];
  }) => Promise<unknown>;
};

export async function readErc20Allowance(
  provider: StarknetProviderLike,
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string
): Promise<bigint | null> {
  const token = normalizeAddress(tokenAddress);
  const owner = normalizeAddress(ownerAddress);
  const spender = normalizeAddress(spenderAddress);
  if (!token || !owner || !spender) return null;
  try {
    const raw = await provider.callContract({
      contractAddress: token,
      entrypoint: "allowance",
      calldata: [owner, spender],
    });
    const felts = flattenCallContractResult(raw);
    return parseU256ReturnFelts(felts);
  } catch {
    return null;
  }
}

/** Calldata for ERC20 `approve(spender, amount)` with uint256 amount. */
export function encodeErc20ApproveCalldata(
  spenderAddress: string,
  amount: bigint
): string[] {
  const spender = normalizeAddress(spenderAddress);
  if (!spender) throw new Error("Invalid spender");
  const [lo, hi] = splitU256(amount);
  return [spender, lo, hi];
}
