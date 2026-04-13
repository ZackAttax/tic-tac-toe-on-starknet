import { normalizeAddress } from "@/utils/address";

type ReceiptEventLike = {
  from_address?: string;
  data?: unknown[];
};

export type ReceiptLike = {
  events?: ReceiptEventLike[];
};

function toFeltStrings(data: unknown[] | undefined): string[] {
  if (!Array.isArray(data)) return [];
  return data.map((d) => (typeof d === "string" ? d : String(d)));
}

function parseFirstFeltAsU64String(hexOrDec: string): string | null {
  try {
    const n = BigInt(hexOrDec.includes("0x") ? hexOrDec : hexOrDec);
    if (n < 0n) return null;
    return n.toString();
  } catch {
    return null;
  }
}

/**
 * Recover `wager_id` from a `create` transaction receipt by scanning events from
 * the escrow contract. `WagerCreated` places `wager_id` as the first data felt.
 */
export function parseWagerIdFromCreateReceipt(
  receipt: ReceiptLike | null | undefined,
  escrowAddress: string
): string | null {
  const esc = normalizeAddress(escrowAddress);
  if (!esc) return null;
  const events = Array.isArray(receipt?.events) ? receipt!.events! : [];
  for (const ev of events) {
    const from = normalizeAddress(ev.from_address ?? "");
    if (from !== esc) continue;
    const data = toFeltStrings(ev.data);
    /** `WagerCreated` emits 9 data felts (wager_id … designated_opponent). */
    if (data.length < 9) continue;
    const wid = parseFirstFeltAsU64String(data[0]!);
    if (wid !== null) {
      return wid;
    }
  }
  return null;
}
