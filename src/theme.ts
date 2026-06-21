/**
 * Design system tokens — consistent dark theme with single accent.
 */

export const colors = {
  // Primary accent
  accent: "#00E89D",
  accentDim: "rgba(0, 232, 157, 0.3)",
  accentGlow: "rgba(0, 232, 157, 0.12)",
  accentBlue: "#00C9DB",

  // Backgrounds (low → high elevation)
  bgDeep: "#0A0D16",
  bgBase: "#0F1220",
  bgSurface: "#161A2A",
  bgCard: "#1A1F30",
  bgOverlay: "#1E2338",
  bgHover: "#252A3E",

  // Borders
  border: "#232842",
  borderSubtle: "#1A1F35",
  borderAccent: "rgba(0, 232, 157, 0.2)",

  // Text
  textPrimary: "#E8ECF4",
  textSecondary: "#8892A8",
  textDim: "#5A6378",
  textMuted: "#3D4560",

  // Semantic
  success: "#00E89D",
  warning: "#F5A623",
  error: "#EF4444",
  info: "#60A5FA",

  // 3D scene (kept for renderer compatibility)
  sensorTop: "#00E89D",
  sensorFront: "#00C9DB",
  sensorSideL: "#4DA8FF",
  sensorSideR: "#7B6FFF",
  sensorRear: "#B490FF",
  boxVehicle: "#FF9E00",
  boxPedestrian: "#CCFF00",
  boxSign: "#FF44FF",
  boxCyclist: "#DC143C",
  boxUnknown: "#6B7280",
  gridMajor: "#2E3550",
  gridMinor: "#252B42",
  vehicleMarker: "#00E89D",
  gizmoX: "#FF5757",
  gizmoY: "#00E89D",
  gizmoZ: "#4DA8FF",
} as const;

export const fonts = {
  sans: "'Inter', -apple-system, system-ui, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', 'Cascadia Code', Consolas, monospace",
} as const;

export const typeScale = {
  h1: { fontSize: 24, fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.02em" },
  h2: { fontSize: 18, fontWeight: 600, lineHeight: 1.3, letterSpacing: "-0.01em" },
  h3: { fontSize: 14, fontWeight: 600, lineHeight: 1.4 },
  body: { fontSize: 13, fontWeight: 400, lineHeight: 1.5 },
  small: { fontSize: 11, fontWeight: 400, lineHeight: 1.4 },
  caption: { fontSize: 10, fontWeight: 500, lineHeight: 1.3, letterSpacing: "0.04em", textTransform: "uppercase" as const },
  mono: { fontSize: 11, fontWeight: 400, lineHeight: 1.4, fontFamily: "'JetBrains Mono', monospace" },
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const gradients = {
  accent: "linear-gradient(135deg, #00E89D, #00C9DB)",
  surface: "linear-gradient(180deg, #161A2A 0%, #0F1220 100%)",
  cardBorder: "linear-gradient(135deg, rgba(0,232,157,0.15), rgba(0,201,219,0.05))",
} as const;

// Glass panel mixin
export const glass = {
  background: "rgba(14, 17, 28, 0.82)",
  backdropFilter: "blur(20px)",
  border: `1px solid ${colors.border}`,
  borderRadius: radius.lg,
} as const;
