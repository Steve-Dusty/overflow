/**
 * ObjectModels — 3D GLB models for each detection type.
 * VEHICLE → car.glb, PEDESTRIAN → person.glb, CYCLIST → cyclist.glb, SIGN → sign.glb
 * Each model is normalized to fill a unit cube so parent can scale by bbox dimensions.
 *
 * Coordinate frame: X=forward, Y=left, Z=up (Waymo convention).
 */

import { useMemo, useRef, useEffect, Suspense } from "react";
import * as THREE from "three";
import { useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// GLB (Y-up, -Z-forward) → Waymo (Z-up, X-forward) axis correction
const GLB_TO_WAYMO_QUAT = (() => {
  const m = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, -1, 0), // GLB X → Waymo −Y
    new THREE.Vector3(0, 0, 1),  // GLB Y → Waymo +Z
    new THREE.Vector3(-1, 0, 0)  // GLB Z → Waymo −X
  );
  return new THREE.Quaternion().setFromRotationMatrix(m);
})();

// ── Shared GLB loader ──────────────────────────────────────────────

function GLBModel({
  url,
  color,
  yawOffset = 0,
  preserveDepth = false,
}: {
  url: string;
  color: string;
  yawOffset?: number;
  preserveDepth?: boolean;
}) {
  const gltf = useLoader(GLTFLoader, url);
  const groupRef = useRef<THREE.Group>(null);

  const built = useMemo(() => {
    const scene = gltf.scene.clone(true);

    const mat = new THREE.MeshPhongMaterial({ color, flatShading: true });
    const toRemove: THREE.Object3D[] = [];
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (
          child.name.startsWith("CSH.") ||
          child.parent?.name.startsWith("CSH.")
        ) {
          toRemove.push(child);
        } else {
          child.material = mat;
        }
      }
    });
    toRemove.forEach((obj) => obj.parent?.remove(obj));

    if (yawOffset !== 0) scene.rotation.y = yawOffset;

    const rotGroup = new THREE.Group();
    rotGroup.quaternion.copy(GLB_TO_WAYMO_QUAT);
    rotGroup.add(scene);
    rotGroup.updateMatrixWorld(true);

    const bbox = new THREE.Box3().setFromObject(rotGroup);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    bbox.getSize(size);
    bbox.getCenter(center);

    const sy = size.y > 0.001 ? 1 / size.y : 1;
    const sz = size.z > 0.001 ? 1 / size.z : 1;
    const sx = preserveDepth
      ? (sy + sz) / 2
      : size.x > 0.001
        ? 1 / size.x
        : 1;

    const wrapper = new THREE.Group();
    wrapper.scale.set(sx, sy, sz);
    wrapper.position.set(-center.x * sx, -center.y * sy, -center.z * sz);
    wrapper.add(rotGroup);

    return wrapper;
  }, [gltf, color]);

  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.clear();
      groupRef.current.add(built);
    }
  }, [built]);

  return <group ref={groupRef} />;
}

function FallbackBox({ color }: { color: string }) {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.3}
        depthWrite={false}
      />
    </mesh>
  );
}

// ── Exported model components ──────────────────────────────────────

export function VehicleModel({ color }: { color: string }) {
  return (
    <Suspense fallback={<FallbackBox color={color} />}>
      <GLBModel url="/models/car.glb" color={color} yawOffset={Math.PI} />
    </Suspense>
  );
}

export function PedestrianModel({ color }: { color: string }) {
  return (
    <Suspense fallback={<FallbackBox color={color} />}>
      <GLBModel url="/models/person.glb" color={color} />
    </Suspense>
  );
}

export function SignModel({ color }: { color: string }) {
  return (
    <Suspense fallback={<FallbackBox color={color} />}>
      <GLBModel url="/models/sign.glb" color={color} preserveDepth />
    </Suspense>
  );
}

export function CyclistModel({ color }: { color: string }) {
  return (
    <Suspense fallback={<FallbackBox color={color} />}>
      <GLBModel
        url="/models/cyclist.glb"
        color={color}
        yawOffset={Math.PI / 2}
      />
    </Suspense>
  );
}
