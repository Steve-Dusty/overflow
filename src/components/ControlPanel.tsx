/**
 * ControlPanel — Floating glass panel (top-left) with compact controls.
 * Colormap, opacity, perception mode, grid toggle, sensor stats.
 */

import { useStore } from "../store";
import type { ColormapMode, BoxDisplayMode } from "../store";
import { colors, fonts } from "../theme";
import { BOX_TYPE_COLORS, ALL_SCENARIOS, SCENARIO_INFO } from "../mockData";
import type { ScenarioId } from "../mockData";
import { generateTrajectoryMoments } from "../utils/trajectoryData";
import { loadScenario } from "../utils/scenarioLoader";

export default function ControlPanel() {
  const colormapMode = useStore((s) => s.colormapMode);
  const setColormapMode = useStore((s) => s.actions.setColormapMode);
  const boxMode = useStore((s) => s.boxMode);
  const setBoxMode = useStore((s) => s.actions.setBoxMode);
  const pointOpacity = useStore((s) => s.pointOpacity);
  const setPointOpacity = useStore((s) => s.actions.setPointOpacity);
  const showGrid = useStore((s) => s.showGrid);
  const toggleGrid = useStore((s) => s.actions.toggleGrid);
  const currentFrame = useStore((s) => s.currentFrame);
  const dataSource = useStore((s) => s.dataSource);
  const scenarioId = useStore((s) => s.scenarioId);
  const actions = useStore((s) => s.actions);

  const pts = currentFrame?.pointCount ?? 0;
  const boxCount = currentFrame?.boxes?.length ?? 0;

  return (
    <div style={{
      position: "absolute",
      top: 56, left: 12,
      width: 180,
      background: "rgba(12,15,26,0.75)",
      backdropFilter: "blur(20px)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 10,
      padding: "10px 0",
      fontFamily: fonts.sans,
      userSelect: "none",
      zIndex: 10,
      display: "flex",
      flexDirection: "column",
      gap: 2,
    }}>
      {/* ── Colormap ── */}
      <Label text="Colormap" />
      <Pills<ColormapMode>
        options={[
          { value: "intensity", label: "Int" },
          { value: "range", label: "Range" },
          { value: "elongation", label: "Elong" },
        ]}
        value={colormapMode}
        onChange={setColormapMode}
      />

      {/* ── Opacity ── */}
      <Label text="Opacity" />
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 10px" }}>
        <input
          type="range" min={10} max={100}
          value={Math.round(pointOpacity * 100)}
          onChange={(e) => setPointOpacity(Number(e.target.value) / 100)}
          style={{ flex: 1, height: 2, accentColor: colors.accent }}
        />
        <span style={{ fontSize: 9, fontFamily: fonts.mono, color: colors.textSecondary, minWidth: 24, textAlign: "right" }}>
          {Math.round(pointOpacity * 100)}%
        </span>
      </div>

      <Sep />

      {/* ── Perception ── */}
      <Label text="Perception" />
      <Pills<BoxDisplayMode>
        options={[
          { value: "off", label: "Off" },
          { value: "box", label: "Boxes" },
          { value: "model", label: "Models" },
        ]}
        value={boxMode}
        onChange={setBoxMode}
      />

      {/* Legend */}
      {boxMode !== "off" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1px 8px", padding: "4px 10px" }}>
          {([
            ["vehicle", "Veh"],
            ["pedestrian", "Ped"],
            ["cyclist", "Cyc"],
            ["sign", "Sign"],
          ] as const).map(([type, lbl]) => (
            <div key={type} style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{
                width: 6, height: 6, borderRadius: 1,
                backgroundColor: BOX_TYPE_COLORS[type],
              }} />
              <span style={{ fontSize: 8, color: colors.textDim }}>{lbl}</span>
            </div>
          ))}
        </div>
      )}

      <Sep />

      {/* ── Display ── */}
      <Label text="Display" />
      <Toggle label="Grid" active={showGrid} onToggle={toggleGrid} />

      {/* ── Scenario ── */}
      <Sep />
      <Label text="Scenario" />
      <div style={{ padding: "2px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
        {ALL_SCENARIOS.map((sc) => {
          const info = SCENARIO_INFO[sc];
          const active = dataSource === "scenario" && scenarioId === sc;
          const sevColor = info.severity === "critical" ? "#FF4444"
            : info.severity === "warning" ? "#FFB020" : colors.accent;
          return (
            <button
              key={sc}
              onClick={() => {
                loadScenario(sc).then((sceneData) => {
                  actions.setScenarioId(sc);
                  actions.setCustomIncident(null);
                  actions.setDataSource("scenario");
                  actions.setSceneData(sceneData);
                  const moments = generateTrajectoryMoments(sceneData);
                  actions.setTrajectoryMoments(moments);
                });
              }}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "4px 6px", borderRadius: 4, cursor: "pointer",
                border: "none",
                background: active ? "rgba(255,255,255,0.06)" : "transparent",
                transition: "all 0.12s",
              }}
            >
              <span style={{
                width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
                background: active ? sevColor : colors.textDim,
                boxShadow: active ? `0 0 6px ${sevColor}` : "none",
              }} />
              <span style={{
                fontSize: 9, fontFamily: fonts.sans, fontWeight: active ? 600 : 400,
                color: active ? colors.textPrimary : colors.textDim,
              }}>
                {info.label}
              </span>
              {active && info.severity !== "none" && (
                <span style={{
                  fontSize: 7, fontFamily: fonts.mono, fontWeight: 700,
                  color: sevColor, marginLeft: "auto",
                  textTransform: "uppercase", letterSpacing: "0.5px",
                }}>
                  {info.severity}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <Sep />

      {/* ── Sensor stats ── */}
      <Label text="Sensors" />
      <div style={{ padding: "2px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
        <SensorRow label="LiDAR" value={pts > 0 ? pts.toLocaleString() : "—"} active={pts > 0} />
        <SensorRow label="3D Boxes" value={boxCount > 0 ? String(boxCount) : "—"} active={boxCount > 0} />
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────

function Label({ text }: { text: string }) {
  return (
    <div style={{
      fontSize: 8, fontWeight: 700,
      color: colors.textDim,
      letterSpacing: "1.2px",
      textTransform: "uppercase",
      padding: "4px 12px 1px",
    }}>
      {text}
    </div>
  );
}

function Sep() {
  return <div style={{ height: 1, background: "rgba(255,255,255,0.04)", margin: "4px 8px" }} />;
}

function Pills<T extends string>({
  options, value, onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{
      display: "flex", gap: 2, margin: "0 8px",
      background: "rgba(255,255,255,0.03)",
      borderRadius: 5, padding: 2,
    }}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button key={opt.value} onClick={() => onChange(opt.value)} style={{
            flex: 1, padding: "4px 0", fontSize: 9,
            fontFamily: fonts.sans, fontWeight: active ? 600 : 400,
            border: "none", borderRadius: 4, cursor: "pointer",
            background: active ? "rgba(0,200,219,0.15)" : "transparent",
            color: active ? colors.accentBlue : colors.textDim,
            transition: "all 0.12s", letterSpacing: "0.3px",
          }}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ label, active, onToggle }: { label: string; active: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "4px 10px", margin: "0 4px",
      fontSize: 10, fontFamily: fonts.sans, fontWeight: 500,
      border: "none", borderRadius: 4, cursor: "pointer",
      background: active ? "rgba(255,255,255,0.04)" : "transparent",
      color: active ? colors.textPrimary : colors.textDim,
      transition: "all 0.12s",
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: active ? colors.accent : colors.textDim,
        boxShadow: active ? `0 0 6px ${colors.accent}` : "none",
      }} />
      {label}
    </button>
  );
}

function SensorRow({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between",
      fontSize: 9, fontFamily: fonts.sans,
      color: active ? colors.textSecondary : colors.textDim,
      opacity: active ? 1 : 0.5,
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
        <span style={{
          width: 4, height: 4, borderRadius: "50%",
          background: active ? colors.accent : colors.textDim,
        }} />
        {label}
      </span>
      <span style={{ fontFamily: fonts.mono }}>{value}</span>
    </div>
  );
}
