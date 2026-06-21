/**
 * waymoLoader — Loads Waymo Open Dataset v2 Parquet files (LiDAR + boxes ONLY).
 * Loads LiDAR point clouds and 3D bounding boxes from Waymo Parquet files.
 */

import type { FrameData, BBox3D, ActorType } from '../mockData';
import type { SceneData } from '../mockData';
import {
  openParquetFile,
  readAllRows,
  readRowRange,
  groupRowsBy,
  type ParquetRow,
} from './parquet';
import {
  parseLidarCalibration,
  convertAllSensorsToSplit,
  type LidarCalibration,
  type RangeImage,
} from './rangeImage';
// ---------------------------------------------------------------------------
// Waymo type mapping
// ---------------------------------------------------------------------------

const WAYMO_TYPE_MAP: Record<number, ActorType> = {
  1: 'vehicle',
  2: 'pedestrian',
  3: 'sign',
  4: 'cyclist',
};

const WAYMO_TYPE_LABELS: Record<number, string> = {
  1: 'Vehicle',
  2: 'Pedestrian',
  3: 'Sign',
  4: 'Cyclist',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LoadProgressCallback = (step: string, progress: number) => void;

/** Core components for 3D visualization */
const CORE_COMPONENTS = [
  'vehicle_pose',
  'lidar_calibration',
  'lidar',
  'lidar_box',
];

/** All known components (for drag-and-drop scanning) */
const ALL_COMPONENTS = [
  ...CORE_COMPONENTS,
  'camera_box',
  'camera_calibration',
  'camera_image',
  'lidar_camera_projection',
];

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface WaymoLoadResult extends SceneData {}

// ---------------------------------------------------------------------------
// Main loader — from static URLs
// ---------------------------------------------------------------------------

export async function loadWaymoFromUrls(
  basePath: string,
  onProgress?: LoadProgressCallback,
  segmentName?: string,
): Promise<WaymoLoadResult> {
  const files: Record<string, string> = {};

  for (const comp of ALL_COMPONENTS) {
    if (segmentName) {
      files[comp] = `${basePath}/${comp}/${segmentName}.parquet`;
    } else {
      files[comp] = `${basePath}/${comp}.parquet`;
    }
  }

  return loadWaymoFromSources(files, onProgress);
}

// ---------------------------------------------------------------------------
// Main loader — from File objects (drag & drop)
// ---------------------------------------------------------------------------

export async function loadWaymoFromFiles(
  fileMap: Map<string, File>,
  onProgress?: LoadProgressCallback,
): Promise<WaymoLoadResult> {
  const sources: Record<string, File | string> = {};
  for (const [name, file] of fileMap) {
    sources[name] = file;
  }
  return loadWaymoFromSources(sources, onProgress);
}

// ---------------------------------------------------------------------------
// Core loader — loads LiDAR + boxes
// ---------------------------------------------------------------------------

async function loadWaymoFromSources(
  sources: Record<string, File | string>,
  onProgress?: LoadProgressCallback,
): Promise<WaymoLoadResult> {
  console.log('[waymo] Starting load (core components only)…');
  onProgress?.('Opening Parquet files…', 0.02);

  // 1. Open CORE parquet files only
  const parquetFiles = new Map<string, Awaited<ReturnType<typeof openParquetFile>>>();
  for (const component of CORE_COMPONENTS) {
    const source = sources[component];
    if (!source) continue;
    try {
      console.log(`[waymo] Opening ${component}…`);
      const pf = await openParquetFile(component, source as File | string);
      parquetFiles.set(component, pf);
      console.log(`[waymo] ${component}: ${pf.numRows} rows`);
    } catch (e) {
      if (['vehicle_pose', 'lidar'].includes(component)) throw e;
      console.warn(`[waymo] ${component} not available: ${e instanceof Error ? e.message : e}`);
    }
  }

  // 2. Vehicle poses → master timeline
  onProgress?.('Parsing poses…', 0.08);
  const posePf = parquetFiles.get('vehicle_pose');
  if (!posePf) throw new Error('vehicle_pose.parquet is required');

  const poseRows = await readAllRows(posePf);
  console.log(`[waymo] ${poseRows.length} pose rows`);

  const tsSet = new Set<bigint>();
  for (const row of poseRows) tsSet.add(row['key.frame_timestamp_micros'] as bigint);
  const uniqueTimestamps = [...tsSet].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const totalFrames = uniqueTimestamps.length;
  console.log(`[waymo] ${totalFrames} frames`);

  const frameIndexByTimestamp = new Map<bigint, number>();
  uniqueTimestamps.forEach((ts, i) => frameIndexByTimestamp.set(ts, i));

  // 3. LiDAR calibrations
  onProgress?.('Loading calibrations…', 0.10);
  const calibrations = new Map<number, LidarCalibration>();
  const lidarCalibPf = parquetFiles.get('lidar_calibration');
  if (lidarCalibPf) {
    const rows = await readAllRows(lidarCalibPf);
    for (const row of rows) {
      const calib = parseLidarCalibration(row);
      calibrations.set(calib.laserName, calib);
    }
    console.log(`[waymo] ${calibrations.size} LiDAR sensors`);
  }

  // 4. 3D boxes
  onProgress?.('Loading 3D boxes…', 0.12);
  let boxByFrame = new Map<unknown, ParquetRow[]>();
  const lidarBoxPf = parquetFiles.get('lidar_box');
  if (lidarBoxPf) {
    const boxRows = await readAllRows(lidarBoxPf);
    console.log(`[waymo] ${boxRows.length} 3D box rows`);
    boxByFrame = groupRowsBy(boxRows, 'key.frame_timestamp_micros');
  }

  // 5. Build frame array
  onProgress?.('Building frames…', 0.16);
  const frames: FrameData[] = uniqueTimestamps.map((ts, fi) => {
    const boxRows = boxByFrame.get(ts) ?? [];
    const boxes: BBox3D[] = boxRows.map((row, idx) => {
      const wType = (row['[LiDARBoxComponent].type'] as number) ?? 1;
      const actorType = WAYMO_TYPE_MAP[wType] ?? 'vehicle';
      const speedX = (row['[LiDARBoxComponent].speed.x'] as number) ?? 0;
      const speedY = (row['[LiDARBoxComponent].speed.y'] as number) ?? 0;
      return {
        id: (row['key.laser_object_id'] as string) ?? `box-${fi}-${idx}`,
        type: actorType,
        cx: (row['[LiDARBoxComponent].box.center.x'] as number) ?? 0,
        cy: (row['[LiDARBoxComponent].box.center.y'] as number) ?? 0,
        cz: (row['[LiDARBoxComponent].box.center.z'] as number) ?? 0,
        sx: (row['[LiDARBoxComponent].box.size.x'] as number) ?? 1,
        sy: (row['[LiDARBoxComponent].box.size.y'] as number) ?? 1,
        sz: (row['[LiDARBoxComponent].box.size.z'] as number) ?? 1,
        heading: (row['[LiDARBoxComponent].box.heading'] as number) ?? 0,
        speed: Math.sqrt(speedX * speedX + speedY * speedY),
        label: WAYMO_TYPE_LABELS[wType] ?? 'Unknown',
        trackId: idx,
      };
    });

    return {
      timestamp: Number(ts) / 1e6,
      egoPosition: [0, 0, 0] as [number, number, number],
      egoYaw: 0,
      boxes,
      pointPositions: new Float32Array(0),
      pointAttributes: new Float32Array(0),
      pointCount: 0,
    };
  });

  // 8. Load LiDAR row-group by row-group
  const lidarPf = parquetFiles.get('lidar');
  if (!lidarPf) throw new Error('lidar.parquet is required');

  const LIDAR_COLUMNS = [
    'key.frame_timestamp_micros',
    'key.laser_name',
    '[LiDARComponent].range_image_return1.shape',
    '[LiDARComponent].range_image_return1.values',
  ];

  console.log(`[waymo] LiDAR: ${lidarPf.numRows} rows, ${lidarPf.rowGroups.length} row groups`);

  for (let rgi = 0; rgi < lidarPf.rowGroups.length; rgi++) {
    const rg = lidarPf.rowGroups[rgi];
    const pct = 0.18 + (rgi / lidarPf.rowGroups.length) * 0.75;
    onProgress?.(`Decoding LiDAR ${rgi + 1}/${lidarPf.rowGroups.length}…`, pct);

    const lidarRows = await readRowRange(lidarPf, rg.rowStart, rg.rowEnd, LIDAR_COLUMNS);
    const lidarByFrame = groupRowsBy(lidarRows, 'key.frame_timestamp_micros');

    for (const [ts, sensorRows] of lidarByFrame) {
      const fi = frameIndexByTimestamp.get(ts as bigint);
      if (fi === undefined) continue;

      const rangeImages = new Map<number, RangeImage>();
      for (const row of sensorRows) {
        const laserName = row['key.laser_name'] as number;
        const shape = row['[LiDARComponent].range_image_return1.shape'] as number[];
        const values = row['[LiDARComponent].range_image_return1.values'] as number[];
        if (shape && values && shape.length === 3) {
          rangeImages.set(laserName, { shape: [shape[0], shape[1], shape[2]], values });
        }
      }

      if (rangeImages.size > 0) {
        const result = convertAllSensorsToSplit(rangeImages, calibrations);
        const f = frames[fi];
        if (f.pointCount === 0) {
          f.pointPositions = result.positions;
          f.pointAttributes = result.attributes;
          f.pointCount = result.pointCount;
        } else {
          const newPos = new Float32Array(f.pointPositions.length + result.positions.length);
          newPos.set(f.pointPositions);
          newPos.set(result.positions, f.pointPositions.length);
          const newAttr = new Float32Array(f.pointAttributes.length + result.attributes.length);
          newAttr.set(f.pointAttributes);
          newAttr.set(result.attributes, f.pointAttributes.length);
          f.pointPositions = newPos;
          f.pointAttributes = newAttr;
          f.pointCount += result.pointCount;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 0));
  }

  onProgress?.('Done!', 1.0);

  const avgPts = Math.round(frames.reduce((s, f) => s + f.pointCount, 0) / totalFrames);
  const avgBoxes = Math.round(frames.reduce((s, f) => s + f.boxes.length, 0) / totalFrames);
  console.log(`[waymo] Load complete. ${totalFrames} frames, avg ${avgPts} pts/frame, avg ${avgBoxes} boxes/frame`);

  return {
    frames,
    fps: 10,
    totalSeconds: totalFrames / 10,
    totalFrames,
  };
}

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

export async function scanDroppedFiles(
  items: DataTransferItemList,
): Promise<Map<string, File>> {
  const fileMap = new Map<string, File>();
  const entries: FileSystemEntry[] = [];

  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  async function processEntry(entry: FileSystemEntry): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve) =>
        (entry as FileSystemFileEntry).file(resolve)
      );
      if (file.name.endsWith('.parquet')) {
        for (const comp of ALL_COMPONENTS) {
          if (file.name.includes(comp) || entry.fullPath.includes(`/${comp}/`)) {
            fileMap.set(comp, file);
            break;
          }
        }
      }
    } else if (entry.isDirectory) {
      const dirReader = (entry as FileSystemDirectoryEntry).createReader();
      const children = await new Promise<FileSystemEntry[]>((resolve) =>
        dirReader.readEntries(resolve)
      );
      for (const child of children) await processEntry(child);
    }
  }

  for (const entry of entries) await processEntry(entry);
  return fileMap;
}
