import { normalizeAddress } from "@/utils/address";
import type { Game, MyRole } from "@/utils/ultimateTicTacToe";
import { isCellPlayable } from "@/utils/ultimateTicTacToe";

export type PreflightSubmitDecision =
  | { ok: true }
  | { ok: false; reason: "sync_failed" | "game_changed" | "not_playable" };

/**
 * Whether a completed fetch for `fetchedGameId` should be committed to screen state
 * for the currently focused game. Stops stale in-flight syncs from overwriting the UI after a switch.
 */
export function shouldCommitFetchedGame(
  fetchedGameId: string,
  activeGameId: string | null
): boolean {
  return activeGameId !== null && fetchedGameId === activeGameId;
}

export function myRoleFromGame(game: Game, myAddress: string): MyRole {
  const me = normalizeAddress(myAddress);
  const playerX = normalizeAddress(game.player_x || "");
  const playerO = normalizeAddress(game.player_o || "");
  return me === playerX ? "X" : me === playerO ? "O" : null;
}

/**
 * After an authoritative `getGame` refresh, whether the user's chosen cell is still legal.
 * Used on confirm so we do not submit against stale UI state.
 */
export function isSelectionPlayableAfterSync(
  fresh: Game,
  myAddress: string,
  selection: { boardIndex: number; cellIndex: number },
  nowUnixSecs: number
): boolean {
  if (fresh.status !== 0) return false;
  const role = myRoleFromGame(fresh, myAddress);
  return isCellPlayable({
    game: fresh,
    myRole: role,
    boardIndex: selection.boardIndex,
    cellIndex: selection.cellIndex,
    hasPendingMove: false,
    nowUnixSecs,
  });
}

/**
 * After `await syncGame`, decide whether it is safe to create `pendingMove` and call `submitMove`.
 * Uses the latest active game id (from a ref) so async continuations do not submit after a game switch.
 */
export function shouldSubmitAfterPreflight(args: {
  startedGameId: string;
  activeGameId: string | null;
  fresh: Game | null;
  myAddress: string;
  selection: { boardIndex: number; cellIndex: number };
  nowUnixSecs: number;
}): PreflightSubmitDecision {
  if (!args.fresh) return { ok: false, reason: "sync_failed" };
  if (args.activeGameId !== args.startedGameId) {
    return { ok: false, reason: "game_changed" };
  }
  if (
    !isSelectionPlayableAfterSync(
      args.fresh,
      args.myAddress,
      args.selection,
      args.nowUnixSecs
    )
  ) {
    return { ok: false, reason: "not_playable" };
  }
  return { ok: true };
}
