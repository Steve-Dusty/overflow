/**
 * Simulation manager — handles spawning, advancing, and replacing counterfactual runs.
 * Max 3 concurrent running sims. Finished runs go to history.
 * Syncs real scene data from the main store.
 */

import { create } from "zustand";
import {
  type CounterfactualRun,
  type MainSimState,
  createCounterfactualRun,
  advanceRun,
} from "./simTypes";
import {
  getActionAndReward,
  getCounterfactualVariants,
} from "./openenvClient";
import { useStore } from "../store";

const LABELS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
const MAX_ACTIVE = 3;
const SPAWN_COUNT = 3;
const SPAWN_INTERVAL_MS = 10_000;
const ADVANCE_INTERVAL_MS = 3_000;

interface SimManagerState {
  runs: CounterfactualRun[];
  mainState: MainSimState;
  totalSpawned: number;
  isSpawning: boolean;
  lastSpawnTime: number;
  openenvConnected: boolean;
  openenvLastUpdate: number;
  openenvNextUpdate: number;

  actions: {
    setMainState: (state: Partial<MainSimState>) => void;
    syncFromStore: () => void;
    spawnRuns: () => Promise<void>;
    advanceAllRuns: () => Promise<void>;
    removeRun: (id: string) => void;
    updateMainFromOpenEnv: () => Promise<void>;
    reset: () => void;
  };
}

const defaultMainState: MainSimState = {
  scenarioId: "default",
  frameIndex: 0,
  egoSnapshot: { x: 0, y: 0, z: 0, heading: 0, speed: 8, frameIndex: 0 },
  nearestObjectDist: 20,
  lastAction: null,
  cumulativeReward: 0,
};

function readMainStoreState(): Partial<MainSimState> {
  const store = useStore.getState();
  const frame = store.currentFrame;
  const frameIndex = store.currentFrameIndex;
  const scenario = store.scenarioId;

  if (!frame) return { frameIndex, scenarioId: scenario };

  const [ex, ey, ez] = frame.egoPosition;
  const egoYaw = frame.egoYaw;

  let egoSpeed = 8;
  const sd = store.sceneData;
  if (sd && frameIndex > 0) {
    const prevFrame = sd.frames[frameIndex - 1];
    if (prevFrame) {
      const dx = frame.egoPosition[0] - prevFrame.egoPosition[0];
      const dy = frame.egoPosition[1] - prevFrame.egoPosition[1];
      const dt = 1 / (sd.fps || 10);
      const spd = Math.sqrt(dx * dx + dy * dy) / dt;
      if (spd > 0.1) egoSpeed = spd;
    }
  }

  let nearestDist = 100;
  if (frame.boxes && frame.boxes.length > 0) {
    for (const box of frame.boxes) {
      // boxes are ego-relative, so cx/cy is distance from ego
      const d = Math.sqrt(box.cx * box.cx + box.cy * box.cy);
      if (d < nearestDist) nearestDist = d;
    }
  }

  return {
    frameIndex,
    scenarioId: scenario,
    egoSnapshot: {
      x: ex,
      y: ey,
      z: ez,
      heading: egoYaw,
      speed: egoSpeed,
      frameIndex,
    },
    nearestObjectDist: nearestDist,
  };
}

export const useSimManager = create<SimManagerState>((set, get) => ({
  runs: [],
  mainState: { ...defaultMainState },
  totalSpawned: 0,
  isSpawning: false,
  lastSpawnTime: 0,
  openenvConnected: false,
  openenvLastUpdate: 0,
  openenvNextUpdate: 0,

  actions: {
    setMainState: (partial) =>
      set((s) => ({ mainState: { ...s.mainState, ...partial } })),

    syncFromStore: () => {
      const storeState = readMainStoreState();
      set((s) => ({ mainState: { ...s.mainState, ...storeState } }));
    },

    spawnRuns: async () => {
      const state = get();
      if (state.isSpawning) return;

      // Only spawn if fewer than MAX_ACTIVE running
      const currentlyRunning = state.runs.filter((r) => r.status === "running").length;
      if (currentlyRunning >= MAX_ACTIVE) return;

      set({ isSpawning: true });

      const storeState = readMainStoreState();
      const mainState = { ...state.mainState, ...storeState };

      try {
        // Spawn only enough to fill up to MAX_ACTIVE
        const toSpawn = Math.min(SPAWN_COUNT, MAX_ACTIVE - currentlyRunning);
        const input = {
          frameIndex: mainState.frameIndex,
          egoX: mainState.egoSnapshot.x,
          egoY: mainState.egoSnapshot.y,
          egoSpeed: mainState.egoSnapshot.speed,
          nearestObjectDist: mainState.nearestObjectDist,
          scenarioId: mainState.scenarioId,
        };

        const baseSeed = Date.now();
        const seeds = Array.from({ length: toSpawn }, (_, i) => baseSeed + i * 7919);
        const variants = await getCounterfactualVariants(input, toSpawn);
        const totalBefore = state.totalSpawned;

        const newRuns = variants.map((v, i) => {
          const idx = totalBefore + i;
          const label = `Counterfactual ${LABELS[idx % LABELS.length]}${idx >= LABELS.length ? Math.floor(idx / LABELS.length) : ""}`;
          return createCounterfactualRun(
            label,
            v.branchId,
            seeds[i],
            mainState.frameIndex,
            { ...mainState.egoSnapshot },
            v,
          );
        });

        set((s) => ({
          runs: [...s.runs, ...newRuns],
          mainState,
          totalSpawned: s.totalSpawned + toSpawn,
          isSpawning: false,
          lastSpawnTime: Date.now(),
        }));
      } catch (e) {
        console.error("[simManager] spawn error:", e);
        set({ isSpawning: false });
      }
    },

    advanceAllRuns: async () => {
      const { runs, mainState } = get();
      const activeRuns = runs.filter((r) => r.status === "running");
      if (activeRuns.length === 0) return;

      const updated = await Promise.all(
        activeRuns.map(async (run) => {
          const lastEgo = run.egoTrajectory[run.egoTrajectory.length - 1];
          const input = {
            frameIndex: run.currentFrameIndex + 1,
            egoX: lastEgo.x,
            egoY: lastEgo.y,
            egoSpeed: lastEgo.speed,
            nearestObjectDist: mainState.nearestObjectDist,
            scenarioId: mainState.scenarioId,
            branchSeed: run.seed, // use the stored unique seed
          };
          const newAction = await getActionAndReward(input);
          const steps = run.actionStream.length;
          if (steps >= 20) {
            return { ...advanceRun(run, newAction, mainState.cumulativeReward), status: "finished" as const };
          }
          return advanceRun(run, newAction, mainState.cumulativeReward);
        }),
      );

      set((s) => {
        const newRuns = s.runs.map((r) => {
          const upd = updated.find((u) => u.id === r.id);
          return upd || r;
        });
        return { runs: newRuns };
      });
    },

    removeRun: (id) =>
      set((s) => ({ runs: s.runs.filter((r) => r.id !== id) })),

    updateMainFromOpenEnv: async () => {
      const storeState = readMainStoreState();
      const prevMain = get().mainState;
      const mainState = { ...prevMain, ...storeState };

      try {
        const result = await getActionAndReward({
          frameIndex: mainState.frameIndex,
          egoX: mainState.egoSnapshot.x,
          egoY: mainState.egoSnapshot.y,
          egoSpeed: mainState.egoSnapshot.speed,
          nearestObjectDist: mainState.nearestObjectDist,
          scenarioId: mainState.scenarioId,
        });

        set({
          mainState: {
            ...mainState,
            lastAction: result,
            cumulativeReward: mainState.cumulativeReward + result.reward,
          },
          openenvConnected: true,
          openenvLastUpdate: Date.now(),
          openenvNextUpdate: Date.now() + ADVANCE_INTERVAL_MS,
        });
      } catch {
        set({ mainState, openenvConnected: false });
      }
    },

    reset: () =>
      set({
        runs: [],
        mainState: { ...defaultMainState },
        totalSpawned: 0,
        isSpawning: false,
        lastSpawnTime: 0,
      }),
  },
}));

// ---------------------------------------------------------------------------
// Auto-spawn + advance + auto-play loop
// ---------------------------------------------------------------------------

let _spawnTimer: ReturnType<typeof setInterval> | null = null;
let _advanceTimer: ReturnType<typeof setInterval> | null = null;
let _syncTimer: ReturnType<typeof setInterval> | null = null;
let _playTimer: ReturnType<typeof setInterval> | null = null;

export function startSimLoop() {
  stopSimLoop();
  const { actions } = useSimManager.getState();

  // Ensure main store is playing
  const mainStore = useStore.getState();
  if (!mainStore.isPlaying) {
    mainStore.actions.togglePlay();
  }

  actions.syncFromStore();
  actions.spawnRuns();
  actions.updateMainFromOpenEnv();

  _syncTimer = setInterval(() => {
    actions.syncFromStore();
  }, 1_000);

  _spawnTimer = setInterval(() => {
    actions.spawnRuns();
  }, SPAWN_INTERVAL_MS);

  _advanceTimer = setInterval(() => {
    actions.advanceAllRuns();
    actions.updateMainFromOpenEnv();
  }, ADVANCE_INTERVAL_MS);

  // Keep playback alive — re-start if stopped
  _playTimer = setInterval(() => {
    const store = useStore.getState();
    if (!store.isPlaying) {
      store.actions.togglePlay();
    }
  }, 2_000);
}

export function stopSimLoop() {
  if (_spawnTimer) { clearInterval(_spawnTimer); _spawnTimer = null; }
  if (_advanceTimer) { clearInterval(_advanceTimer); _advanceTimer = null; }
  if (_syncTimer) { clearInterval(_syncTimer); _syncTimer = null; }
  if (_playTimer) { clearInterval(_playTimer); _playTimer = null; }
}
