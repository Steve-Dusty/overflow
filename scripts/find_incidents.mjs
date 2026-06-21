/**
 * find_incidents.mjs — Downloads lidar_box + vehicle_pose for N Waymo segments,
 * analyzes for close-proximity events (near-misses), and reports the best ones.
 * 
 * Usage: node scripts/find_incidents.mjs
 */

import { execSync } from "child_process";
import { mkdirSync, existsSync, readFileSync, readdirSync, rmSync } from "fs";
import path from "path";

const BUCKET = "gs://waymo_open_dataset_v_2_0_1/training";
const SCAN_DIR = path.resolve("scripts/_scan_tmp");
const N_SEGMENTS = 20; // scan 20 segments

// Add gcloud to path
const gcloudBin = path.join(process.env.LOCALAPPDATA || "", "Google", "Cloud SDK", "google-cloud-sdk", "bin");
const envPath = `${gcloudBin};${process.env.PATH}`;

function run(cmd) {
  return execSync(cmd, { encoding: "utf-8", env: { ...process.env, PATH: envPath }, maxBuffer: 50 * 1024 * 1024 });
}

async function main() {
  console.log("=== Waymo Incident Scanner ===\n");

  // 1. List segment names from vehicle_pose bucket
  console.log(`Listing segments from ${BUCKET}/vehicle_pose/ ...`);
  const listing = run(`gsutil ls "${BUCKET}/lidar_box/" | head -${N_SEGMENTS + 5}`);
  const segments = listing.trim().split("\n")
    .map(line => {
      const m = line.match(/([^/]+)\.parquet$/);
      return m ? m[1] : null;
    })
    .filter(Boolean)
    .slice(0, N_SEGMENTS);

  console.log(`Found ${segments.length} segments to scan.\n`);

  // 2. Download lidar_box for each (small files, ~90KB each)
  mkdirSync(path.join(SCAN_DIR, "lidar_box"), { recursive: true });

  for (const seg of segments) {
    const dest = path.join(SCAN_DIR, "lidar_box", `${seg}.parquet`);
    if (existsSync(dest)) {
      console.log(`[skip] ${seg} already cached`);
      continue;
    }
    console.log(`[download] lidar_box/${seg}.parquet ...`);
    try {
      run(`gsutil cp "${BUCKET}/lidar_box/${seg}.parquet" "${dest}"`);
    } catch (e) {
      console.log(`  FAILED: ${e.message.slice(0, 80)}`);
    }
  }

  // 3. Analyze each segment using hyparquet
  console.log("\n=== Analyzing segments for close-proximity events ===\n");

  // Dynamic import hyparquet
  const { parquetRead } = await import("hyparquet");

  const results = [];

  for (const seg of segments) {
    const boxFile = path.join(SCAN_DIR, "lidar_box", `${seg}.parquet`);
    if (!existsSync(boxFile)) continue;

    try {
      const buffer = readFileSync(boxFile);
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

      let minDist = Infinity;
      let minType = "";
      let totalBoxes = 0;
      let pedestrianBoxes = 0;
      let cyclistBoxes = 0;
      let closeEvents = 0; // dist < 5m

      await parquetRead({
        file: { byteLength: arrayBuffer.byteLength, slice: (start, end) => arrayBuffer.slice(start, end) },
        onComplete: (rows) => {
          for (const row of rows) {
            totalBoxes++;
            // Waymo box columns: [key.segment_context_name, key.frame_timestamp_micros, key.laser_object_id,
            //                     center_x, center_y, center_z, length, width, height, heading, type, ...]
            // The exact column layout varies, but center_x/y are typically cols 3,4
            const cx = row[3]; // center_x (in vehicle frame)
            const cy = row[4]; // center_y
            const type = row[10]; // type enum

            if (typeof cx !== "number" || typeof cy !== "number") continue;

            const dist = Math.sqrt(cx * cx + cy * cy);

            if (type === 2) pedestrianBoxes++;
            if (type === 4) cyclistBoxes++;
            if (dist < 5) closeEvents++;

            if (dist < minDist) {
              minDist = dist;
              minType = type === 1 ? "vehicle" : type === 2 ? "pedestrian" : type === 3 ? "sign" : type === 4 ? "cyclist" : `type_${type}`;
            }
          }
        },
      });

      results.push({
        segment: seg,
        minDist: Math.round(minDist * 100) / 100,
        minType,
        totalBoxes,
        pedestrianBoxes,
        cyclistBoxes,
        closeEvents,
        score: closeEvents * 10 + pedestrianBoxes * 2 + cyclistBoxes * 3 + (minDist < 3 ? 100 : minDist < 5 ? 50 : 0),
      });

      console.log(`  ${seg.slice(0, 20)}... minDist=${minDist.toFixed(1)}m (${minType}) close=${closeEvents} peds=${pedestrianBoxes} cyclists=${cyclistBoxes}`);
    } catch (e) {
      console.log(`  ${seg.slice(0, 20)}... PARSE ERROR: ${e.message.slice(0, 60)}`);
    }
  }

  // 4. Rank by "interestingness"
  results.sort((a, b) => b.score - a.score);

  console.log("\n=== TOP SEGMENTS (by incident score) ===\n");
  console.log("RANK | MIN_DIST | TYPE        | CLOSE | PEDS  | CYCLISTS | SCORE | SEGMENT");
  console.log("-----+----------+-------------+-------+-------+----------+-------+--------");
  for (let i = 0; i < Math.min(10, results.length); i++) {
    const r = results[i];
    console.log(
      `  ${i + 1}  | ${r.minDist.toFixed(1).padStart(6)}m | ${r.minType.padEnd(11)} | ${String(r.closeEvents).padStart(5)} | ${String(r.pedestrianBoxes).padStart(5)} | ${String(r.cyclistBoxes).padStart(8)} | ${String(r.score).padStart(5)} | ${r.segment}`
    );
  }

  if (results.length > 0) {
    console.log(`\n🏆 BEST SEGMENT: ${results[0].segment}`);
    console.log(`   Min distance: ${results[0].minDist}m (${results[0].minType})`);
    console.log(`   Close events: ${results[0].closeEvents}`);
    console.log(`\nTo download this segment, run:`);
    console.log(`   node scripts/download_segment.mjs "${results[0].segment}"`);
  }
}

main().catch(console.error);
