/**
 * Badge component for status indicators.
 */

import type { CSSProperties } from "react";
import { colors, radius, typeScale } from "../../theme";

type BadgeVariant = "default" | "success" | "warning" | "error" | "info" | "accent";

const VARIANT_STYLES: Record<BadgeVariant, { bg: string; color: string; border: string }> = {
  default: { bg: "rgba(255,255,255,0.04)", color: colors.textSecondary, border: colors.border },
  success: { bg: "rgba(0,232,157,0.08)", color: colors.success, border: "rgba(0,232,157,0.2)" },
  warning: { bg: "rgba(245,166,35,0.08)", color: colors.warning, border: "rgba(245,166,35,0.2)" },
  error: { bg: "rgba(239,68,68,0.08)", color: colors.error, border: "rgba(239,68,68,0.2)" },
  info: { bg: "rgba(96,165,250,0.08)", color: colors.info, border: "rgba(96,165,250,0.2)" },
  accent: { bg: "rgba(0,232,157,0.1)", color: colors.accent, border: colors.borderAccent },
};

export default function Badge({
  children,
  variant = "default",
  dot,
  style,
}: {
  children: React.ReactNode;
  variant?: BadgeVariant;
  dot?: boolean;
  style?: CSSProperties;
}) {
  const v = VARIANT_STYLES[variant];
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "2px 8px",
      borderRadius: radius.sm,
      background: v.bg,
      color: v.color,
      border: `1px solid ${v.border}`,
      ...typeScale.caption,
      fontSize: 9,
      ...style,
    }}>
      {dot && (
        <span style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: v.color,
        }} />
      )}
      {children}
    </span>
  );
}
