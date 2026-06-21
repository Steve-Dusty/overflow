/**
 * IndexedDB cache for processed SceneData.
 * Stores the fully-decoded frames (Float32Arrays + boxes) so subsequent
 * page loads skip the expensive parquet decompression + 3D reconstruction.
 */

import type { SceneData, FrameData, BBox3D } from '../mockData';

const DB_NAME = 'overflow-scene-cache';
const DB_VERSION = 1;
const STORE_NAME = 'scenes';

// ---------------------------------------------------------------------------
// Open / init DB
// ---------------------------------------------------------------------------

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

interface SerializedFrame {
  timestamp: number;
  egoPosition: [number, number, number];
  egoYaw: number;
  boxes: BBox3D[];
  pointPositions: ArrayBuffer;
  pointAttributes: ArrayBuffer;
  pointCount: number;
}

interface SerializedScene {
  fps: number;
  totalSeconds: number;
  totalFrames: number;
  frames: SerializedFrame[];
  cachedAt: number;
}

function serializeScene(scene: SceneData): SerializedScene {
  return {
    fps: scene.fps,
    totalSeconds: scene.totalSeconds,
    totalFrames: scene.totalFrames,
    cachedAt: Date.now(),
    frames: scene.frames.map((f) => ({
      timestamp: f.timestamp,
      egoPosition: f.egoPosition,
      egoYaw: f.egoYaw,
      boxes: f.boxes,
      pointPositions: f.pointPositions.buffer.slice(
        f.pointPositions.byteOffset,
        f.pointPositions.byteOffset + f.pointPositions.byteLength,
      ),
      pointAttributes: f.pointAttributes.buffer.slice(
        f.pointAttributes.byteOffset,
        f.pointAttributes.byteOffset + f.pointAttributes.byteLength,
      ),
      pointCount: f.pointCount,
    })),
  };
}

function deserializeScene(data: SerializedScene): SceneData {
  return {
    fps: data.fps,
    totalSeconds: data.totalSeconds,
    totalFrames: data.totalFrames,
    frames: data.frames.map((f): FrameData => ({
      timestamp: f.timestamp,
      egoPosition: f.egoPosition,
      egoYaw: f.egoYaw,
      boxes: f.boxes,
      pointPositions: new Float32Array(f.pointPositions),
      pointAttributes: new Float32Array(f.pointAttributes),
      pointCount: f.pointCount,
    })),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Build a cache key from the data source + segment. */
export function cacheKey(dataSource: string, segment?: string | null): string {
  return segment ? `${dataSource}:${segment}` : dataSource;
}

/** Try to load cached scene data. Returns null on miss or error. */
export async function getCachedScene(key: string): Promise<SceneData | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        const data = req.result as SerializedScene | undefined;
        if (data) {
          console.log(`[cache] Hit for "${key}" (cached ${new Date(data.cachedAt).toLocaleString()})`);
          resolve(deserializeScene(data));
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Store processed scene data in IndexedDB. */
export async function setCachedScene(key: string, scene: SceneData): Promise<void> {
  try {
    const db = await openDB();
    const serialized = serializeScene(scene);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(serialized, key);
      req.onsuccess = () => {
        console.log(`[cache] Stored "${key}" (${scene.totalFrames} frames)`);
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[cache] Failed to store:', e);
  }
}

/** Clear all cached scenes. */
export async function clearSceneCache(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
    });
  } catch {
    // ignore
  }
}
