/**
 * AppShell — top-level layout with navigation bar.
 */

import { useLocation, useNavigate } from "react-router-dom";
import {
  Monitor,
  LayoutGrid,
  GitBranch,
  BarChart3,
  Upload,
  ListOrdered,
  Brain,
  ShieldCheck,
} from "lucide-react";
import { colors, fonts, typeScale, spacing, glass } from "../../theme";
import ArmorIQStatus from "../ArmorIQStatus";

const NAV_ITEMS = [
  { path: "/upload", label: "Upload", icon: Upload },
  { path: "/sim", label: "Simulator", icon: Monitor },
  { path: "/dashboard", label: "Counterfactuals", icon: LayoutGrid },
  { path: "/rank", label: "Rank", icon: ListOrdered },
  { path: "/graph", label: "Policy Brain", icon: Brain },
  { path: "/analytics", label: "Analytics", icon: BarChart3 },
  { path: "/armoriq", label: "ArmorIQ", icon: ShieldCheck },
] as const;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();

  // On /sim, the nav is minimal (floating over canvas)
  const isSimPage = location.pathname === "/sim" || location.pathname === "/";

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      display: "flex",
      flexDirection: "column",
      backgroundColor: colors.bgDeep,
      fontFamily: fonts.sans,
      color: colors.textPrimary,
    }}>
      {/* Top Navigation */}
      <nav style={{
        height: isSimPage ? 44 : 48,
        minHeight: isSimPage ? 44 : 48,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: `0 ${spacing.lg}px`,
        ...(isSimPage
          ? {
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              zIndex: 50,
              background: "linear-gradient(180deg, rgba(10,13,22,0.9) 0%, rgba(10,13,22,0) 100%)",
            }
          : {
              ...glass,
              borderRadius: 0,
              borderTop: "none",
              borderLeft: "none",
              borderRight: "none",
              background: "rgba(14, 17, 28, 0.95)",
            }),
      }}>
        {/* Logo */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: spacing.sm,
          cursor: "pointer",
        }} onClick={() => navigate("/sim")}>
          <div style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: gradientBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <Monitor size={14} color={colors.bgDeep} strokeWidth={2.5} />
          </div>
          <span style={{
            ...typeScale.h3,
            color: colors.textPrimary,
            letterSpacing: "-0.01em",
            whiteSpace: "nowrap",
          }}>
            Improving Autonomous Vehicles
          </span>
        </div>

        {/* Nav links */}
        <div style={{ display: "flex", gap: 2 }}>
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
            const active = location.pathname === path || (path === "/sim" && location.pathname === "/");
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 14px",
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: active ? 500 : 400,
                  fontFamily: fonts.sans,
                  color: active ? colors.accent : colors.textSecondary,
                  background: active ? "rgba(0,232,157,0.08)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <Icon size={14} strokeWidth={active ? 2 : 1.5} />
                {label}
              </button>
            );
          })}
        </div>

        {/* Right: status indicators */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: spacing.sm,
        }}>
          <ArmorIQStatus />
          <OpenEnvStatus />
        </div>
      </nav>

      {/* Content */}
      <div style={{
        flex: 1,
        overflow: isSimPage ? "hidden" : "auto",
        position: "relative",
      }}>
        {children}
      </div>
    </div>
  );
}

const gradientBg = "linear-gradient(135deg, #00E89D, #00C9DB)";

function OpenEnvStatus() {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "4px 10px",
      borderRadius: 6,
      background: "rgba(0,232,157,0.06)",
      border: "1px solid rgba(0,232,157,0.12)",
    }}>
      <div style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: colors.accent,
        boxShadow: `0 0 6px ${colors.accentDim}`,
      }} />
      <span style={{
        ...typeScale.caption,
        color: colors.textSecondary,
      }}>
        Live
      </span>
    </div>
  );
}
