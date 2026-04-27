const tintColorLight = "#6C47FF";
const tintColorDark = "#6C47FF";

export default {
  light: {
    text: "#000",
    background: "#fff",
    tint: tintColorLight,
    tabIconDefault: "#ccc",
    tabIconSelected: tintColorLight,
    // Starknet brand-inspired additions
    brandPrimary: "#6C47FF", // purple
    brandAccent: "#00D3FF", // cyan
    boardLine: "rgba(108,71,255,0.45)",
    forcedBoardFill: "rgba(108,71,255,0.12)",
    finishedLocalOverlay: "rgba(0,0,0,0.26)",
    winHighlight: "rgba(0,211,255,0.15)",
    xSymbol: "#6C47FF",
    oSymbol: "#00D3FF",
  },
  dark: {
    text: "#fff",
    background: "#000",
    tint: tintColorDark,
    tabIconDefault: "#ccc",
    tabIconSelected: tintColorDark,
    // Starknet brand-inspired additions
    brandPrimary: "#6C47FF",
    brandAccent: "#00D3FF",
    boardLine: "rgba(108,71,255,0.6)",
    forcedBoardFill: "rgba(108,71,255,0.22)",
    finishedLocalOverlay: "rgba(0,0,0,0.42)",
    winHighlight: "rgba(0,211,255,0.22)",
    xSymbol: "#6C47FF",
    oSymbol: "#00D3FF",
  },
};
