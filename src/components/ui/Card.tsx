/**
 * Reusable Card component — glass-morphism dark panel.
 */

import type { CSSProperties, ReactNode } from "react";
import { colors, radius, spacing } from "../../theme";

interface CardProps {
  children: ReactNode;
  style?: CSSProperties;
  padding?: number;
  hover?: boolean;
  accent?: boolean;
  onClick?: () => void;
}

export default function Card({
  children,
  style,
  padding = spacing.lg,
  hover,
  accent,
  onClick,
}: CardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        background: colors.bgCard,
        border: `1px solid ${accent ? colors.borderAccent : colors.border}`,
        borderRadius: radius.lg,
        padding,
        cursor: onClick ? "pointer" : undefined,
        transition: "all 0.15s ease",
        ...(hover
          ? { ":hover": { background: colors.bgHover } } as unknown as CSSProperties
          : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  subValue,
  color = colors.textPrimary,
  style,
}: {
  label: string;
  value: string | number;
  subValue?: string;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <Card padding={spacing.md} style={style}>
      <div style={{
        fontSize: 10,
        fontWeight: 500,
        color: colors.textDim,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 22,
        fontWeight: 700,
        color,
        lineHeight: 1,
        marginBottom: subValue ? 4 : 0,
      }}>
        {value}
      </div>
      {subValue && (
        <div style={{
          fontSize: 11,
          color: colors.textSecondary,
        }}>
          {subValue}
        </div>
      )}
    </Card>
  );
}
