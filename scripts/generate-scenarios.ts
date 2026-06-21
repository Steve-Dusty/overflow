/**
 * Build-time script: pre-generates all scenario SceneData and writes them
 * as static files to public/scenarios/ for instant loading at runtime.
 *
 * Run: npx tsx scripts/generate-scenarios.ts
 *
 * Output per scenario:
 *   <id>.meta.json  — fps, totalSeconds, totalFrames, per-frame boxes/ego/timestamps
 *   <id>.points.bin — concatenated Float32Arrays (positions then attributes per frame)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { generateSceneData, ALL_SCENARIOS, ALL_VARIANTS } from "../src/mockData";
import type { SceneData, FrameData } from "../src/mockData";

const OUT_DIR = path.resolve(import.meta.dirname, "../public/scenarios");

interface FrameMeta {
  timestamp: number;
  egoPosition: [number, number, number];
  egoYaw: number;
  boxes: FrameData["boxes"];
  pointCount: number;
  /** Byte offset into the .points.bin file for this frame's positions */
  positionsOffset: number;
  /** Byte length of positions data */
  positionsLength: number;
  /** Byte offset for attributes */
  attributesOffset: number;
  /** Byte length of attributes data */
  attributesLength: number;
}

interface ScenarioMeta {
  fps: number;
  totalSeconds: number;
  totalFrames: number;
  frames: FrameMeta[];
}

function writeScenario(id: string, scene: SceneData) {
  const binChunks: Buffer[] = [];
  let byteOffset = 0;

  const frameMetas: FrameMeta[] = scene.frames.map((f) => {
    const posBuf = Buffer.from(
      f.pointPositions.buffer,
      f.pointPositions.byteOffset,
      f.pointPositions.byteLength,
    );
    const attrBuf = Buffer.from(
      f.pointAttributes.buffer,
      f.pointAttributes.byteOffset,
      f.pointAttributes.byteLength,
    );

    const posOffset = byteOffset;
    byteOffset += posBuf.byteLength;
    const attrOffset = byteOffset;
    byteOffset += attrBuf.byteLength;

    binChunks.push(posBuf, attrBuf);

    return {
      timestamp: f.timestamp,
      egoPosition: f.egoPosition,
      egoYaw: f.egoYaw,
      boxes: f.boxes,
      pointCount: f.pointCount,
      positionsOffset: posOffset,
      positionsLength: posBuf.byteLength,
      attributesOffset: attrOffset,
      attributesLength: attrBuf.byteLength,
    };
  });

  const meta: ScenarioMeta = {
    fps: scene.fps,
    totalSeconds: scene.totalSeconds,
    totalFrames: scene.totalFrames,
    frames: frameMetas,
  };

  const metaPath = path.join(OUT_DIR, `${id}.meta.json`);
  const binPath = path.join(OUT_DIR, `${id}.points.bin`);

  fs.writeFileSync(metaPath, JSON.stringify(meta));
  fs.writeFileSync(binPath, Buffer.concat(binChunks));

  const metaSize = (fs.statSync(metaPath).size / 1024).toFixed(0);
  const binSize = (fs.statSync(binPath).size / (1024 * 1024)).toFixed(1);
  console.log(`  ${id}: meta ${metaSize}KB, points ${binSize}MB`);
}

// ── Main ──────────────────────────────────────────────────────────

const totalCombinations = ALL_SCENARIOS.length * ALL_VARIANTS.length;
console.log(`Generating ${totalCombinations} scenario×variant combinations → ${OUT_DIR}\n`);
fs.mkdirSync(OUT_DIR, { recursive: true });

for (const id of ALL_SCENARIOS) {
  for (const variant of ALL_VARIANTS) {
    const fileId = `${id}__${variant}`;
    const t0 = performance.now();
    const scene = generateSceneData(id, variant);
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    console.log(`[${fileId}] generated in ${elapsed}s (${scene.totalFrames} frames)`);
    writeScenario(fileId, scene);
  }
}

console.log("\nDone.");
