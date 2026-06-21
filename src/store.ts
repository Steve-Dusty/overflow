/**
 * Global state store — Zustand-based, supporting both scenario and real Waymo data.
 */

import { create } from "zustand";
import type { FrameData, SceneData, ScenarioId, IncidentWindow } from "./mockData";
import type { TrajectoryMoment, PlannerPolicy, ObserverPolicy } from "./utils/trajectoryData";

export type ColormapMode = "intensity" | "range" | "elongation";
export type BoxDisplayMode = "off" | "box" | "model";
export type DataSource = "scenario" | "waymo" | "waymo-drop";
export type LoadStatus = "idle" | "loading" | "ready" | "error";

interface StoreState {
  // Data
  sceneData: SceneData | null;
  dataSource: DataSource;
  scenarioId: ScenarioId;
  waymoSegment: string | null; // active segment name
  loadStatus: LoadStatus;
  loadMessage: string;
  loadProgress: number;
  loadError: string | null;

  // Playback
  currentFrameIndex: number;
  isPlaying: boolean;
  playbackSpeed: number;

  // Display
  colormapMode: ColormapMode;
  boxMode: BoxDisplayMode;
  pointOpacity: number;
  showGrid: boolean;
  showTrajectories: boolean;
  analyticsOpen: boolean;

  // Custom AI scenario overrides
  customIncident: IncidentWindow | null;
  customScenarioName: string | null;
  customSeverity: "none" | "warning" | "critical" | null;

  // Trajectory / E2E
  trajectoryMoments: TrajectoryMoment[];
  currentMomentIndex: number;
  plannerPolicy: PlannerPolicy;
  observerPolicy: ObserverPolicy;
  autoPlayMoments: boolean;

  // Computed
  currentFrame: FrameData | null;
  totalFrames: number;

  // Actions
  actions: {
    setSceneData: (data: SceneData) => void;
    setFrame: (index: number) => void;
    nextFrame: () => void;
    prevFrame: () => void;
    togglePlay: () => void;
    setPlaying: (v: boolean) => void;
    setPlaybackSpeed: (speed: number) => void;
    setColormapMode: (mode: ColormapMode) => void;
    setBoxMode: (mode: BoxDisplayMode) => void;
    setPointOpacity: (v: number) => void;
    toggleGrid: () => void;
    setDataSource: (source: DataSource) => void;
    setScenarioId: (scenario: ScenarioId) => void;
    setWaymoSegment: (seg: string | null) => void;
    setLoadStatus: (status: LoadStatus) => void;
    setLoadMessage: (msg: string) => void;
    setLoadProgress: (p: number) => void;
    setLoadError: (err: string | null) => void;
    setCustomIncident: (incident: IncidentWindow | null, name?: string, severity?: "none" | "warning" | "critical") => void;
    // Trajectory
    setTrajectoryMoments: (moments: TrajectoryMoment[]) => void;
    setCurrentMomentIndex: (idx: number) => void;
    nextMoment: () => void;
    prevMoment: () => void;
    setPlannerPolicy: (policy: PlannerPolicy) => void;
    setObserverPolicy: (policy: ObserverPolicy) => void;
    toggleTrajectories: () => void;
    toggleAutoPlayMoments: () => void;
    setAnalyticsOpen: (open: boolean) => void;
    reset: () => void;
  };
}

export const useStore = create<StoreState>((set, get) => ({
  sceneData: null,
  dataSource: "scenario",
  scenarioId: "normal",
  waymoSegment: null,
  customIncident: null,
  customScenarioName: null,
  customSeverity: null,
  loadStatus: "idle",
  loadMessage: "",
  loadProgress: 0,
  loadError: null,
  currentFrameIndex: 0,
  isPlaying: false,
  playbackSpeed: 1,
  colormapMode: "intensity",
  boxMode: "model",
  pointOpacity: 0.85,
  showGrid: true,
  showTrajectories: true,
  analyticsOpen: false,
  currentFrame: null,
  totalFrames: 0,

  // Trajectory
  trajectoryMoments: [],
  currentMomentIndex: 0,
  plannerPolicy: "worst",
  observerPolicy: "best",
  autoPlayMoments: false,

  actions: {
    setSceneData: (data) =>
      set({
        sceneData: data,
        totalFrames: data.totalFrames,
        currentFrameIndex: 0,
        currentFrame: data.frames[0] ?? null,
        loadStatus: "ready",
        loadError: null,
      }),

    setFrame: (index) => {
      const { sceneData } = get();
      if (!sceneData) return;
      const clamped = Math.max(0, Math.min(sceneData.totalFrames - 1, index));
      set({ currentFrameIndex: clamped, currentFrame: sceneData.frames[clamped] });
    },

    nextFrame: () => {
      const { sceneData, currentFrameIndex } = get();
      if (!sceneData) return;
      const next = (currentFrameIndex + 1) % sceneData.totalFrames;
      set({ currentFrameIndex: next, currentFrame: sceneData.frames[next] });
    },

    prevFrame: () => {
      const { sceneData, currentFrameIndex } = get();
      if (!sceneData) return;
      const prev = (currentFrameIndex - 1 + sceneData.totalFrames) % sceneData.totalFrames;
      set({ currentFrameIndex: prev, currentFrame: sceneData.frames[prev] });
    },

    togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
    setPlaying: (v) => set({ isPlaying: v }),
    setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
    setColormapMode: (mode) => set({ colormapMode: mode }),
    setBoxMode: (mode) => set({ boxMode: mode }),
    setPointOpacity: (v) => set({ pointOpacity: v }),
    toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
    setDataSource: (source) => set({ dataSource: source }),
    setScenarioId: (scenario) => set({ scenarioId: scenario }),
    setWaymoSegment: (seg) => set({ waymoSegment: seg }),
    setLoadStatus: (status) => set({ loadStatus: status }),
    setLoadMessage: (msg) => set({ loadMessage: msg }),
    setLoadProgress: (p) => set({ loadProgress: p }),
    setLoadError: (err) => set({ loadError: err }),
    setCustomIncident: (incident, name, severity) => set({
      customIncident: incident,
      customScenarioName: name ?? null,
      customSeverity: severity ?? null,
    }),

    // Trajectory
    setTrajectoryMoments: (moments) => set({ trajectoryMoments: moments, currentMomentIndex: 0 }),
    setCurrentMomentIndex: (idx) => {
      const { trajectoryMoments } = get();
      if (trajectoryMoments.length === 0) return;
      const clamped = Math.max(0, Math.min(trajectoryMoments.length - 1, idx));
      set({ currentMomentIndex: clamped });
    },
    nextMoment: () => {
      const { trajectoryMoments, currentMomentIndex } = get();
      if (trajectoryMoments.length === 0) return;
      set({ currentMomentIndex: (currentMomentIndex + 1) % trajectoryMoments.length });
    },
    prevMoment: () => {
      const { trajectoryMoments, currentMomentIndex } = get();
      if (trajectoryMoments.length === 0) return;
      set({ currentMomentIndex: (currentMomentIndex - 1 + trajectoryMoments.length) % trajectoryMoments.length });
    },
    setPlannerPolicy: (policy) => set({ plannerPolicy: policy }),
    setObserverPolicy: (policy) => set({ observerPolicy: policy }),
    toggleTrajectories: () => set((s) => ({ showTrajectories: !s.showTrajectories })),
    toggleAutoPlayMoments: () => set((s) => ({ autoPlayMoments: !s.autoPlayMoments })),
    setAnalyticsOpen: (open) => set({ analyticsOpen: open }),

    reset: () =>
      set({
        sceneData: null,
        currentFrameIndex: 0,
        currentFrame: null,
        totalFrames: 0,
        isPlaying: false,
        loadStatus: "idle",
        loadMessage: "",
        loadProgress: 0,
        loadError: null,
        customIncident: null,
        customScenarioName: null,
        customSeverity: null,
        trajectoryMoments: [],
        currentMomentIndex: 0,
      }),
  },
}));
