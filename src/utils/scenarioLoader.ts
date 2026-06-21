/**
 * Loads pre-generated scenario data from static files in /scenarios/.
 * Each scenario+variant has:
 *   <id>__<variant>.meta.json  — frame metadata (boxes, ego, timestamps, byte offsets)
 *   <id>__<variant>.points.bin — concatenated Float32Array data (positions + attributes)
 */

import type { SceneData, FrameData, ScenarioId, SceneVariant } from "../mockData";
import { ALL_VARIANTS } from "../mockData";

// In-memory cache — once loaded, scenario switching is instant
const cache = new Map<string, SceneData>();

interface FrameMeta {
  timestamp: number;
  egoPosition: [number, number, number];
  egoYaw: number;
  boxes: FrameData["boxes"];
  pointCount: number;
  positionsOffset: number;
  positionsLength: number;
  attributesOffset: number;
  attributesLength: number;
}

interface ScenarioMeta {
  fps: number;
  totalSeconds: number;
  totalFrames: number;
  frames: FrameMeta[];
}

function fileId(id: ScenarioId, variant: SceneVariant): string {
  return `${id}__${variant}`;
}

/**
 * Load a pre-generated scenario variant. Returns cached data if available.
 * Throws on network/parse errors.
 */
export async function loadScenario(
  id: ScenarioId,
  variant: SceneVariant = "ground_truth",
  onProgress?: (msg: string, progress: number) => void,
): Promise<SceneData> {
  const key = fileId(id, variant);
  const cached = cache.get(key);
  if (cached) return cached;

  onProgress?.(`Loading "${key}"…`, 0.1);

  const base = `${import.meta.env.BASE_URL}scenarios/${key}`;

  // Fetch meta + binary in parallel
  const [metaResp, binResp] = await Promise.all([
    fetch(`${base}.meta.json`),
    fetch(`${base}.points.bin`),
  ]);

  if (!metaResp.ok) throw new Error(`Failed to fetch ${key}.meta.json: ${metaResp.status}`);
  if (!binResp.ok) throw new Error(`Failed to fetch ${key}.points.bin: ${binResp.status}`);

  onProgress?.(`Parsing "${key}"…`, 0.5);

  const meta: ScenarioMeta = await metaResp.json();
  const binBuf = await binResp.arrayBuffer();

  onProgress?.(`Reconstructing "${key}" frames…`, 0.8);

  const frames: FrameData[] = meta.frames.map((fm) => ({
    timestamp: fm.timestamp,
    egoPosition: fm.egoPosition,
    egoYaw: fm.egoYaw,
    boxes: fm.boxes,
    pointCount: fm.pointCount,
    pointPositions: new Float32Array(binBuf, fm.positionsOffset, fm.positionsLength / 4),
    pointAttributes: new Float32Array(binBuf, fm.attributesOffset, fm.attributesLength / 4),
  }));

  const sceneData: SceneData = {
    fps: meta.fps,
    totalSeconds: meta.totalSeconds,
    totalFrames: meta.totalFrames,
    frames,
  };

  cache.set(key, sceneData);
  onProgress?.(`"${key}" ready`, 1.0);

  return sceneData;
}

/** Check if a scenario variant is already cached in memory. */
export function isScenarioCached(id: ScenarioId, variant: SceneVariant = "ground_truth"): boolean {
  return cache.has(fileId(id, variant));
}

/**
 * Load all 4 variants for a scenario (for dashboard).
 * Returns a map of variant → SceneData.
 */
export async function loadScenarioVariants(
  id: ScenarioId,
  onProgress?: (msg: string) => void,
): Promise<Record<SceneVariant, SceneData>> {
  const results = {} as Record<SceneVariant, SceneData>;
  for (const variant of ALL_VARIANTS) {
    onProgress?.(`Loading "${id}" ${variant}…`);
    results[variant] = await loadScenario(id, variant);
  }
  return results;
}

/** Pre-fetch ground_truth for all scenarios (for instant SimPage switching). */
export async function preloadAllScenarios(
  ids: ScenarioId[],
  onProgress?: (msg: string) => void,
): Promise<void> {
  for (const id of ids) {
    if (cache.has(fileId(id, "ground_truth"))) continue;
    try {
      onProgress?.(`Pre-loading "${id}"…`);
      await loadScenario(id, "ground_truth");
    } catch (e) {
      console.warn(`[scenarioLoader] Failed to preload "${id}":`, e);
    }
  }
}
