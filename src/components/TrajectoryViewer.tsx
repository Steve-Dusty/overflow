/**
 * TrajectoryViewer — 3D overlay rendered inside the R3F Canvas.
 * Draws:
 *   • Past ego trajectory (thick blue polyline)
 *   • 3 candidate future trajectories (green/orange/red)
 *   • Labels near the end of each candidate with score
 *   • Highlight which trajectory the planner and observer picked
 *   • Current ego position marker
 *
 * Reads trajectory moments from Zustand store for the current moment.
 */

import { useRef, useMemo } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { useStore } from "../store";
import {
  getPlannerChoice,
  getObserverChoice,
  CANDIDATE_COLORS,
  PAST_TRAJECTORY_COLOR,
  type TrajectoryMoment,
} from "../utils/trajectoryData";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTubeGeometry(
  points: { x: number; y: number }[],
  radius: number,
): THREE.TubeGeometry | null {
  if (points.length < 2) return null;
  const pts = points.map((p) => new THREE.Vector3(p.x, p.y, 0.15));
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  return new THREE.TubeGeometry(curve, Math.max(8, points.length * 2), radius, 6, false);
}

// ---------------------------------------------------------------------------
// Single trajectory line
// ---------------------------------------------------------------------------

function TrajectoryLine({
  points,
  color,
  lineWidth,
  dashed,
  opacity,
}: {
  points: { x: number; y: number }[];
  color: string;
  lineWidth: number;
  dashed?: boolean;
  opacity?: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => createTubeGeometry(points, lineWidth), [points, lineWidth]);

  if (!geo) return null;

  return (
    <mesh ref={ref} geometry={geo}>
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity ?? 0.85}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Candidate trajectory with label + glow effect
// ---------------------------------------------------------------------------

function CandidateTrajectoryLine({
  points,
  color,
  score,
  label,
  isPlannerPick,
  isObserverPick,
}: {
  points: { x: number; y: number }[];
  color: string;
  score: number;
  label: string;
  isPlannerPick: boolean;
  isObserverPick: boolean;
}) {
  if (points.length < 2) return null;

  const endPoint = points[points.length - 1];
  const baseWidth = 0.08;
  const width = isPlannerPick || isObserverPick ? baseWidth * 2.2 : baseWidth;
  const opacity = isPlannerPick || isObserverPick ? 1.0 : 0.5;

  return (
    <group>
      {/* Main line */}
      <TrajectoryLine
        points={points}
        color={color}
        lineWidth={width}
        opacity={opacity}
      />

      {/* Glow for planner/observer picks */}
      {(isPlannerPick || isObserverPick) && (
        <TrajectoryLine
          points={points}
          color={color}
          lineWidth={width * 2.5}
          opacity={0.15}
        />
      )}

      {/* End marker sphere */}
      <mesh position={[endPoint.x, endPoint.y, 0.3]}>
        <sphereGeometry args={[isPlannerPick || isObserverPick ? 0.4 : 0.25, 12, 8]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>

      {/* Label */}
      <Html
        position={[endPoint.x, endPoint.y, 0.8]}
        center
        distanceFactor={30}
        style={{ pointerEvents: "none" }}
      >
        <div
          style={{
            background: "rgba(8,12,22,0.9)",
            backdropFilter: "blur(8px)",
            border: `1px solid ${color}60`,
            borderRadius: 6,
            padding: "3px 8px",
            whiteSpace: "nowrap",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 1,
          }}
        >
          <span style={{ fontSize: 9, fontWeight: 700, color, fontFamily: "monospace" }}>
            {score.toFixed(1)}
          </span>
          <span style={{ fontSize: 7, color: "#8892A8", fontFamily: "sans-serif" }}>
            {label}
          </span>
          {isPlannerPick && (
            <span
              style={{
                fontSize: 6,
                fontWeight: 700,
                color: "#FF4444",
                background: "rgba(255,68,68,0.15)",
                padding: "1px 4px",
                borderRadius: 3,
                letterSpacing: "0.5px",
              }}
            >
              PLANNER
            </span>
          )}
          {isObserverPick && (
            <span
              style={{
                fontSize: 6,
                fontWeight: 700,
                color: "#00E89D",
                background: "rgba(0,232,157,0.15)",
                padding: "1px 4px",
                borderRadius: 3,
                letterSpacing: "0.5px",
              }}
            >
              OBSERVER
            </span>
          )}
        </div>
      </Html>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Past trajectory marker (ego arrow)
// ---------------------------------------------------------------------------

function EgoArrow({ x, y, yaw }: { x: number; y: number; yaw: number }) {
  return (
    <group position={[x, y, 0.2]} rotation={[0, 0, yaw]}>
      <mesh>
        <coneGeometry args={[0.5, 1.2, 4]} />
        <meshBasicMaterial color="#00E89D" transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function TrajectoryViewer() {
  const showTrajectories = useStore((s) => s.showTrajectories);
  const moments = useStore((s) => s.trajectoryMoments);
  const momentIndex = useStore((s) => s.currentMomentIndex);
  const plannerPolicy = useStore((s) => s.plannerPolicy);
  const observerPolicy = useStore((s) => s.observerPolicy);

  if (!showTrajectories || moments.length === 0) return null;

  const moment = moments[momentIndex];
  if (!moment) return null;

  const plannerChoice = getPlannerChoice(moment, plannerPolicy);
  const observerChoice = getObserverChoice(moment, observerPolicy, plannerChoice);

  return (
    <group>
      {/* Past trajectory */}
      <TrajectoryLine
        points={moment.pastTrajectory}
        color={PAST_TRAJECTORY_COLOR}
        lineWidth={0.12}
        opacity={0.7}
      />

      {/* Past trajectory dots */}
      {moment.pastTrajectory.filter((_, i) => i % 3 === 0).map((pt, i) => (
        <mesh key={`past-${i}`} position={[pt.x, pt.y, 0.15]}>
          <sphereGeometry args={[0.12, 8, 6]} />
          <meshBasicMaterial color={PAST_TRAJECTORY_COLOR} transparent opacity={0.6} />
        </mesh>
      ))}

      {/* Candidate future trajectories */}
      {moment.candidates.map((candidate, idx) => (
        <CandidateTrajectoryLine
          key={`cand-${idx}`}
          points={candidate.points}
          color={CANDIDATE_COLORS[idx % CANDIDATE_COLORS.length]}
          score={candidate.score}
          label={candidate.label}
          isPlannerPick={idx === plannerChoice}
          isObserverPick={idx === observerChoice}
        />
      ))}

      {/* Current ego position marker */}
      {moment.pastTrajectory.length > 0 && (
        <EgoArrow
          x={moment.pastTrajectory[moment.pastTrajectory.length - 1].x}
          y={moment.pastTrajectory[moment.pastTrajectory.length - 1].y}
          yaw={moment.pastTrajectory[moment.pastTrajectory.length - 1].yaw}
        />
      )}
    </group>
  );
}
