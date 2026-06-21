/**
 * PointCloud — ZERO React re-renders during playback.
 * Reads frame data directly from Zustand store inside useFrame (Three.js loop).
 * Uses pre-baked LUT for fast colormap, bulk position copy, no computeBoundingSphere.
 */

import { useRef, useMemo, useContext } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useStore } from "../store";
import type { ColormapMode } from "../store";
import type { FrameData } from "../mockData";
import { FrameOverrideContext } from "./FrameOverrideContext";

// ── Pre-baked 256-entry LUT colormaps ──────────────────────────

const INTENSITY_STOPS: [number, number, number][] = [
  [0.08, 0.09, 0.16], [0.16, 0.20, 0.32], [0.30, 0.38, 0.52],
  [0.52, 0.60, 0.72], [0.78, 0.84, 0.90], [0.95, 0.97, 1.00],
];
const RANGE_STOPS: [number, number, number][] = [
  [0.06, 0.04, 0.12], [0.28, 0.08, 0.26], [0.60, 0.15, 0.20],
  [0.88, 0.40, 0.10], [0.98, 0.72, 0.15], [1.00, 0.98, 0.60],
];
const ELONGATION_STOPS: [number, number, number][] = [
  [0.04, 0.06, 0.10], [0.06, 0.18, 0.22], [0.08, 0.38, 0.30],
  [0.20, 0.62, 0.35], [0.50, 0.84, 0.40], [0.80, 0.98, 0.55],
];

function bakeLUT(stops: [number, number, number][]): Float32Array {
  const lut = new Float32Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const idx = t * (stops.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, stops.length - 1);
    const f = idx - lo;
    lut[i * 3] = stops[lo][0] + f * (stops[hi][0] - stops[lo][0]);
    lut[i * 3 + 1] = stops[lo][1] + f * (stops[hi][1] - stops[lo][1]);
    lut[i * 3 + 2] = stops[lo][2] + f * (stops[hi][2] - stops[lo][2]);
  }
  return lut;
}

const LUTS: Record<ColormapMode, Float32Array> = {
  intensity: bakeLUT(INTENSITY_STOPS),
  range: bakeLUT(RANGE_STOPS),
  elongation: bakeLUT(ELONGATION_STOPS),
};
const ATTR_RANGE: Record<ColormapMode, [number, number]> = {
  intensity: [0, 1], range: [0, 75], elongation: [0, 1],
};
const ATTR_INDEX: Record<ColormapMode, number> = {
  intensity: 0, range: 1, elongation: 2,
};

const MAX_POINTS = 250_000;
const MAX_POINTS_LITE = 18_000;

export default function PointCloud({ lite = false }: { lite?: boolean }) {
  const maxPts = lite ? MAX_POINTS_LITE : MAX_POINTS;
  const geometryRef = useRef<THREE.BufferGeometry>(null);
  const lastFrameRef = useRef<FrameData | null>(null);
  const lastColormapRef = useRef<ColormapMode>("intensity");

  const { posAttr, colorAttr } = useMemo(() => {
    const pos = new THREE.Float32BufferAttribute(new Float32Array(maxPts * 3), 3);
    const col = new THREE.Float32BufferAttribute(new Float32Array(maxPts * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    col.setUsage(THREE.DynamicDrawUsage);
    return { posAttr: pos, colorAttr: col };
  }, [maxPts]);

  // Read opacity once via subscription (rarely changes)
  const pointOpacity = useStore((s) => s.pointOpacity);

  // Frame override for independent dashboard tiles — stable ref holder, no re-renders
  const overrideHolder = useContext(FrameOverrideContext);

  useFrame(() => {
    const geom = geometryRef.current;
    if (!geom) return;

    // Use override if provided, otherwise read from global store
    const state = useStore.getState();
    const currentFrame = overrideHolder?.current ?? state.currentFrame;
    const colormapMode = state.colormapMode;

    // Early out if nothing changed
    if (currentFrame === lastFrameRef.current && colormapMode === lastColormapRef.current) return;
    lastFrameRef.current = currentFrame;
    lastColormapRef.current = colormapMode;

    if (!currentFrame || !currentFrame.pointPositions || currentFrame.pointCount === 0) {
      geom.setDrawRange(0, 0);
      return;
    }

    const { pointPositions, pointAttributes, pointCount } = currentFrame;
    const posArr = posAttr.array as Float32Array;
    const colArr = colorAttr.array as Float32Array;
    const lut = LUTS[colormapMode];
    const attrIdx = ATTR_INDEX[colormapMode];
    const [attrMin, attrMax] = ATTR_RANGE[colormapMode];
    const invSpan = 1 / (attrMax - attrMin);

    // In lite mode, stride through points to downsample (e.g. take every Nth point)
    const stride = lite ? Math.max(1, Math.ceil(pointCount / maxPts)) : 1;
    const total = Math.min(Math.ceil(pointCount / stride), maxPts);

    if (stride === 1) {
      // Bulk copy positions (fast path)
      posArr.set(pointPositions.subarray(0, total * 3));
    } else {
      // Strided copy for lite mode
      for (let i = 0; i < total; i++) {
        const src = i * stride * 3;
        const dst = i * 3;
        posArr[dst] = pointPositions[src];
        posArr[dst + 1] = pointPositions[src + 1];
        posArr[dst + 2] = pointPositions[src + 2];
      }
    }

    // Fast LUT-based coloring
    for (let i = 0; i < total; i++) {
      const srcIdx = (stride === 1 ? i : i * stride);
      const raw = pointAttributes[srcIdx * 3 + attrIdx];
      const t = (raw - attrMin) * invSpan;
      const lutIdx = Math.max(0, Math.min(255, (t * 255) | 0)) * 3;
      const dst = i * 3;
      colArr[dst] = lut[lutIdx];
      colArr[dst + 1] = lut[lutIdx + 1];
      colArr[dst + 2] = lut[lutIdx + 2];
    }

    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    geom.setDrawRange(0, total);
  });

  return (
    <points frustumCulled={false}>
      <bufferGeometry ref={geometryRef}>
        <primitive object={posAttr} attach="attributes-position" />
        <primitive object={colorAttr} attach="attributes-color" />
      </bufferGeometry>
      <pointsMaterial
        size={lite ? 0.12 : 0.06}
        sizeAttenuation
        vertexColors
        transparent
        opacity={pointOpacity}
        depthWrite={false}
      />
    </points>
  );
}
