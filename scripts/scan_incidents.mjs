/**
 * scan_incidents.mjs — Reads the downloaded lidar_box parquet files
 * and finds segments with the closest object proximity (near-misses).
 */
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { parquetRead } from "hyparquet";
import { compressors } from "hyparquet-compressors";

const SCAN_DIR = path.resolve("scripts/_scan_tmp/lidar_box");

async function analyzeFile(filePath) {
  const buffer = readFileSync(filePath);
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const file = { byteLength: ab.byteLength, slice: (s, e) => ab.slice(s, e) };

  let minDist = Infinity, minType = "", totalBoxes = 0;
  let pedestrians = 0, cyclists = 0, closeEvents = 0, veryClose = 0;
  let frameCloseMap = new Map(); // frame -> count of close boxes

  await parquetRead({
    file,
    compressors,
    onComplete: (rows) => {
      for (const row of rows) {
        totalBoxes++;
        // columns: [index, segment_name, frame_ts(bigint), object_id, cx, cy, cz, sx, sy, sz, heading, type, ...]
        const cx = row[4], cy = row[5], type = row[11];
        const ts = row[2];
        if (typeof cx !== "number" || typeof cy !== "number") continue;

        const dist = Math.sqrt(cx * cx + cy * cy);
        const typeName = type === 1 ? "vehicle" : type === 2 ? "pedestrian" : type === 3 ? "sign" : type === 4 ? "cyclist" : `t${type}`;

        if (type === 2) pedestrians++;
        if (type === 4) cyclists++;
        if (dist < 5 && type !== 3) { closeEvents++; frameCloseMap.set(ts, (frameCloseMap.get(ts) || 0) + 1); }
        if (dist < 3 && type !== 3) veryClose++;
        if (dist < minDist && type !== 3) { minDist = dist; minType = typeName; }
      }
    },
  });

  // Find the frame with the most close objects (congestion/chaos)
  let maxCloseFrame = 0, maxCloseCount = 0;
  for (const [ts, count] of frameCloseMap) {
    if (count > maxCloseCount) { maxCloseCount = count; maxCloseFrame = ts; }
  }

  return { minDist, minType, totalBoxes, pedestrians, cyclists, closeEvents, veryClose, maxCloseCount };
}

async function main() {
  const files = readdirSync(SCAN_DIR).filter(f => f.endsWith(".parquet"));
  console.log(`Scanning ${files.length} segments for near-misses...\n`);

  const results = [];

  for (const f of files) {
    const seg = f.replace(".parquet", "");
    try {
      const stats = await analyzeFile(path.join(SCAN_DIR, f));
      // Scoring: heavy weight on very close non-sign objects, pedestrians, cyclists
      const score = stats.veryClose * 20 + stats.closeEvents * 5 + stats.pedestrians * 2 + stats.cyclists * 3 + stats.maxCloseCount * 10;
      results.push({ segment: seg, ...stats, score });
      const tag = stats.veryClose > 0 ? "🔴" : stats.closeEvents > 5 ? "🟡" : "⚪";
      console.log(`${tag} ${seg.slice(0, 30).padEnd(30)} min=${stats.minDist.toFixed(1)}m(${stats.minType.padEnd(10)}) <5m=${stats.closeEvents} <3m=${stats.veryClose} peds=${stats.pedestrians} cycl=${stats.cyclists}`);
    } catch (e) {
      console.log(`❌ ${seg.slice(0, 30).padEnd(30)} ERROR: ${e.message.slice(0, 50)}`);
    }
  }

  results.sort((a, b) => b.score - a.score);

  console.log("\n\n============================");
  console.log("  TOP 5 INCIDENT SEGMENTS");
  console.log("============================\n");
  for (let i = 0; i < Math.min(5, results.length); i++) {
    const r = results[i];
    console.log(`#${i + 1} — ${r.segment}`);
    console.log(`     Min dist: ${r.minDist.toFixed(2)}m (${r.minType})`);
    console.log(`     <5m events: ${r.closeEvents} | <3m events: ${r.veryClose}`);
    console.log(`     Pedestrians: ${r.pedestrians} | Cyclists: ${r.cyclists}`);
    console.log(`     Max simultaneous close objects: ${r.maxCloseCount}`);
    console.log(`     Score: ${r.score}\n`);
  }

  if (results.length > 0) {
    const best = results[0];
    console.log(`\n🏆 RECOMMENDED SEGMENT: ${best.segment}`);
    console.log(`\nDownload command:`);
    console.log(`$seg = "${best.segment}"`);
    console.log(`$bucket = "gs://waymo_open_dataset_v_2_0_1/training"`);
    console.log(`$components = @("vehicle_pose","lidar_calibration","lidar_box","lidar")`);
    console.log(`foreach ($c in $components) { New-Item -ItemType Directory -Force "public\\waymo_data\\$c" | Out-Null; gsutil cp "$bucket/$c/$seg.parquet" "public\\waymo_data\\$c/" }`);
  }
}

main().catch(console.error);
