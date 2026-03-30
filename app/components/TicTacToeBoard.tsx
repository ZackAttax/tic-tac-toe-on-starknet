import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  ViewStyle,
} from "react-native";
import { Text, View } from "@/components/Themed";
import Colors from "@/constants/Colors";
import { useColorScheme } from "@/components/useColorScheme";
import type { LocalBoard } from "@/utils/ultimateTicTacToe";
import { localBoardToCells } from "@/utils/ultimateTicTacToe";

const MACRO_GAP = 6;

export type UltimateBoardProps = {
  boards: LocalBoard[];
  nextBoard: number;
  onCellPress: (boardIndex: number, cellIndex: number) => void;
  disabled?: boolean;
  selectedMove?: { boardIndex: number; cellIndex: number } | null;
  pendingMove?: { boardIndex: number; cellIndex: number } | null;
  winningMetaLine?: number[] | null;
  style?: ViewStyle;
};

export default function TicTacToeBoard(props: UltimateBoardProps) {
  const {
    boards,
    nextBoard,
    onCellPress,
    disabled = false,
    selectedMove = null,
    pendingMove,
    winningMetaLine,
    style,
  } = props;
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];
  const { width: windowWidth } = useWindowDimensions();
  const lineColor = colors.boardLine as string;
  const tint = colors.tint as string;
  const xColor = colors.xSymbol as string;
  const oColor = colors.oSymbol as string;
  const textColor = colors.text as string;
  const forcedFill = colors.forcedBoardFill as string;
  const finishedOverlay = colors.finishedLocalOverlay as string;

  /** Integer px only — avoids typography jitter when width fluctuates (rotation, split view). */
  const { innerGlyphSize, overlayMarkSize, overlayDrawSize } = useMemo(() => {
    const boardPx = Math.min(420, Math.max(260, windowWidth - 48));
    return {
      innerGlyphSize: Math.round(Math.min(18, Math.max(11, boardPx * 0.034))),
      overlayMarkSize: Math.round(Math.min(58, Math.max(34, boardPx * 0.14))),
      overlayDrawSize: Math.round(Math.min(30, Math.max(18, boardPx * 0.068))),
    };
  }, [windowWidth]);

  const cellMatrices = useMemo(
    () => boards.map((b) => localBoardToCells(b)),
    [boards]
  );

  const isForcedMode = nextBoard !== 9;

  const rows = [0, 1, 2] as const;

  return (
    <View
      style={[styles.metaOuter, style]}
      lightColor="transparent"
      darkColor="transparent"
    >
      <View style={styles.metaColumn}>
        {rows.map((row) => (
          <View key={row} style={styles.metaRow}>
            {rows.map((col) => {
              const boardIndex = row * 3 + col;
          const local = boards[boardIndex];
          const cells = cellMatrices[boardIndex] ?? Array(9).fill(null);
          const finished = local && local.status !== 0;
          const isWinningMeta = winningMetaLine?.includes(boardIndex);
          const isForcedTarget =
            isForcedMode && nextBoard === boardIndex && !finished;
          const isDimmedUnfinished =
            isForcedMode &&
            !finished &&
            boardIndex !== nextBoard;

          const macroWrapperStyle = [
            styles.macroCell,
            { borderColor: colors.brandPrimary as string },
            isForcedTarget && [
              styles.macroForced,
              { backgroundColor: forcedFill },
            ],
            isDimmedUnfinished && styles.macroDimmed,
            finished && styles.macroFinishedDeemphasis,
            isWinningMeta && { backgroundColor: colors.winHighlight as string },
          ];

          return (
            <View
              key={boardIndex}
              style={macroWrapperStyle}
              pointerEvents={
                disabled || finished || isDimmedUnfinished ? "none" : "auto"
              }
            >
              <View style={styles.localGrid}>
                {Array.from({ length: 9 }).map((__, cellIndex) => {
                  const value = cells[cellIndex];
                  const row = Math.floor(cellIndex / 3);
                  const col = cellIndex % 3;
                  const showRight = col < 2;
                  const showBottom = row < 2;
                  const isPending =
                    pendingMove?.boardIndex === boardIndex &&
                    pendingMove?.cellIndex === cellIndex;
                  const isSelected =
                    !isPending &&
                    selectedMove?.boardIndex === boardIndex &&
                    selectedMove?.cellIndex === cellIndex;
                  const canTry =
                    !disabled &&
                    !finished &&
                    !isDimmedUnfinished &&
                    value == null;

                  const symbolColor =
                    value === "X"
                      ? xColor
                      : value === "O"
                        ? oColor
                        : textColor;

                  const a11ySuffix =
                    finished || isDimmedUnfinished
                      ? "not playable"
                      : value == null
                        ? "empty"
                        : value;

                  return (
                    <Pressable
                      key={cellIndex}
                      accessibilityRole="button"
                      accessibilityState={{
                        disabled: !canTry || finished || isDimmedUnfinished,
                      }}
                      accessibilityLabel={`Board ${boardIndex + 1}, Cell ${cellIndex + 1}, ${a11ySuffix}`}
                      disabled={!canTry || finished || isDimmedUnfinished}
                      onPress={() => onCellPress(boardIndex, cellIndex)}
                      style={({ pressed }) => [
                        styles.innerCell,
                        {
                          borderRightWidth: showRight
                            ? StyleSheet.hairlineWidth
                            : 0,
                          borderBottomWidth: showBottom
                            ? StyleSheet.hairlineWidth
                            : 0,
                          borderColor: lineColor,
                          opacity:
                            pressed && canTry && !finished ? 0.85 : 1,
                        },
                        isSelected && {
                          backgroundColor:
                            colorScheme === "dark"
                              ? "rgba(108,71,255,0.32)"
                              : "rgba(108,71,255,0.22)",
                        },
                      ]}
                    >
                      <View style={styles.innerCellContent}>
                        <Text
                          style={[
                            styles.innerSymbol,
                            {
                              color: symbolColor,
                              fontSize: innerGlyphSize,
                            },
                          ]}
                        >
                          {value ?? ""}
                        </Text>
                        {isPending ? (
                          <ActivityIndicator
                            size="small"
                            color={tint}
                            style={styles.pendingIndicator}
                          />
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              {finished && local ? (
                <View
                  style={[styles.overlay, { backgroundColor: finishedOverlay }]}
                  pointerEvents="none"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  {local.status === 1 ? (
                    <Text
                      style={[
                        styles.overlayMark,
                        { color: xColor, fontSize: overlayMarkSize },
                      ]}
                    >
                      X
                    </Text>
                  ) : local.status === 2 ? (
                    <Text
                      style={[
                        styles.overlayMark,
                        { color: oColor, fontSize: overlayMarkSize },
                      ]}
                    >
                      O
                    </Text>
                  ) : (
                    <Text
                      style={[
                        styles.overlayDraw,
                        { color: textColor, fontSize: overlayDrawSize },
                      ]}
                    >
                      D
                    </Text>
                  )}
                </View>
              ) : null}
            </View>
            );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  metaOuter: {
    width: "100%",
    maxWidth: 360,
    alignSelf: "center",
    aspectRatio: 1,
  },
  metaColumn: {
    flex: 1,
    justifyContent: "space-between",
    gap: MACRO_GAP,
  },
  metaRow: {
    flex: 1,
    flexDirection: "row",
    gap: MACRO_GAP,
  },
  macroCell: {
    flex: 1,
    aspectRatio: 1,
    borderWidth: StyleSheet.hairlineWidth * 4,
    borderRadius: 6,
    overflow: "hidden",
    position: "relative",
  },
  macroForced: {
    borderWidth: 2,
    opacity: 1,
  },
  macroDimmed: {
    opacity: 0.42,
  },
  macroFinishedDeemphasis: {
    opacity: 0.88,
  },
  localGrid: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  innerCell: {
    width: "33.3333%",
    height: "33.3333%",
    alignItems: "center",
    justifyContent: "center",
  },
  innerCellContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  innerSymbol: {
    fontWeight: "700",
  },
  pendingIndicator: {
    marginTop: 4,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  overlayMark: {
    fontWeight: "800",
    opacity: 0.55,
  },
  overlayDraw: {
    fontWeight: "700",
    opacity: 0.65,
    letterSpacing: 4,
  },
});
