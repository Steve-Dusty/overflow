# Improving Autonomous Vehicles

Multi-sim dashboard for autonomous vehicle perception. Replays Waymo scenes in 3D, proposes ego actions via the OpenEnv model, and continuously spawns counterfactual rollouts to compare "what if the ego chose differently?"

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The app defaults to mock data mode (no Waymo files needed).

## Pages

| Route | Description |
|-------|-------------|
| `/sim` | Main 3D simulator. LiDAR point cloud, bounding boxes, ego vehicle. Autonomy Stack panel shows OpenEnv actions/rewards in real time. |
| `/dashboard` | Camera-grid multi-sim view. Ground truth + auto-spawning counterfactual rollouts. Every 10s, 3 new sims appear with different ego decisions. |
| `/graph` | 3D knowledge graph (ForceGraph3D). Connects scenarios, incidents, runs, actions, metrics, and rewards. Click any node to inspect. |
| `/analytics` | Overview cards, sortable run table, reward timeline chart, incident ticket feed. |

## OpenEnv Configuration

The OpenEnv model provides actions and rewards for the ego vehicle.

**Mock mode** (default): Deterministic pseudo-random actions based on scene context. No external API needed.

**Real mode**: Set an environment variable to point at your OpenEnv endpoint:

```bash
VITE_OPENENV_ENDPOINT=http://localhost:8080/predict
VITE_OPENENV_MODE=real
```

Then in your code, call `configureOpenEnv({ mode: "real", endpoint: import.meta.env.VITE_OPENENV_ENDPOINT })`.

The client module lives at `src/lib/openenvClient.ts` and exposes:
- `getActionAndReward(input)` — single action/reward query
- `getCounterfactualVariants(input, count)` — N variant actions for branching

## Waymo Data

Place Waymo Open Dataset parquet files in `public/waymo_data/`:
- `vehicle_pose.parquet`
- `lidar.parquet`
- `lidar_box.parquet` (optional)
- `lidar_calibration.parquet`

Or drag and drop files directly onto the simulator.

## Demo Script

1. Open `http://localhost:5173/sim`
2. The sim loads with mock data. Use the scenario selector (top-left) to pick "Near Miss" or "Jaywalker"
3. Press Play. Watch the Autonomy Stack panel (right) update every 3s with OpenEnv actions/rewards
4. Click "Explain last decision" to see the model's reasoning
5. Navigate to `/dashboard` — the camera grid auto-populates with counterfactual sims
6. Watch new tiles appear every 10s. Each shows a 2D top-down mini-map of the ego's divergent trajectory
7. Click any tile to see full metrics and action stream
8. Go to `/graph` — the knowledge graph connects runs, actions, metrics, and rewards. Click nodes to inspect
9. Go to `/analytics` — overview cards, sortable table, timeline chart, and incident feed

## Tech Stack

- React 19 + TypeScript + Vite
- Three.js + React Three Fiber (3D rendering)
- Zustand (state management)
- react-force-graph-3d (knowledge graph)
- Sonner (toast notifications)
- Lucide React (icons)
- Hyparquet (browser-native Parquet reader)

## Project Structure

```
src/
  pages/           SimPage, DashboardPage, GraphPage, AnalyticsPage
  components/      Scene3D, Timeline, and existing 3D components (kept intact)
  components/ui/   AppShell, Card, Badge (design system)
  lib/             openenvClient, simManager, simTypes
  utils/           parquet, waymoLoader, rangeImage, trajectoryData, scenarioAI
  store.ts         Zustand global state
  theme.ts         Design tokens (colors, typography, spacing)
  mockData.ts      Synthetic scenario generation + LiDAR raytracing
```

## Agent stack — ArmorIQ · AgentSpan · Band

Overflow runs an AV-safety agent fleet on three layers of agent infrastructure:

- **ArmorIQ** (`scripts/armoriq_*.mjs`) — governance: every tool call gated by a signed intent token. `npm run agent`, `npm run fleet`.
- **AgentSpan** (`scripts/agentspan_*.py`) — durable execution: crash-resume, retries, structured output, guardrails, human approval. `npm run agentspan`, `npm run agentspan:fleet`.
- **Band** (`scripts/band_agents.py`) — cross-agent discovery + `@mention` coordination. `npm run band -- auditor`.

Python setup (once): `uv venv .venv && uv pip install -r requirements-agents.txt` — the agents reuse the OpenAI key in `server/.env`.

See **[AGENT_STACK.md](AGENT_STACK.md)** for the full story and run guide.
