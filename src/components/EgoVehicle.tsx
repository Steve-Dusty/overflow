/**
 * EgoVehicle — Waymo-style car model sitting at the origin.
 * Uses the same car.glb as detected vehicles but in a distinct Waymo teal color.
 * Falls back to a geometric shape if the GLB hasn't loaded yet.
 */

import { Suspense } from "react";
import { colors } from "../theme";
import { VehicleModel } from "./ObjectModels";

// Waymo ego car is roughly 4.9m × 2.1m × 1.7m
const EGO_LENGTH = 4.9;
const EGO_WIDTH = 2.1;
const EGO_HEIGHT = 1.7;

function EgoFallback() {
  return (
    <group position={[0, 0, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.4, 0.06, 8, 24]} />
        <meshBasicMaterial color={colors.accent} transparent opacity={0.8} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshBasicMaterial color={colors.accent} />
      </mesh>
      <mesh position={[1.3, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.15, 0.5, 6]} />
        <meshBasicMaterial color={colors.accent} transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

export default function EgoVehicle() {
  return (
    <group position={[0, 0, EGO_HEIGHT / 2]}>
      <Suspense fallback={<EgoFallback />}>
        <group scale={[EGO_LENGTH, EGO_WIDTH, EGO_HEIGHT]}>
          <VehicleModel color={colors.accent} />
        </group>
      </Suspense>
      {/* Small forward direction arrow above car */}
      <mesh position={[EGO_LENGTH / 2 + 0.5, 0, EGO_HEIGHT / 2 + 0.3]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.18, 0.6, 6]} />
        <meshBasicMaterial color={colors.accent} transparent opacity={0.7} />
      </mesh>
      {/* Glow ring at base */}
      <mesh position={[0, 0, -EGO_HEIGHT / 2 + 0.02]} rotation={[0, 0, 0]}>
        <ringGeometry args={[2.5, 2.8, 32]} />
        <meshBasicMaterial color={colors.accent} transparent opacity={0.12} side={2} />
      </mesh>
    </group>
  );
}
