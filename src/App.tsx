/**
 * App — Router + data loading + app shell.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster, toast } from "sonner";
import AppShell from "./components/ui/AppShell";
import SimPage from "./pages/SimPage";
import DashboardPage from "./pages/DashboardPage";
import GraphPage from "./pages/GraphPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import { lazy, Suspense } from "react";
const UploadPage = lazy(() => import("./pages/UploadPage"));
const RankPage = lazy(() => import("./pages/RankPage"));
import { useStore } from "./store";
import type { DataSource } from "./store";
import { ALL_SCENARIOS } from "./mockData";
import type { ScenarioId } from "./mockData";
import { loadScenario, preloadAllScenarios } from "./utils/scenarioLoader";
import { generateTrajectoryMoments } from "./utils/trajectoryData";
import {
  loadWaymoFromUrls,
  loadWaymoFromFiles,
  scanDroppedFiles,
  type WaymoLoadResult,
} from "./utils/waymoLoader";
import { getCachedScene, setCachedScene, cacheKey } from "./utils/sceneCache";
import { colors, fonts, typeScale } from "./theme";
import { captureError, setSentryScenario, Sentry } from "./lib/sentry";

// Route-aware tracing wrapper for react-router v7 (parameterized transactions
// like "/sim" instead of raw URLs). No-op when Sentry isn't initialized.
const SentryRoutes = Sentry.withSentryReactRouterV7Routing(Routes);

// ---------------------------------------------------------------------------
// Auto-detect waymo data layout
// ---------------------------------------------------------------------------

async function detectWaymoLayout(
  basePath: string,
  overrideSegment?: string | null,
): Promise<{ basePath: string; segmentName?: string }> {
  if (overrideSegment) {
    return { basePath, segmentName: overrideSegment };
  }
  try {
    const resp = await fetch(`${basePath}/manifest.json`);
    if (resp.ok) {
      const manifest = await resp.json();
      const segId = manifest.segment;
      if (segId) return { basePath, segmentName: segId };
    }
  } catch { /* no manifest */ }

  try {
    const resp = await fetch(`${basePath}/vehicle_pose.parquet`, { method: "HEAD" });
    if (resp.ok) return { basePath };
  } catch { /* not flat */ }

  throw new Error("No Waymo data found. Place parquet files in public/waymo_data/ or drag & drop.");
}

// ---------------------------------------------------------------------------
// Scenario pre-generation hook — eagerly generates all scenarios on mount
// ---------------------------------------------------------------------------

function useScenarioPreloader() {
  const [ready, setReady] = useState(false);
  const actions = useStore((s) => s.actions);

  useEffect(() => {
    const defaultScenario: ScenarioId = "normal";
    actions.setLoadStatus("loading");
    actions.setLoadMessage("Loading scenario…");

    loadScenario(defaultScenario, "ground_truth", (msg, progress) => {
      actions.setLoadMessage(msg);
      actions.setLoadProgress(progress);
    })
      .then((sceneData) => {
        actions.setScenarioId(defaultScenario);
        actions.setDataSource("scenario");
        actions.setSceneData(sceneData);
        const moments = generateTrajectoryMoments(sceneData);
        actions.setTrajectoryMoments(moments);
        setReady(true);

        // Pre-fetch remaining scenarios in background
        const remaining = ALL_SCENARIOS.filter((s) => s !== defaultScenario);
        preloadAllScenarios(remaining);
      })
      .catch((e) => {
        console.error("[preloader] Failed to load scenario:", e);
        captureError(e, {
          tags: { phase: "preload" },
          contexts: { scenario: { id: defaultScenario } },
        });
        actions.setLoadError(e instanceof Error ? e.message : String(e));
        actions.setLoadStatus("error");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return ready;
}

// ---------------------------------------------------------------------------
// Data loading hook (handles waymo loading; scenarios are pre-generated)
// ---------------------------------------------------------------------------

function useDataLoader() {
  const dataSource = useStore((s) => s.dataSource);
  const loadStatus = useStore((s) => s.loadStatus);
  const scenarioId = useStore((s) => s.scenarioId);
  const waymoSegment = useStore((s) => s.waymoSegment);
  const actions = useStore((s) => s.actions);

  useEffect(() => {
    if (loadStatus !== "idle") return;
    if (dataSource === "waymo-drop") return;

    if (dataSource === "scenario") {
      actions.setLoadStatus("loading");
      actions.setLoadMessage(`Loading "${scenarioId}" scenario`);
      actions.setLoadProgress(0.1);
      setSentryScenario(scenarioId);

      loadScenario(scenarioId, "ground_truth", (msg, progress) => {
        actions.setLoadMessage(msg);
        actions.setLoadProgress(progress);
      })
        .then((sceneData) => {
          actions.setSceneData(sceneData);
          const moments = generateTrajectoryMoments(sceneData);
          actions.setTrajectoryMoments(moments);
        })
        .catch((e) => {
          captureError(e, {
            tags: { phase: "load-scenario" },
            contexts: { scenario: { id: scenarioId } },
          });
          actions.setLoadError(e instanceof Error ? e.message : String(e));
          actions.setLoadStatus("error");
        });
    } else if (dataSource === "waymo") {
      actions.setLoadStatus("loading");
      actions.setLoadMessage("Checking cache…");
      actions.setLoadProgress(0);

      const key = cacheKey("waymo", waymoSegment);

      getCachedScene(key)
        .then((cached) => {
          if (cached) {
            actions.setLoadMessage("Restoring from cache…");
            actions.setLoadProgress(0.9);
            actions.setSceneData(cached);
            const moments = generateTrajectoryMoments(cached);
            actions.setTrajectoryMoments(moments);
            return;
          }

          actions.setLoadMessage("Detecting data layout");
          actions.setLoadProgress(0);

          return detectWaymoLayout("/waymo_data", waymoSegment)
            .then(({ basePath, segmentName }) => {
              actions.setLoadMessage("Opening Parquet files");
              return loadWaymoFromUrls(basePath, (step, progress) => {
                actions.setLoadMessage(step);
                actions.setLoadProgress(progress);
              }, segmentName);
            })
            .then((data: WaymoLoadResult) => {
              actions.setSceneData(data);
              const moments = generateTrajectoryMoments(data);
              actions.setTrajectoryMoments(moments);
              // Cache in background for next reload
              setCachedScene(key, data).catch(() => {});
            });
        })
        .catch((e) => {
          console.error("[loadWaymo] Error:", e);
          captureError(e, {
            tags: { phase: "load-waymo" },
            contexts: { waymo: { segment: waymoSegment ?? null } },
          });
          actions.setLoadError(e instanceof Error ? e.message : String(e));
          actions.setLoadStatus("error");
        });
    }
  }, [dataSource, loadStatus, scenarioId, waymoSegment, actions]);
}

// ---------------------------------------------------------------------------
// Loading screen
// ---------------------------------------------------------------------------

function LoadingScreen() {
  const loadMessage = useStore((s) => s.loadMessage);
  const displayProgress = useStore((s) => s.loadProgress);

  return (
    <div style={{
      position: "fixed", inset: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      backgroundColor: colors.bgDeep, flexDirection: "column", gap: 20,
      fontFamily: fonts.sans, zIndex: 100,
    }}>
      <div style={{
        width: 28, height: 28,
        border: `2px solid ${colors.accent}`,
        borderTopColor: "transparent",
        borderRadius: "50%",
        animation: "spin 0.7s linear infinite",
      }} />
      <div style={{
        width: 200, height: 2,
        backgroundColor: "rgba(255,255,255,0.06)",
        borderRadius: 2, overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          width: `${Math.round(displayProgress * 100)}%`,
          background: colors.accent,
          borderRadius: 2, transition: "width 0.3s ease-out",
        }} />
      </div>
      <span style={{ color: colors.textDim, ...typeScale.mono }}>
        {loadMessage}
      </span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error screen
// ---------------------------------------------------------------------------

function ErrorScreen() {
  const loadError = useStore((s) => s.loadError);
  const actions = useStore((s) => s.actions);

  return (
    <div style={{
      position: "fixed", inset: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      backgroundColor: colors.bgDeep, flexDirection: "column", gap: 16,
      fontFamily: fonts.sans,
    }}>
      <div style={{ maxWidth: 380, textAlign: "center", lineHeight: 1.5, fontSize: 13, color: colors.error }}>
        {loadError || "Unknown error"}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button onClick={() => { actions.reset(); actions.setDataSource("waymo"); }} style={btnStyle(true)}>
          Retry Waymo
        </button>
        <button onClick={() => { actions.reset(); actions.setDataSource("scenario"); }} style={btnStyle(false)}>
          Use Scenarios
        </button>
      </div>
    </div>
  );
}

function btnStyle(accent: boolean): React.CSSProperties {
  return {
    padding: "7px 18px", fontSize: 12, fontFamily: fonts.sans, fontWeight: 500,
    background: accent ? "rgba(0,232,157,0.08)" : "rgba(255,255,255,0.04)",
    color: accent ? colors.accent : colors.textSecondary,
    border: `1px solid ${accent ? colors.borderAccent : colors.border}`,
    borderRadius: 6, cursor: "pointer",
  };
}

// ---------------------------------------------------------------------------
// Drop zone
// ---------------------------------------------------------------------------

function useDropZone() {
  const actions = useStore((s) => s.actions);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  const skipPages = ["/upload", "/rank"];
  const onDragEnter = useCallback((e: DragEvent) => { e.preventDefault(); if (skipPages.includes(window.location.pathname)) return; dragCounter.current++; setDragging(true); }, []);
  const onDragLeave = useCallback((e: DragEvent) => { e.preventDefault(); if (skipPages.includes(window.location.pathname)) return; dragCounter.current--; if (dragCounter.current <= 0) { setDragging(false); dragCounter.current = 0; } }, []);
  const onDragOver = useCallback((e: DragEvent) => { e.preventDefault(); }, []);
  const onDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    // On /upload and /rank pages, let the page handle its own drops
    if (window.location.pathname === "/upload" || window.location.pathname === "/rank") return;
    setDragging(false);
    dragCounter.current = 0;
    if (!e.dataTransfer?.items) return;
    actions.reset();
    actions.setDataSource("waymo-drop");
    actions.setLoadStatus("loading");
    actions.setLoadMessage("Scanning files");
    actions.setLoadProgress(0);
    try {
      const fileMap = await scanDroppedFiles(e.dataTransfer.items);
      if (!fileMap.has("vehicle_pose") || !fileMap.has("lidar")) throw new Error("Need vehicle_pose + lidar parquet files.");
      const data = await loadWaymoFromFiles(fileMap, (step, progress) => { actions.setLoadMessage(step); actions.setLoadProgress(progress); });
      actions.setSceneData(data);
      const moments = generateTrajectoryMoments(data);
      actions.setTrajectoryMoments(moments);
      toast.success("Waymo data loaded successfully");
      // Cache dropped data for next reload
      setCachedScene(cacheKey("waymo-drop"), data).catch(() => {});
    } catch (err) {
      captureError(err, { tags: { phase: "waymo-drop" } });
      actions.setLoadError(err instanceof Error ? err.message : String(err));
      actions.setLoadStatus("error");
      toast.error("Failed to load Waymo data");
    }
  }, [actions]);

  useEffect(() => {
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [onDragEnter, onDragLeave, onDragOver, onDrop]);

  return dragging;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const ready = useScenarioPreloader();
  useDataLoader();
  const dragging = useDropZone();
  const loadStatus = useStore((s) => s.loadStatus);
  const sceneData = useStore((s) => s.sceneData);

  // Show loading during initial generation
  if (!ready && !sceneData) return <LoadingScreen />;
  if (loadStatus === "loading" || (!sceneData && loadStatus === "idle")) return <LoadingScreen />;
  if (loadStatus === "error") return <ErrorScreen />;

  return (
    <>
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: {
            background: colors.bgCard,
            border: `1px solid ${colors.border}`,
            color: colors.textPrimary,
            fontFamily: fonts.sans,
            fontSize: 12,
          },
        }}
      />

      <AppShell>
        <Suspense fallback={null}>
          <SentryRoutes>
            <Route path="/" element={<Navigate to="/sim" replace />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/sim" element={<SimPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/rank" element={<RankPage />} />
            <Route path="/graph" element={<GraphPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
          </SentryRoutes>
        </Suspense>
      </AppShell>

      {/* Drag overlay */}
      {dragging && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,232,157,0.04)",
          border: `2px dashed ${colors.accent}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", gap: 8,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, fontFamily: fonts.sans, color: colors.accent }}>
            Drop Waymo parquet files
          </div>
          <div style={{ fontSize: 11, fontFamily: fonts.mono, color: colors.textDim }}>
            vehicle_pose + lidar + lidar_box + lidar_calibration
          </div>
        </div>
      )}
    </>
  );
}
