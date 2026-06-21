/**
 * BoundingBoxes — ZERO React re-renders during playback for "box" mode.
 * Uses InstancedMesh + lineSegments, reads store directly in useFrame.
 * In "model" mode, renders GLB models via ModelInstances.
 */

import { useRef, useMemo, useContext, Suspense } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useStore } from "../store";
import { BOX_TYPE_COLORS } from "../mockData";
import type { ActorType, BBox3D, FrameData } from "../mockData";
import { FrameOverrideContext } from "./FrameOverrideContext";
import {
  VehicleModel,
  PedestrianModel,
  CyclistModel,
  SignModel,
} from "./ObjectModels";

const MAX_INSTANCES = 300;
const _boxGeo = new THREE.BoxGeometry(1, 1, 1);
const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();
const _color = new THREE.Color();

const TYPE_COLORS: Record<string, string> = BOX_TYPE_COLORS;
function getColor(type: ActorType | string): string {
  return TYPE_COLORS[type] ?? "#888888";
}

const EDGE_VERTS_PER_BOX = 24;
const MAX_EDGE_VERTS = MAX_INSTANCES * EDGE_VERTS_PER_BOX;

const UNIT_CUBE_EDGES: [number, number, number, number, number, number][] = [
  [-0.5,-0.5,-0.5, 0.5,-0.5,-0.5], [0.5,-0.5,-0.5, 0.5,0.5,-0.5],
  [0.5,0.5,-0.5, -0.5,0.5,-0.5],   [-0.5,0.5,-0.5, -0.5,-0.5,-0.5],
  [-0.5,-0.5,0.5, 0.5,-0.5,0.5],   [0.5,-0.5,0.5, 0.5,0.5,0.5],
  [0.5,0.5,0.5, -0.5,0.5,0.5],     [-0.5,0.5,0.5, -0.5,-0.5,0.5],
  [-0.5,-0.5,-0.5, -0.5,-0.5,0.5], [0.5,-0.5,-0.5, 0.5,-0.5,0.5],
  [0.5,0.5,-0.5, 0.5,0.5,0.5],     [-0.5,0.5,-0.5, -0.5,0.5,0.5],
];

// ── Wireframe + Fill boxes (box mode) ─────────────────────────────

function WireframeBoxes() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const edgeGeoRef = useRef<THREE.BufferGeometry>(null);
  const lastFrameRef = useRef<FrameData | null>(null);
  const lastModeRef = useRef("box");

  const fillMat = useMemo(() => new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.15, depthWrite: false, side: THREE.DoubleSide,
  }), []);

  const edgeMat = useMemo(() => new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 1 }), []);

  const edgePositions = useMemo(() => new Float32Array(MAX_EDGE_VERTS * 3), []);
  const edgeColors = useMemo(() => new Float32Array(MAX_EDGE_VERTS * 3), []);
  const fillColors = useMemo(() => new Float32Array(MAX_INSTANCES * 3), []);

  const overrideHolder = useContext(FrameOverrideContext);

  useFrame(() => {
    const fillMesh = meshRef.current;
    const edgeGeo = edgeGeoRef.current;
    if (!fillMesh || !edgeGeo) return;

    const state = useStore.getState();
    const currentFrame = overrideHolder?.current ?? state.currentFrame;
    const boxMode = state.boxMode;

    if (currentFrame === lastFrameRef.current && boxMode === lastModeRef.current) return;
    lastFrameRef.current = currentFrame;
    lastModeRef.current = boxMode;

    // Hide in model mode or off mode
    if (boxMode !== "box" || !currentFrame) {
      fillMesh.count = 0;
      edgeGeo.setDrawRange(0, 0);
      return;
    }

    const boxes = currentFrame.boxes;
    const count = Math.min(boxes.length, MAX_INSTANCES);
    let edgeVertIdx = 0;

    for (let i = 0; i < count; i++) {
      const b = boxes[i];
      _pos.set(b.cx, b.cy, b.cz);
      _euler.set(0, 0, b.heading);
      _quat.setFromEuler(_euler);
      _scale.set(b.sx, b.sy, b.sz);
      _mat4.compose(_pos, _quat, _scale);

      fillMesh.setMatrixAt(i, _mat4);

      _color.set(getColor(b.type));
      fillColors[i * 3] = _color.r;
      fillColors[i * 3 + 1] = _color.g;
      fillColors[i * 3 + 2] = _color.b;

      for (const edge of UNIT_CUBE_EDGES) {
        for (let v = 0; v < 2; v++) {
          _pos.set(edge[v * 3], edge[v * 3 + 1], edge[v * 3 + 2]);
          _pos.applyMatrix4(_mat4);
          const dst = edgeVertIdx * 3;
          edgePositions[dst] = _pos.x;
          edgePositions[dst + 1] = _pos.y;
          edgePositions[dst + 2] = _pos.z;
          edgeColors[dst] = _color.r;
          edgeColors[dst + 1] = _color.g;
          edgeColors[dst + 2] = _color.b;
          edgeVertIdx++;
        }
      }
    }

    fillMesh.count = count;
    fillMesh.instanceMatrix.needsUpdate = true;
    if (!fillMesh.instanceColor) {
      fillMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 3), 3);
    }
    (fillMesh.instanceColor.array as Float32Array).set(fillColors.subarray(0, count * 3));
    fillMesh.instanceColor.needsUpdate = true;

    const posAttr = edgeGeo.getAttribute("position") as THREE.BufferAttribute;
    const colAttr = edgeGeo.getAttribute("color") as THREE.BufferAttribute;
    (posAttr.array as Float32Array).set(edgePositions.subarray(0, edgeVertIdx * 3));
    (colAttr.array as Float32Array).set(edgeColors.subarray(0, edgeVertIdx * 3));
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    edgeGeo.setDrawRange(0, edgeVertIdx);
  });

  return (
    <>
      <instancedMesh ref={meshRef} args={[_boxGeo, fillMat, MAX_INSTANCES]} frustumCulled={false} />
      <lineSegments frustumCulled={false} material={edgeMat}>
        <bufferGeometry ref={edgeGeoRef}>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array(MAX_EDGE_VERTS * 3), 3]}
            usage={THREE.DynamicDrawUsage}
          />
          <bufferAttribute
            attach="attributes-color"
            args={[new Float32Array(MAX_EDGE_VERTS * 3), 3]}
            usage={THREE.DynamicDrawUsage}
          />
        </bufferGeometry>
      </lineSegments>
    </>
  );
}

// ── GLB model instances (model mode) ──────────────────────────────

function ModelForType({ box }: { box: BBox3D }) {
  const color = getColor(box.type);
  switch (box.type) {
    case "vehicle":
      return <VehicleModel color={color} />;
    case "pedestrian":
      return <PedestrianModel color={color} />;
    case "cyclist":
      return <CyclistModel color={color} />;
    case "sign":
      return <SignModel color={color} />;
    default:
      return (
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color={color} transparent opacity={0.3} depthWrite={false} />
        </mesh>
      );
  }
}

function ModelInstances() {
  const storeFrame = useStore((s) => s.currentFrame);
  const boxMode = useStore((s) => s.boxMode);
  const overrideHolder = useContext(FrameOverrideContext);
  const currentFrame = overrideHolder?.current ?? storeFrame;

  if (boxMode !== "model" || !currentFrame) return null;

  const boxes = currentFrame.boxes;

  return (
    <Suspense fallback={null}>
      {boxes.map((b, i) => (
        <group
          key={b.trackId !== undefined ? `${b.trackId}` : `box-${i}`}
          position={[b.cx, b.cy, b.cz]}
          rotation={[0, 0, b.heading]}
          scale={[b.sx, b.sy, b.sz]}
        >
          <ModelForType box={b} />
        </group>
      ))}
    </Suspense>
  );
}

// ── Lite fill-only boxes (no edge wireframes, no GLB models) ─────

function LiteBoxes() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const lastFrameRef = useRef<FrameData | null>(null);
  const fillColors = useMemo(() => new Float32Array(MAX_INSTANCES * 3), []);

  const fillMat = useMemo(() => new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide,
  }), []);

  const overrideHolder = useContext(FrameOverrideContext);

  useFrame(() => {
    const fillMesh = meshRef.current;
    if (!fillMesh) return;

    const state = useStore.getState();
    const currentFrame = overrideHolder?.current ?? state.currentFrame;

    if (currentFrame === lastFrameRef.current) return;
    lastFrameRef.current = currentFrame;

    if (!currentFrame || state.boxMode === "off") {
      fillMesh.count = 0;
      return;
    }

    const boxes = currentFrame.boxes;
    const count = Math.min(boxes.length, MAX_INSTANCES);

    for (let i = 0; i < count; i++) {
      const b = boxes[i];
      _pos.set(b.cx, b.cy, b.cz);
      _euler.set(0, 0, b.heading);
      _quat.setFromEuler(_euler);
      _scale.set(b.sx, b.sy, b.sz);
      _mat4.compose(_pos, _quat, _scale);
      fillMesh.setMatrixAt(i, _mat4);

      _color.set(getColor(b.type));
      fillColors[i * 3] = _color.r;
      fillColors[i * 3 + 1] = _color.g;
      fillColors[i * 3 + 2] = _color.b;
    }

    fillMesh.count = count;
    fillMesh.instanceMatrix.needsUpdate = true;
    if (!fillMesh.instanceColor) {
      fillMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 3), 3);
    }
    (fillMesh.instanceColor.array as Float32Array).set(fillColors.subarray(0, count * 3));
    fillMesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[_boxGeo, fillMat, MAX_INSTANCES]} frustumCulled={false} />
  );
}

// ── Main export ───────────────────────────────────────────────────

export default function BoundingBoxes({ lite = false }: { lite?: boolean }) {
  if (lite) return <LiteBoxes />;
  return (
    <>
      <WireframeBoxes />
      <ModelInstances />
    </>
  );
}
