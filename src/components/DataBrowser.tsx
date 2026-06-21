/**
 * DataBrowser — A sidebar drawer to browse & switch between Waymo segments
 * and scenarios. Triggered by a floating tab on the left edge.
 */

import { useState, useEffect, useCallback } from "react";
import { useStore } from "../store";
import { colors, fonts } from "../theme";
import { ALL_SCENARIOS, SCENARIO_INFO } from "../mockData";
import type { ScenarioId } from "../mockData";
import { generateTrajectoryMoments } from "../utils/trajectoryData";
import { loadScenario } from "../utils/scenarioLoader";

// ---------------------------------------------------------------------------
// Segment manifest
// ---------------------------------------------------------------------------

interface SegmentInfo {
  id: string;
  label: string;
  tags: string[];
}

async function fetchSegmentList(): Promise<SegmentInfo[]> {
  try {
    const resp = await fetch("/waymo_data/manifest.json");
    if (!resp.ok) return [];
    const data = await resp.json();
    if (Array.isArray(data.segments)) return data.segments;
    // fallback: single segment
    if (data.segment) return [{ id: data.segment, label: data.segment, tags: [] }];
    return [];
  } catch {
    return [];
  }
}

/** Check which segments actually have their core files on disk */
async function probeSegments(segments: SegmentInfo[]): Promise<SegmentInfo[]> {
  const available: SegmentInfo[] = [];
  for (const seg of segments) {
    try {
      const r = await fetch(`/waymo_data/vehicle_pose/${seg.id}.parquet`, { method: "HEAD" });
      if (r.ok) available.push(seg);
    } catch { /* skip */ }
  }
  return available;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DataBrowser() {
  const [open, setOpen] = useState(false);
  const [segments, setSegments] = useState<SegmentInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const dataSource = useStore((s) => s.dataSource);
  const waymoSegment = useStore((s) => s.waymoSegment);
  const scenarioId = useStore((s) => s.scenarioId);
  const actions = useStore((s) => s.actions);

  // Fetch available segments on mount
  useEffect(() => {
    fetchSegmentList().then(async (all) => {
      const avail = await probeSegments(all);
      setSegments(avail);
    });
  }, []);

  const loadSegment = useCallback((segId: string) => {
    setLoading(true);
    actions.reset();
    actions.setWaymoSegment(segId);
    actions.setDataSource("waymo");
    // The useDataLoader hook will pick this up
    setTimeout(() => setLoading(false), 500);
  }, [actions]);

  const switchScenario = useCallback((scenario: string) => {
    loadScenario(scenario as ScenarioId).then((sceneData) => {
      actions.setScenarioId(scenario as ScenarioId);
      actions.setDataSource("scenario");
      actions.setSceneData(sceneData);
      actions.setCustomIncident(null);
      const moments = generateTrajectoryMoments(sceneData);
      actions.setTrajectoryMoments(moments);
    });
  }, [actions]);

  const isWaymo = dataSource === "waymo" || dataSource === "waymo-drop";

  return (
    <>
      {/* Tab to open the drawer */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: "absolute",
            left: 0, top: "50%", transform: "translateY(-50%)",
            zIndex: 25,
            width: 24, height: 64,
            background: "rgba(12,15,26,0.8)",
            backdropFilter: "blur(16px)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderLeft: "none",
            borderRadius: "0 6px 6px 0",
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: colors.textDim, fontSize: 12,
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,232,157,0.1)"; e.currentTarget.style.color = colors.accent; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(12,15,26,0.8)"; e.currentTarget.style.color = colors.textDim; }}
          title="Browse datasets"
        >
          ▶
        </button>
      )}

      {/* Drawer */}
      <div style={{
        position: "absolute",
        left: 0, top: 0, bottom: 0,
        width: open ? 260 : 0,
        zIndex: 30,
        background: "rgba(8,12,22,0.92)",
        backdropFilter: "blur(24px)",
        borderRight: open ? "1px solid rgba(255,255,255,0.06)" : "none",
        transition: "width 0.2s ease-out",
        overflow: "hidden",
        display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 14px 10px",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
          flexShrink: 0,
        }}>
          <span style={{
            fontSize: 10, fontWeight: 700, color: colors.textDim,
            fontFamily: fonts.mono, letterSpacing: "1.2px", textTransform: "uppercase",
          }}>
            DATASETS
          </span>
          <button onClick={() => setOpen(false)} style={{
            background: "none", border: "none", color: colors.textDim, fontSize: 14,
            cursor: "pointer", padding: "2px 6px", borderRadius: 4,
            transition: "color 0.1s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = colors.accent; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = colors.textDim; }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>

          {/* ── Scenarios ── */}
          <SectionHeader title="SCENARIOS" />

          {ALL_SCENARIOS.map((sc) => {
            const info = SCENARIO_INFO[sc];
            const active = dataSource === "scenario" && scenarioId === sc;
            const sevColor = info.severity === "critical" ? "#FF4444"
              : info.severity === "warning" ? "#FFB020" : colors.accent;
            return (
              <button
                key={sc}
                onClick={() => switchScenario(sc)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  width: "100%", textAlign: "left",
                  padding: "7px 14px", cursor: "pointer",
                  border: "none", borderRadius: 0,
                  background: active ? "rgba(0,232,157,0.08)" : "transparent",
                  borderLeft: active ? `2px solid ${sevColor}` : "2px solid transparent",
                  transition: "all 0.12s",
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                  background: active ? sevColor : colors.textDim,
                  boxShadow: active ? `0 0 6px ${sevColor}` : "none",
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 10, fontWeight: active ? 600 : 400,
                    color: active ? colors.textPrimary : colors.textSecondary,
                    fontFamily: fonts.sans,
                  }}>
                    {info.label}
                  </div>
                  {info.incident && (
                    <div style={{
                      fontSize: 8, color: colors.textDim, fontFamily: fonts.mono, marginTop: 1,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {info.incident.description}
                    </div>
                  )}
                </div>
                {info.severity !== "none" && (
                  <span style={{
                    fontSize: 7, fontFamily: fonts.mono, fontWeight: 700,
                    color: sevColor, textTransform: "uppercase", letterSpacing: "0.5px", flexShrink: 0,
                  }}>
                    {info.severity}
                  </span>
                )}
              </button>
            );
          })}

          <Divider />

          {/* ── Waymo segments ── */}
          <SectionHeader title="FULL DRIVING (WAYMO)" />

          {segments.length === 0 && (
            <div style={{ padding: "8px 14px", fontSize: 9, color: colors.textDim, fontFamily: fonts.mono }}>
              No segments found in waymo_data/
            </div>
          )}

          {segments.map((seg) => {
            const active = isWaymo && (waymoSegment === seg.id || (!waymoSegment && segments[0]?.id === seg.id));
            return (
              <button
                key={seg.id}
                onClick={() => loadSegment(seg.id)}
                disabled={loading}
                style={{
                  display: "flex", flexDirection: "column", gap: 2,
                  width: "100%", textAlign: "left",
                  padding: "8px 14px", cursor: loading ? "wait" : "pointer",
                  border: "none", borderRadius: 0,
                  background: active ? "rgba(0,232,157,0.08)" : "transparent",
                  borderLeft: active ? `2px solid ${colors.accent}` : "2px solid transparent",
                  transition: "all 0.12s",
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{
                  fontSize: 10, fontWeight: active ? 600 : 400,
                  color: active ? colors.textPrimary : colors.textSecondary,
                  fontFamily: fonts.sans,
                }}>
                  {seg.label}
                </div>
                <div style={{
                  fontSize: 8, color: colors.textDim, fontFamily: fonts.mono,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {seg.id}
                </div>
                {seg.tags.length > 0 && (
                  <div style={{ display: "flex", gap: 3, marginTop: 2, flexWrap: "wrap" }}>
                    {seg.tags.map((tag) => (
                      <span key={tag} style={{
                        fontSize: 7, fontFamily: fonts.mono, fontWeight: 600,
                        padding: "1px 5px", borderRadius: 3,
                        background: tag === "near-miss" || tag === "close-proximity"
                          ? "rgba(255,68,68,0.12)" : "rgba(0,200,219,0.1)",
                        color: tag === "near-miss" || tag === "close-proximity"
                          ? "#FF6B6B" : colors.accentBlue,
                        textTransform: "uppercase", letterSpacing: "0.5px",
                      }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}

          <Divider />

          {/* ── Drag & Drop hint ── */}
          <div style={{ padding: "12px 14px" }}>
            <div style={{
              borderRadius: 6,
              border: "1px dashed rgba(255,255,255,0.08)",
              padding: "10px 12px",
              textAlign: "center",
            }}>
              <div style={{ fontSize: 9, color: colors.textDim, fontFamily: fonts.mono, lineHeight: 1.5 }}>
                Drag & drop Waymo parquet files onto the canvas to load a custom segment
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Click-away backdrop */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "absolute", inset: 0, zIndex: 29,
            background: "rgba(0,0,0,0.2)",
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{
      fontSize: 8, fontWeight: 700, color: colors.textDim,
      fontFamily: fonts.mono, letterSpacing: "1.2px",
      padding: "6px 14px 3px", textTransform: "uppercase",
    }}>
      {title}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "rgba(255,255,255,0.04)", margin: "8px 12px" }} />;
}
