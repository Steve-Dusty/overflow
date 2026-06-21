/**
 * When provided inside an R3F Canvas tree, overrides the global store's
 * currentFrame for PointCloud and BoundingBoxes. This allows dashboard
 * tiles to render independent scene data.
 *
 * Uses a mutable ref holder so the context value reference stays stable.
 * This prevents React re-renders in PointCloud/BoundingBoxes — they read
 * holder.current inside useFrame (Three.js loop) instead.
 */

import { createContext } from "react";
import type { FrameData } from "../mockData";

export interface FrameOverrideHolder {
  current: FrameData | null;
}

export const FrameOverrideContext = createContext<FrameOverrideHolder | null>(null);
