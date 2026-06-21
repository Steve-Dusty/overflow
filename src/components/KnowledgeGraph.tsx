/**
 * KnowledgeGraph — Enhanced floating HUD panel with radar sweep, hex grid,
 * bezier edges, particle trails, multi-glow nodes, and scan-line effects.
 * Shows real-time perception decision graph: EGO -> AI modules -> objects.
 */

import { useRef, useEffect, useState, useCallback } from "react";
import { useStore } from "../store";
import { colors, fonts } from "../theme";
import { BOX_TYPE_COLORS } from "../mockData";
import type { BBox3D } from "../mockData";

const W = 400;
const H = 340;
const CX = W / 2;
const CY = H / 2 + 14;

/* ---------- types ---------- */

interface GNode {
  id: string;
  label: string;
  x: number;
  y: number;
  r: number;
  color: string;
  ring?: number;
  glow?: boolean;
  type: "ego" | "module" | "object";
  risk?: number;
}

interface GEdge {
  from: string;
  to: string;
  risk: number;
  dashed?: boolean;
}

const AI_MODULES: Omit<GNode, "x" | "y">[] = [
  { id: "percept", label: "PERCEPTION", r: 15, color: "#00C9DB", ring: 62, type: "module" },
  { id: "predict", label: "PREDICTION", r: 15, color: "#7B6FFF", ring: 62, type: "module" },
  { id: "plan",    label: "PLANNING",   r: 15, color: colors.accent, ring: 62, type: "module" },
  { id: "risk",    label: "RISK EVAL",  r: 15, color: "#FF9E00", ring: 62, type: "module" },
];

/* ---------- helpers ---------- */

function computeRisk(box: BBox3D): number {
  const dist = Math.sqrt(box.cx ** 2 + box.cy ** 2);
  const closingSpeed = box.speed;
  if (dist < 5) return 1.0;
  if (closingSpeed > 0) {
    const ttc = dist / closingSpeed;
    if (ttc < 2) return 0.95;
    if (ttc < 5) return 0.6;
    if (ttc < 10) return 0.3;
  }
  if (dist < 15) return 0.4;
  if (dist < 30) return 0.2;
  return 0.05;
}

function riskColor(risk: number): string {
  if (risk > 0.8) return "#FF3333";
  if (risk > 0.5) return "#FF9E00";
  if (risk > 0.2) return "#FFD700";
  return colors.accent;
}

function quadBez(a: number, b: number, c: number, t: number): number {
  return (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;
}

function hexAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return hex.slice(0, 7) + a;
}

/* ---------- build graph ---------- */

function buildGraph(boxes: BBox3D[]): { nodes: GNode[]; edges: GEdge[] } {
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];

  nodes.push({
    id: "ego", label: "EGO", x: CX, y: CY, r: 20,
    color: colors.accent, glow: true, type: "ego",
  });

  AI_MODULES.forEach((m, i) => {
    const angle = (i / AI_MODULES.length) * Math.PI * 2 - Math.PI / 2;
    nodes.push({ ...m, x: CX + Math.cos(angle) * m.ring!, y: CY + Math.sin(angle) * m.ring! });
    edges.push({ from: "ego", to: m.id, risk: 0 });
  });

  const sorted = [...boxes]
    .map((b) => ({ box: b, dist: Math.sqrt(b.cx ** 2 + b.cy ** 2), risk: computeRisk(b) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 14);

  sorted.forEach((item, i) => {
    const { box, risk } = item;
    const angle = Math.atan2(box.cy, box.cx);
    const ringR = 100 + Math.min(item.dist * 0.7, 40);
    const x = CX + Math.cos(angle) * ringR;
    const y = CY + Math.sin(angle) * ringR;
    const clr = BOX_TYPE_COLORS[box.type] || "#6B7280";
    const nodeId = `obj_${i}`;

    nodes.push({
      id: nodeId,
      label: box.label || box.type,
      x: Math.max(16, Math.min(W - 16, x)),
      y: Math.max(16, Math.min(H - 16, y)),
      r: 8 + risk * 7,
      color: clr,
      type: "object",
      risk,
    });

    edges.push({ from: "percept", to: nodeId, risk });
    if (risk > 0.4) edges.push({ from: "risk", to: nodeId, risk, dashed: true });
    if (box.speed > 0.5) edges.push({ from: "predict", to: nodeId, risk: risk * 0.5, dashed: true });
  });

  return { nodes, edges };
}

/* ---------- draw ---------- */

function drawHexGrid(ctx: CanvasRenderingContext2D) {
  const size = 20;
  const h = size * Math.sqrt(3);
  ctx.save();
  ctx.strokeStyle = "rgba(0, 232, 157, 0.025)";
  ctx.lineWidth = 0.5;
  for (let row = -1; row < H / h + 1; row++) {
    for (let col = -1; col < W / (size * 1.5) + 1; col++) {
      const cx = col * size * 1.5;
      const cy = row * h + (col % 2 ? h / 2 : 0);
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k - Math.PI / 6;
        const px = cx + size * 0.48 * Math.cos(a);
        const py = cy + size * 0.48 * Math.sin(a);
        k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawGraph(
  ctx: CanvasRenderingContext2D,
  nodes: GNode[],
  edges: GEdge[],
  t: number,
) {
  ctx.clearRect(0, 0, W, H);

  // 1. Background with radial gradient
  const bgGrad = ctx.createRadialGradient(CX, CY, 0, CX, CY, W * 0.65);
  bgGrad.addColorStop(0, "rgba(0, 30, 25, 0.97)");
  bgGrad.addColorStop(0.4, "rgba(8, 12, 22, 0.98)");
  bgGrad.addColorStop(1, "rgba(6, 8, 16, 0.99)");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // 2. Hex grid
  drawHexGrid(ctx);

  // 3. Concentric rings (pulsing)
  for (const r of [62, 100, 135]) {
    const pulse = 1 + Math.sin(t * Math.PI * 2 + r * 0.03) * 0.015;
    const alpha = 0.04 + Math.sin(t * Math.PI * 2 + r * 0.05) * 0.015;
    ctx.strokeStyle = `rgba(0, 232, 157, ${alpha})`;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.arc(CX, CY, r * pulse, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 4. Radar sweep
  const sweepAngle = t * Math.PI * 2;
  ctx.save();
  ctx.translate(CX, CY);
  ctx.rotate(sweepAngle);
  const sweepGrad = ctx.createLinearGradient(0, 0, 140, 0);
  sweepGrad.addColorStop(0, "rgba(0, 232, 157, 0.14)");
  sweepGrad.addColorStop(0.6, "rgba(0, 232, 157, 0.04)");
  sweepGrad.addColorStop(1, "rgba(0, 232, 157, 0)");
  ctx.fillStyle = sweepGrad;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, 140, -0.35, 0);
  ctx.closePath();
  ctx.fill();
  // Sweep leading edge
  ctx.strokeStyle = "rgba(0, 232, 157, 0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(140, 0);
  ctx.stroke();
  ctx.restore();

  // 5. Scan line
  const scanY = ((t * 1.7) % 1) * H;
  const scanGrad = ctx.createLinearGradient(0, scanY - 15, 0, scanY + 15);
  scanGrad.addColorStop(0, "transparent");
  scanGrad.addColorStop(0.5, "rgba(0, 232, 157, 0.04)");
  scanGrad.addColorStop(1, "transparent");
  ctx.fillStyle = scanGrad;
  ctx.fillRect(0, scanY - 15, W, 30);

  // 6. Edges — bezier curves with gradient
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  edges.forEach((edge, ei) => {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);
    if (!from || !to) return;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;

    // Control point: perpendicular offset
    const nx = -dy / len;
    const ny = dx / len;
    const curve = 10 + (ei % 3) * 4;
    const side = ei % 2 ? 1 : -1;
    const cpx = (from.x + to.x) / 2 + nx * curve * side;
    const cpy = (from.y + to.y) / 2 + ny * curve * side;

    const clr = riskColor(edge.risk);
    ctx.strokeStyle = hexAlpha(clr, edge.risk > 0.5 ? 0.35 : 0.15);
    ctx.lineWidth = 0.6 + edge.risk * 0.8;

    if (edge.dashed) ctx.setLineDash([3, 4]);
    else ctx.setLineDash([]);

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(cpx, cpy, to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // 7. Particles with trails along bezier
    if (edge.risk > 0.08) {
      const particleCount = edge.risk > 0.5 ? 3 : 2;
      for (let p = 0; p < particleCount; p++) {
        const speed = 0.25 + edge.risk * 0.5;
        const baseP = ((t * speed + p / particleCount) % 1);
        // Trail: 4 fading dots
        for (let tr = 0; tr < 4; tr++) {
          const tp = baseP - tr * 0.025;
          if (tp < 0 || tp > 1) continue;
          const px = quadBez(from.x, cpx, to.x, tp);
          const py = quadBez(from.y, cpy, to.y, tp);
          const opacity = (1 - tr / 4) * 0.85;
          const size = 2 - tr * 0.35;
          ctx.fillStyle = hexAlpha(clr, opacity);
          ctx.beginPath();
          ctx.arc(px, py, Math.max(0.5, size), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  });

  // 8. Nodes
  for (const node of nodes) {
    if (node.type === "ego") {
      drawEgoNode(ctx, node, t);
    } else if (node.type === "module") {
      drawModuleNode(ctx, node, t);
    } else {
      drawObjectNode(ctx, node, t);
    }
  }

  // 9. Corner data readouts
  ctx.fillStyle = "rgba(0, 232, 157, 0.25)";
  ctx.font = `7px ${fonts.mono}`;
  ctx.textAlign = "left";
  const objCount = nodes.filter((n) => n.type === "object").length;
  ctx.fillText(`TGT: ${objCount}`, 8, H - 8);
  ctx.textAlign = "right";
  const maxRisk = nodes.reduce((m, n) => Math.max(m, n.risk ?? 0), 0);
  ctx.fillStyle = hexAlpha(riskColor(maxRisk), 0.4);
  ctx.fillText(`RISK: ${(maxRisk * 100).toFixed(0)}%`, W - 8, H - 8);
}

/* ---- specialized node renderers ---- */

function drawEgoNode(ctx: CanvasRenderingContext2D, node: GNode, t: number) {
  // Outer glow layers
  for (let i = 4; i >= 0; i--) {
    const gr = node.r * (1.2 + i * 0.7);
    const alpha = 0.025 * (5 - i);
    const grd = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, gr);
    grd.addColorStop(0, hexAlpha(colors.accent, alpha));
    grd.addColorStop(1, "transparent");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(node.x, node.y, gr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Rotating dashed ring
  ctx.save();
  ctx.translate(node.x, node.y);
  ctx.rotate(t * Math.PI * 2 * 0.4);
  ctx.strokeStyle = "rgba(0, 232, 157, 0.25)";
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.arc(0, 0, node.r * 1.7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Second rotating ring (opposite direction)
  ctx.save();
  ctx.translate(node.x, node.y);
  ctx.rotate(-t * Math.PI * 2 * 0.25);
  ctx.strokeStyle = "rgba(0, 201, 219, 0.12)";
  ctx.lineWidth = 0.7;
  ctx.setLineDash([3, 7]);
  ctx.beginPath();
  ctx.arc(0, 0, node.r * 2.1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Body
  ctx.fillStyle = "rgba(0, 232, 157, 0.12)";
  ctx.strokeStyle = "rgba(0, 232, 157, 0.6)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Bright core with gradient
  const coreGrad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, 7);
  coreGrad.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  coreGrad.addColorStop(0.4, "rgba(0, 232, 157, 0.7)");
  coreGrad.addColorStop(1, "rgba(0, 232, 157, 0)");
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(node.x, node.y, 7, 0, Math.PI * 2);
  ctx.fill();

  // Label
  ctx.fillStyle = colors.textPrimary;
  ctx.font = `bold 9px ${fonts.mono}`;
  ctx.textAlign = "center";
  ctx.fillText("EGO", node.x, node.y + node.r + 13);
}

function drawModuleNode(ctx: CanvasRenderingContext2D, node: GNode, t: number) {
  const pulse = 1 + Math.sin(t * Math.PI * 4 + node.x * 0.1) * 0.04;

  // Outer glow
  const glowGrad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.r * 2);
  glowGrad.addColorStop(0, hexAlpha(node.color, 0.1));
  glowGrad.addColorStop(1, "transparent");
  ctx.fillStyle = glowGrad;
  ctx.beginPath();
  ctx.arc(node.x, node.y, node.r * 2, 0, Math.PI * 2);
  ctx.fill();

  // Hexagonal body
  const size = node.r * pulse;
  ctx.fillStyle = hexAlpha(node.color, 0.12);
  ctx.strokeStyle = hexAlpha(node.color, 0.55);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k - Math.PI / 6;
    const px = node.x + size * Math.cos(a);
    const py = node.y + size * Math.sin(a);
    k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Inner dot
  ctx.fillStyle = hexAlpha(node.color, 0.85);
  ctx.beginPath();
  ctx.arc(node.x, node.y, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Label
  ctx.fillStyle = hexAlpha(node.color, 0.7);
  ctx.font = `bold 6.5px ${fonts.mono}`;
  ctx.textAlign = "center";
  ctx.fillText(node.label, node.x, node.y + node.r + 11);
}

function drawObjectNode(ctx: CanvasRenderingContext2D, node: GNode, t: number) {
  const risk = node.risk ?? 0;
  const pulse = risk > 0.5 ? 1 + Math.sin(t * Math.PI * 6) * 0.08 : 1;

  // Risk glow for high-risk objects
  if (risk > 0.3) {
    const rc = riskColor(risk);
    const glowGrad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.r * 2.5);
    glowGrad.addColorStop(0, hexAlpha(rc, 0.08 + risk * 0.06));
    glowGrad.addColorStop(1, "transparent");
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.r * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Body
  const r = node.r * pulse;
  ctx.fillStyle = hexAlpha(node.color, 0.15);
  ctx.strokeStyle = hexAlpha(node.color, 0.6);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Inner dot
  ctx.fillStyle = node.color;
  ctx.beginPath();
  ctx.arc(node.x, node.y, 2, 0, Math.PI * 2);
  ctx.fill();

  // Detection brackets [ ]
  const bs = r + 4;
  const bl = 4;
  ctx.strokeStyle = hexAlpha(node.color, 0.35);
  ctx.lineWidth = 0.8;
  // top-left
  ctx.beginPath();
  ctx.moveTo(node.x - bs, node.y - bs + bl);
  ctx.lineTo(node.x - bs, node.y - bs);
  ctx.lineTo(node.x - bs + bl, node.y - bs);
  ctx.stroke();
  // top-right
  ctx.beginPath();
  ctx.moveTo(node.x + bs - bl, node.y - bs);
  ctx.lineTo(node.x + bs, node.y - bs);
  ctx.lineTo(node.x + bs, node.y - bs + bl);
  ctx.stroke();
  // bottom-left
  ctx.beginPath();
  ctx.moveTo(node.x - bs, node.y + bs - bl);
  ctx.lineTo(node.x - bs, node.y + bs);
  ctx.lineTo(node.x - bs + bl, node.y + bs);
  ctx.stroke();
  // bottom-right
  ctx.beginPath();
  ctx.moveTo(node.x + bs - bl, node.y + bs);
  ctx.lineTo(node.x + bs, node.y + bs);
  ctx.lineTo(node.x + bs, node.y + bs - bl);
  ctx.stroke();

  // Label
  ctx.fillStyle = colors.textSecondary;
  ctx.font = `6px ${fonts.mono}`;
  ctx.textAlign = "center";
  ctx.fillText(node.label.toUpperCase().slice(0, 12), node.x, node.y + r + 12);
}

/* ---------- component ---------- */

export default function KnowledgeGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const animRef = useRef(0);
  const lastFrame = useRef(-1);
  const graphRef = useRef<{ nodes: GNode[]; edges: GEdge[] }>({ nodes: [], edges: [] });
  const boxCount = useStore((s) => s.currentFrame?.boxes.length ?? 0);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const state = useStore.getState();
    if (state.currentFrameIndex !== lastFrame.current && state.currentFrame) {
      lastFrame.current = state.currentFrameIndex;
      graphRef.current = buildGraph(state.currentFrame.boxes);
    }

    const t = (Date.now() % 6000) / 6000;
    drawGraph(ctx, graphRef.current.nodes, graphRef.current.edges, t);
    animRef.current = requestAnimationFrame(render);
  }, []);

  useEffect(() => {
    if (!collapsed) {
      animRef.current = requestAnimationFrame(render);
      return () => cancelAnimationFrame(animRef.current);
    }
  }, [collapsed, render]);

  const cornerStyle = (pos: Record<string, number>): React.CSSProperties => ({
    position: "absolute",
    width: 14,
    height: 14,
    pointerEvents: "none",
    ...pos,
  });

  return (
    <div
      style={{
        position: "absolute",
        top: 78,
        right: 8,
        zIndex: 10,
        background: "rgba(8,12,22,0.88)",
        backdropFilter: "blur(24px)",
        borderRadius: 10,
        border: "1px solid rgba(0,232,157,0.1)",
        overflow: "hidden",
        userSelect: "none",
        boxShadow:
          "0 0 60px rgba(0,232,157,0.04), 0 0 20px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.03)",
      }}
    >
      {/* Accent gradient line */}
      <div
        style={{
          height: 2,
          background: "linear-gradient(90deg, transparent 5%, #00E89D 30%, #00C9DB 70%, transparent 95%)",
          opacity: 0.5,
        }}
      />

      {/* Header */}
      <div
        onClick={() => setCollapsed((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "5px 10px",
          cursor: "pointer",
          borderBottom: collapsed ? "none" : "1px solid rgba(0,232,157,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: colors.textDim,
              fontFamily: fonts.mono,
              letterSpacing: "1.5px",
            }}
          >
            KNOWLEDGE GRAPH
          </span>
          <span
            style={{
              display: "inline-block",
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "#00E89D",
              boxShadow: "0 0 6px #00E89D, 0 0 12px rgba(0,232,157,0.3)",
              animation: "kgPulse 2s ease-in-out infinite",
            }}
          />
          <span style={{ fontSize: 7, color: colors.accent, fontFamily: fonts.mono, opacity: 0.7 }}>
            LIVE
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 8, color: colors.accent, fontFamily: fonts.mono, opacity: 0.6 }}>
            {boxCount} OBJ
          </span>
          <span style={{ fontSize: 8, color: colors.textDim }}>{collapsed ? "+" : "-"}</span>
        </div>
      </div>

      {!collapsed && (
        <div style={{ position: "relative" }}>
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            style={{ width: W, height: H, display: "block" }}
          />
          {/* Corner brackets */}
          <div style={cornerStyle({ top: 4, left: 4, borderTop: "2px solid rgba(0,232,157,0.3)", borderLeft: "2px solid rgba(0,232,157,0.3)" })} />
          <div style={cornerStyle({ top: 4, right: 4, borderTop: "2px solid rgba(0,232,157,0.3)", borderRight: "2px solid rgba(0,232,157,0.3)" })} />
          <div style={cornerStyle({ bottom: 4, left: 4, borderBottom: "2px solid rgba(0,232,157,0.3)", borderLeft: "2px solid rgba(0,232,157,0.3)" })} />
          <div style={cornerStyle({ bottom: 4, right: 4, borderBottom: "2px solid rgba(0,232,157,0.3)", borderRight: "2px solid rgba(0,232,157,0.3)" })} />
        </div>
      )}

      {/* Inline keyframes for pulse animation */}
      <style>{`
        @keyframes kgPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }
      `}</style>
    </div>
  );
}
