/**
 * CameraViews — 4 synthetic camera perspective panels (FRONT-LEFT, FRONT-RIGHT,
 * SIDE-LEFT, SIDE-RIGHT). Uses 2D canvas with Three.js projection math to draw
 * bounding boxes from each camera viewpoint. Styled as security-camera feeds.
 */

import { useRef, useEffect, useCallback, useState } from "react";
import * as THREE from "three";
import { useStore } from "../store";
import { colors, fonts } from "../theme";
import { BOX_TYPE_COLORS } from "../mockData";
import type { BBox3D } from "../mockData";

const CAM_W = 220;
const CAM_H = 140;

interface CamDef {
  name: string;
  pos: [number, number, number];
  target: [number, number, number];
  fov: number;
}

const CAMERA_DEFS: CamDef[] = [
  { name: "FRONT-LEFT",  pos: [2.0, 0.6, 1.6],  target: [40, 12, 0],   fov: 70  },
  { name: "FRONT-RIGHT", pos: [2.0, -0.6, 1.6], target: [40, -12, 0],  fov: 70  },
  { name: "SIDE-LEFT",   pos: [0, 0.8, 1.6],    target: [-5, 30, 0],   fov: 100 },
  { name: "SIDE-RIGHT",  pos: [0, -0.8, 1.6],   target: [-5, -30, 0],  fov: 100 },
];

const EDGES: [number, number][] = [
  [0,1],[2,3],[4,5],[6,7],
  [0,2],[1,3],[4,6],[5,7],
  [0,4],[1,5],[2,6],[3,7],
];

function getCorners(b: BBox3D): THREE.Vector3[] {
  const cos = Math.cos(b.heading), sin = Math.sin(b.heading);
  const hx = b.sx / 2, hy = b.sy / 2, hz = b.sz / 2;
  const out: THREE.Vector3[] = [];
  for (const dx of [-hx, hx])
    for (const dy of [-hy, hy])
      for (const dz of [-hz, hz])
        out.push(new THREE.Vector3(
          dx * cos - dy * sin + b.cx,
          dx * sin + dy * cos + b.cy,
          b.cz + dz,
        ));
  return out;
}

function renderView(
  ctx: CanvasRenderingContext2D,
  boxes: BBox3D[],
  def: CamDef,
  w: number,
  h: number,
  frameIdx: number,
) {
  ctx.clearRect(0, 0, w, h);

  // Background
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#080c16");
  grad.addColorStop(0.6, "#0c1220");
  grad.addColorStop(1, "#0f1830");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Camera
  const cam = new THREE.PerspectiveCamera(def.fov, w / h, 0.1, 200);
  cam.position.set(...def.pos);
  cam.up.set(0, 0, 1);
  cam.lookAt(new THREE.Vector3(...def.target));
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();

  // Road lanes
  ctx.strokeStyle = "rgba(60, 75, 95, 0.18)";
  ctx.lineWidth = 0.5;
  for (const ly of [-3.7, 0, 3.7, 7.4]) {
    ctx.beginPath();
    let started = false;
    for (let x = -5; x <= 80; x += 1) {
      const v = new THREE.Vector3(x, ly, 0).project(cam);
      if (v.z < -1 || v.z > 1) continue;
      const sx = ((v.x + 1) / 2) * w;
      const sy = ((1 - v.y) / 2) * h;
      if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;
      if (!started) { ctx.moveTo(sx, sy); started = true; }
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  }

  // Center dash
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = "rgba(100, 120, 140, 0.12)";
  ctx.beginPath();
  let started = false;
  for (let x = 0; x <= 80; x += 1) {
    const v = new THREE.Vector3(x, 3.7, 0).project(cam);
    if (v.z < -1 || v.z > 1) continue;
    const sx = ((v.x + 1) / 2) * w;
    const sy = ((1 - v.y) / 2) * h;
    if (!started) { ctx.moveTo(sx, sy); started = true; }
    else ctx.lineTo(sx, sy);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Boxes
  for (const box of boxes) {
    const corners = getCorners(box);
    const proj = corners.map((c) => {
      const v = c.clone().project(cam);
      return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, vis: v.z >= -1 && v.z <= 1 };
    });
    if (proj.every((p) => !p.vis)) continue;
    if (!proj.some((p) => p.vis && p.x >= -30 && p.x <= w + 30 && p.y >= -30 && p.y <= h + 30)) continue;

    const clr = BOX_TYPE_COLORS[box.type] || "#6B7280";

    // Fill the bottom face semi-transparent
    const bottomFace = [proj[0], proj[2], proj[6], proj[4]];
    if (bottomFace.every((p) => p.vis)) {
      ctx.fillStyle = clr + "12";
      ctx.beginPath();
      ctx.moveTo(bottomFace[0].x, bottomFace[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(bottomFace[i].x, bottomFace[i].y);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = clr;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.85;
    for (const [i, j] of EDGES) {
      if (!proj[i].vis || !proj[j].vis) continue;
      ctx.beginPath();
      ctx.moveTo(proj[i].x, proj[i].y);
      ctx.lineTo(proj[j].x, proj[j].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Label + distance
    const visP = proj.filter((p) => p.vis);
    if (visP.length > 0) {
      const cx = visP.reduce((s, p) => s + p.x, 0) / visP.length;
      const ty = Math.min(...visP.map((p) => p.y));
      if (cx > 5 && cx < w - 5 && ty > 14 && ty < h) {
        const dist = Math.sqrt(box.cx ** 2 + box.cy ** 2);
        ctx.fillStyle = clr;
        ctx.font = `bold 7px ${fonts.mono}`;
        ctx.textAlign = "center";
        ctx.fillText(`${dist.toFixed(0)}m`, cx, ty - 3);
      }
    }
  }

  // Camera label
  ctx.fillStyle = colors.accent;
  ctx.font = `bold 8px ${fonts.mono}`;
  ctx.textAlign = "left";
  ctx.fillText(def.name, 4, 12);

  // REC indicator
  const blink = Math.floor(frameIdx / 5) % 2 === 0;
  if (blink) {
    ctx.fillStyle = "#FF3333";
    ctx.beginPath();
    ctx.arc(w - 8, 8, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = `6px ${fonts.mono}`;
  ctx.textAlign = "right";
  ctx.fillText("REC", w - 14, 10);

  // Scan lines
  ctx.strokeStyle = "rgba(255,255,255,0.012)";
  ctx.lineWidth = 0.5;
  for (let y = 0; y < h; y += 3) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Border
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}

function CameraPanel({ def, index }: { def: CamDef; index: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastFrame = useRef(-1);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const state = useStore.getState();
    if (!state.currentFrame) return;
    if (state.currentFrameIndex === lastFrame.current) return;
    lastFrame.current = state.currentFrameIndex;
    renderView(ctx, state.currentFrame.boxes, def, CAM_W, CAM_H, state.currentFrameIndex);
  }, [def]);

  useEffect(() => {
    draw();
    const unsub = useStore.subscribe(draw);
    return unsub;
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      width={CAM_W}
      height={CAM_H}
      style={{ width: CAM_W, height: CAM_H, borderRadius: 4 }}
    />
  );
}

export default function CameraViews() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 80,
        left: 8,
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        background: "rgba(8,12,22,0.7)",
        backdropFilter: "blur(16px)",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.05)",
        overflow: "hidden",
        userSelect: "none",
      }}
    >
      {/* Header */}
      <div
        onClick={() => setCollapsed((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 8px",
          cursor: "pointer",
          borderBottom: collapsed ? "none" : "1px solid rgba(255,255,255,0.04)",
        }}
      >
        <span style={{ fontSize: 9, fontWeight: 700, color: colors.textDim, fontFamily: fonts.mono, letterSpacing: "1px" }}>
          📷 CAMERAS
        </span>
        <span style={{ fontSize: 8, color: colors.textDim }}>{collapsed ? "▶" : "▼"}</span>
      </div>

      {!collapsed && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, padding: 2 }}>
          {CAMERA_DEFS.map((def, i) => (
            <CameraPanel key={def.name} def={def} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
