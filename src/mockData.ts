/**
 * Scene data generator — realistic self-driving perception data:
 *   • Proper 2-lane road with ego driving straight
 *   • Other vehicles in lanes, oncoming traffic, parked cars
 *   • Pedestrians on sidewalks, cyclists in bike lane
 *   • LiDAR 64-beam scanner with ray-traced ground + objects
 *   • Incident scenarios: near-miss, rear-end collision, jaywalker, red-light runner
 */

// ── Types ──────────────────────────────────────────────────────────

export type ActorType = "vehicle" | "pedestrian" | "cyclist" | "sign";

export type ScenarioId =
  | "normal"
  | "near_miss"
  | "rear_end"
  | "jaywalker"
  | "red_light_runner"
  | "swerving_vehicle"
  | "final_model";

export type SceneVariant =
  | "ground_truth"
  | "avoid_left"
  | "avoid_right"
  | "emergency_brake";

export const ALL_VARIANTS: SceneVariant[] = [
  "ground_truth", "avoid_left", "avoid_right", "emergency_brake",
];

export const VARIANT_INFO: Record<SceneVariant, { label: string; description: string }> = {
  ground_truth: { label: "Ground Truth", description: "" },
  avoid_left: { label: "Swerve Left", description: "Evasive maneuver — left" },
  avoid_right: { label: "Swerve Right", description: "Evasive maneuver — right" },
  emergency_brake: { label: "Emergency Brake", description: "Hard stop" },
};

export interface VariantMetrics {
  reward: number;
  safety: number;
  ttc: number;       // time-to-collision (seconds) — higher is safer
  status: "optimal" | "suboptimal" | "dangerous";
}

/**
 * Per-scenario, per-variant reward & safety metrics.
 * Rewards are based on threat geometry:
 *   - moving away from hazard → high reward
 *   - neutral action → moderate reward
 *   - moving toward hazard → negative reward
 */
export const VARIANT_METRICS: Record<ScenarioId, Record<SceneVariant, VariantMetrics>> = {
  normal: {
    ground_truth: { reward: 0.91, safety: 0.95, ttc: Infinity, status: "optimal" },
    avoid_left:   { reward: 0.42, safety: 0.78, ttc: Infinity, status: "suboptimal" },
    avoid_right:  { reward: 0.45, safety: 0.80, ttc: Infinity, status: "suboptimal" },
    emergency_brake: { reward: 0.31, safety: 0.72, ttc: Infinity, status: "suboptimal" },
  },
  near_miss: {
    // Threat from LEFT lane — swerve right is best, swerve left is worst
    ground_truth: { reward: -0.72, safety: 0.12, ttc: 1.2, status: "dangerous" },
    avoid_left:   { reward: -0.45, safety: 0.18, ttc: 0.8,  status: "dangerous" },
    avoid_right:  { reward:  0.92, safety: 0.94, ttc: 4.7,  status: "optimal" },
    emergency_brake: { reward: 0.61, safety: 0.71, ttc: 2.3, status: "suboptimal" },
  },
  rear_end: {
    // Threat AHEAD — emergency brake best, lane change OK
    ground_truth: { reward: -0.84, safety: 0.08, ttc: 0.9, status: "dangerous" },
    avoid_left:   { reward:  0.73, safety: 0.82, ttc: 3.9,  status: "suboptimal" },
    avoid_right:  { reward:  0.58, safety: 0.68, ttc: 3.1,  status: "suboptimal" },
    emergency_brake: { reward: 0.89, safety: 0.93, ttc: 5.2, status: "optimal" },
  },
  jaywalker: {
    // Pedestrian from RIGHT — swerve left best, swerve right worst
    ground_truth: { reward: -0.91, safety: 0.05, ttc: 0.6, status: "dangerous" },
    avoid_left:   { reward:  0.94, safety: 0.96, ttc: 5.1,  status: "optimal" },
    avoid_right:  { reward: -0.67, safety: 0.11, ttc: 0.4,  status: "dangerous" },
    emergency_brake: { reward: 0.78, safety: 0.85, ttc: 3.4, status: "suboptimal" },
  },
  red_light_runner: {
    // Cross-traffic from LEFT — emergency brake best, swerve left worst
    ground_truth: { reward: -0.88, safety: 0.06, ttc: 0.7, status: "dangerous" },
    avoid_left:   { reward: -0.52, safety: 0.15, ttc: 0.5,  status: "dangerous" },
    avoid_right:  { reward:  0.71, safety: 0.79, ttc: 3.6,  status: "suboptimal" },
    emergency_brake: { reward: 0.88, safety: 0.92, ttc: 4.8, status: "optimal" },
  },
  swerving_vehicle: {
    // Erratic vehicle ahead — emergency brake best, swerve left risky
    ground_truth: { reward: -0.58, safety: 0.22, ttc: 1.5, status: "dangerous" },
    avoid_left:   { reward: -0.23, safety: 0.35, ttc: 1.8,  status: "dangerous" },
    avoid_right:  { reward:  0.69, safety: 0.76, ttc: 3.8,  status: "suboptimal" },
    emergency_brake: { reward: 0.84, safety: 0.91, ttc: 5.0, status: "optimal" },
  },
  final_model: {
    // Combined optimal — always takes best action
    ground_truth: { reward: 0.89, safety: 0.93, ttc: 4.6, status: "optimal" },
    avoid_left:   { reward: 0.89, safety: 0.93, ttc: 4.6, status: "optimal" },
    avoid_right:  { reward: 0.89, safety: 0.93, ttc: 4.6, status: "optimal" },
    emergency_brake: { reward: 0.89, safety: 0.93, ttc: 4.6, status: "optimal" },
  },
};

/**
 * Timestamped scene observations for streaming log overlay.
 * These describe what's happening in the environment (not agent decisions).
 */
export interface SceneObservation {
  time: number;
  severity: "nominal" | "caution" | "danger";
  message: string;
}

export const SCENE_OBSERVATIONS: Record<ScenarioId, SceneObservation[]> = {
  normal: [
    { time: 0.0, severity: "nominal", message: "Ego vehicle active — cruising at 11.0 m/s in right lane" },
    { time: 1.5, severity: "nominal", message: "LiDAR scan nominal — 3 vehicles, 1 cyclist detected in field of view" },
    { time: 3.0, severity: "nominal", message: "Traffic flow steady — all adjacent vehicles maintaining lane discipline" },
    { time: 5.0, severity: "nominal", message: "Oncoming lane clear — no lateral encroachment detected" },
    { time: 7.0, severity: "nominal", message: "Perception confidence 0.97 — bounding boxes stable across frames" },
    { time: 9.0, severity: "nominal", message: "Road geometry straight — no curvature, no grade change" },
    { time: 11.0, severity: "nominal", message: "Following distance 22m to lead vehicle — TTC > 10s" },
    { time: 13.0, severity: "nominal", message: "No anomalies in sensor sweep — environment nominal" },
    { time: 15.5, severity: "nominal", message: "Scan complete — 0 incidents logged for this segment" },
    { time: 18.0, severity: "nominal", message: "Segment ending — all metrics within safe operating envelope" },
  ],
  near_miss: [
    { time: 0.0, severity: "nominal", message: "Ego vehicle active — cruising at 11.0 m/s in right lane" },
    { time: 1.5, severity: "nominal", message: "Vehicle detected in left lane — tracking ID #100, speed 11.0 m/s" },
    { time: 3.0, severity: "nominal", message: "Left-lane vehicle holding position — 15m ahead, stable heading" },
    { time: 4.5, severity: "caution", message: "Left-lane vehicle heading drift detected — yaw offset -0.08 rad" },
    { time: 5.0, severity: "caution", message: "⚠ Vehicle #100 initiating lateral movement toward ego lane" },
    { time: 5.5, severity: "danger", message: "⚠ Lane encroachment — vehicle swerving into ego lane, closing at 2.1 m/s lateral" },
    { time: 6.0, severity: "danger", message: "🚨 Near-miss event — vehicle #100 within 0.3m of ego lane center" },
    { time: 6.5, severity: "danger", message: "🚨 Peak danger — minimum lateral separation 0.3m, TTC 1.2s" },
    { time: 7.0, severity: "caution", message: "Vehicle #100 beginning lane recovery — heading correcting" },
    { time: 8.0, severity: "caution", message: "Vehicle returning to left lane — lateral velocity reversing" },
    { time: 9.0, severity: "nominal", message: "Lane encroachment resolved — vehicle #100 back in original lane" },
    { time: 11.0, severity: "nominal", message: "Incident window closed — monitoring resumed" },
    { time: 14.0, severity: "nominal", message: "No further anomalies — traffic stabilized" },
  ],
  rear_end: [
    { time: 0.0, severity: "nominal", message: "Ego vehicle active — cruising at 11.0 m/s in right lane" },
    { time: 1.5, severity: "nominal", message: "Lead vehicle detected — ID #100, 20m ahead, speed 12.0 m/s" },
    { time: 3.0, severity: "nominal", message: "Following distance stable — closing rate 1.0 m/s" },
    { time: 4.5, severity: "nominal", message: "Trailing vehicle detected — ID #101, 10m behind, speed 12.4 m/s" },
    { time: 5.5, severity: "caution", message: "Lead vehicle decelerating — brake lights detected, speed dropping" },
    { time: 6.0, severity: "danger", message: "⚠ Hard braking ahead — lead vehicle decelerating at 5.0 m/s²" },
    { time: 6.5, severity: "danger", message: "🚨 Following distance critical — gap closing rapidly, TTC 0.9s" },
    { time: 7.0, severity: "danger", message: "🚨 Collision risk — lead vehicle speed 2.0 m/s, ego still at 11.0 m/s" },
    { time: 7.5, severity: "danger", message: "🚨 Lead vehicle stopped — ego closing at full speed, impact imminent" },
    { time: 9.0, severity: "caution", message: "High-risk window persists — ego has not decelerated" },
    { time: 11.0, severity: "nominal", message: "Lead vehicle resuming — accelerating back to traffic speed" },
    { time: 14.0, severity: "nominal", message: "Gap restoring — monitoring resumed" },
  ],
  jaywalker: [
    { time: 0.0, severity: "nominal", message: "Ego vehicle active — cruising at 11.0 m/s, parked vehicles on right" },
    { time: 1.5, severity: "nominal", message: "Scanning road edges — parked cars detected at 3.5m right offset" },
    { time: 3.0, severity: "nominal", message: "No pedestrians in roadway — sidewalk zones clear" },
    { time: 3.8, severity: "caution", message: "Motion detected behind parked vehicle at 11m ahead — possible pedestrian" },
    { time: 4.0, severity: "danger", message: "⚠ Pedestrian entering roadway — darting from between parked cars at 55m" },
    { time: 4.5, severity: "danger", message: "🚨 Jaywalker in lane — running at 2.5 m/s, crossing path of ego" },
    { time: 5.0, severity: "danger", message: "🚨 Second pedestrian detected — child following at 3.0 m/s" },
    { time: 5.5, severity: "danger", message: "🚨 Multiple pedestrians in roadway — TTC 0.6s to nearest" },
    { time: 6.5, severity: "danger", message: "🚨 Critical — pedestrians still crossing, ego has not braked" },
    { time: 7.5, severity: "caution", message: "Pedestrians clearing ego lane — lateral offset increasing" },
    { time: 8.5, severity: "nominal", message: "Pedestrians clear of roadway — crossing complete" },
    { time: 10.0, severity: "nominal", message: "Incident resolved — road clear, monitoring resumed" },
  ],
  red_light_runner: [
    { time: 0.0, severity: "nominal", message: "Ego vehicle approaching intersection — speed 11.0 m/s" },
    { time: 1.5, severity: "nominal", message: "Intersection geometry detected — crosswalk zone ahead at 55m" },
    { time: 3.0, severity: "nominal", message: "Stopped vehicle detected at intersection — waiting at light" },
    { time: 4.0, severity: "caution", message: "Pedestrian detected at far curb — appears to be preparing to cross" },
    { time: 4.5, severity: "danger", message: "⚠ Pedestrian ignoring signal — stepping into crosswalk against red" },
    { time: 5.0, severity: "danger", message: "🚨 Red-light runner — pedestrian sprinting across intersection at 5.0 m/s" },
    { time: 5.5, severity: "danger", message: "🚨 Collision path — pedestrian crossing ego's forward path, TTC 0.7s" },
    { time: 6.0, severity: "danger", message: "🚨 Second pedestrian entering crosswalk — following the first" },
    { time: 7.0, severity: "caution", message: "First pedestrian clearing ego lane — second still in path" },
    { time: 8.0, severity: "nominal", message: "Crosswalk clearing — pedestrians reaching far side" },
    { time: 10.0, severity: "nominal", message: "Intersection clear — resuming normal scan" },
  ],
  swerving_vehicle: [
    { time: 0.0, severity: "nominal", message: "Ego vehicle active — cruising at 11.0 m/s in right lane" },
    { time: 1.0, severity: "caution", message: "Vehicle ahead exhibiting oscillating trajectory — ID #100" },
    { time: 2.0, severity: "caution", message: "⚠ Erratic behavior — vehicle weaving across lane markings, ±2.8m lateral" },
    { time: 3.0, severity: "caution", message: "⚠ Swerve frequency 0.4 Hz — consistent oscillation pattern detected" },
    { time: 4.5, severity: "danger", message: "🚨 Vehicle encroaching ego lane — lateral offset at extremum" },
    { time: 6.0, severity: "danger", message: "🚨 Peak danger — swerving vehicle at closest approach, TTC 1.5s" },
    { time: 7.5, severity: "caution", message: "Vehicle swinging back to center — still oscillating" },
    { time: 9.0, severity: "danger", message: "⚠ Second encroachment — vehicle swerving into ego lane again" },
    { time: 11.0, severity: "caution", message: "Erratic pattern continuing — no sign of stabilization" },
    { time: 13.0, severity: "caution", message: "Sustained erratic driving — swerving vehicle still ahead" },
    { time: 15.0, severity: "caution", message: "Vehicle maintaining erratic trajectory — distance slowly increasing" },
    { time: 17.0, severity: "nominal", message: "Swerving vehicle pulling ahead — risk level decreasing" },
  ],
  final_model: [
    { time: 0.0, severity: "nominal", message: "TRAINED MODEL ACTIVE — optimal policy loaded, scanning environment" },
    { time: 0.5, severity: "nominal", message: "Ego cruising at 11.0 m/s — all sensors nominal" },
    { time: 1.0, severity: "caution", message: "⚠ Left-lane vehicle drifting — near-miss threat detected" },
    { time: 1.5, severity: "danger", message: "🚨 ACTION: Swerve right — evading left-lane encroachment (R: +0.92)" },
    { time: 2.5, severity: "nominal", message: "✓ Near-miss avoided — resuming forward trajectory" },
    { time: 3.5, severity: "caution", message: "⚠ Lead vehicle hard braking — rear-end risk detected" },
    { time: 4.0, severity: "danger", message: "🚨 ACTION: Emergency brake — stopping before collision (R: +0.89)" },
    { time: 5.5, severity: "nominal", message: "✓ Rear-end avoided — resuming speed" },
    { time: 6.0, severity: "caution", message: "⚠ Motion detected at road edge — pedestrian emerging" },
    { time: 6.5, severity: "danger", message: "🚨 ACTION: Swerve left — evading jaywalker from right (R: +0.94)" },
    { time: 7.5, severity: "nominal", message: "✓ Jaywalker avoided — pedestrians clear, correcting course" },
    { time: 9.0, severity: "caution", message: "⚠ Pedestrian at intersection — ignoring red signal" },
    { time: 9.5, severity: "danger", message: "🚨 ACTION: Emergency brake — stopping before crosswalk (R: +0.88)" },
    { time: 10.5, severity: "nominal", message: "✓ Red-light runner avoided — intersection clearing" },
    { time: 11.5, severity: "caution", message: "⚠ Erratic vehicle ahead — oscillating trajectory detected" },
    { time: 12.0, severity: "danger", message: "🚨 ACTION: Emergency brake — increasing distance from threat (R: +0.84)" },
    { time: 13.5, severity: "nominal", message: "✓ Safe distance established — swerving vehicle ahead" },
    { time: 14.5, severity: "nominal", message: "ALL INCIDENTS RESOLVED — 5/5 optimal actions taken, cumulative R: +4.47" },
  ],
};

/** @deprecated Use ScenarioId instead */
export type MockScenario = ScenarioId;

export interface BBox3D {
  id: string;
  type: ActorType;
  cx: number; cy: number; cz: number;
  sx: number; sy: number; sz: number;
  heading: number;
  speed: number;
  label: string;
  trackId: number;
}

export interface FrameData {
  timestamp: number;
  egoPosition: [number, number, number];
  egoYaw: number;
  boxes: BBox3D[];
  pointPositions: Float32Array;
  pointAttributes: Float32Array;
  pointCount: number;
}

export interface SceneData {
  frames: FrameData[];
  fps: number;
  totalSeconds: number;
  totalFrames: number;
}

// ── Constants ──────────────────────────────────────────────────────

const NUM_FRAMES = 198;
const FPS = 10;

const LIDAR_BEAMS = 64;
const LIDAR_COLUMNS = 2650;
const MAX_RANGE = 75;
const BEAM_V_MIN = -25;
const BEAM_V_MAX = 2;

// Road geometry (Waymo-style: X=forward, Y=left)
const LANE_WIDTH = 3.7;           // standard US lane
const ROAD_SHOULDER = 1.5;
// Ego drives in right lane center: y ≈ -LANE_WIDTH/2
const EGO_LANE_Y = -LANE_WIDTH / 2;
// Same-direction left lane
const LEFT_LANE_Y = LANE_WIDTH / 2;
// Oncoming lanes (separated by ~1m median)
const ONCOMING_RIGHT_Y = LANE_WIDTH + 1.0 + LANE_WIDTH / 2;
const ONCOMING_LEFT_Y = LANE_WIDTH + 1.0 + LANE_WIDTH * 1.5;
// Sidewalks / parking
const RIGHT_SIDEWALK_Y = -(LANE_WIDTH + ROAD_SHOULDER + 1.5);
const LEFT_SIDEWALK_Y = ONCOMING_LEFT_Y + LANE_WIDTH / 2 + ROAD_SHOULDER + 1.5;
const PARKING_RIGHT_Y = -(LANE_WIDTH + ROAD_SHOULDER + 0.3);
const PARKING_LEFT_Y = LEFT_SIDEWALK_Y - 2.5;

// Ego speed
const EGO_SPEED = 11.0; // m/s ≈ 25 mph city driving

// ── Helpers ────────────────────────────────────────────────────────

function rand(lo: number, hi: number) { return lo + Math.random() * (hi - lo); }
function gaussRand() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
function lerp(a: number, b: number, t: number) { return a + (b - a) * Math.max(0, Math.min(1, t)); }
function smoothstep(t: number) { return t * t * (3 - 2 * t); }

// ── LiDAR ray tracer ──────────────────────────────────────────────

interface SimpleOccupancy { boxes: BBox3D[]; }

function traceRay(
  azimuth: number, elevation: number, occ: SimpleOccupancy,
): { x: number; y: number; z: number; intensity: number; range: number; elongation: number } | null {
  const cosE = Math.cos(elevation);
  const sinE = Math.sin(elevation);
  const cosA = Math.cos(azimuth);
  const sinA = Math.sin(azimuth);
  const dx = cosE * cosA;
  const dy = cosE * sinA;
  const dz = sinE;

  let bestT = MAX_RANGE;
  let hitType: "ground" | "object" | "none" = "none";

  const sensorZ = 2.0;
  if (dz < -0.001) {
    const tGround = -sensorZ / dz;
    const gx = dx * tGround;
    const gy = dy * tGround;
    const gr = Math.sqrt(gx * gx + gy * gy);
    if (gr < MAX_RANGE && tGround < bestT) { bestT = tGround; hitType = "ground"; }
  }

  for (const box of occ.boxes) {
    const cosH = Math.cos(-box.heading);
    const sinH = Math.sin(-box.heading);
    const ox = -box.cx, oy = -box.cy, oz = sensorZ - box.cz;
    const lox = ox * cosH - oy * sinH;
    const loy = ox * sinH + oy * cosH;
    const ldx = dx * cosH - dy * sinH;
    const ldy = dx * sinH + dy * cosH;
    const halfX = box.sx / 2, halfY = box.sy / 2, halfZ = box.sz / 2;

    let tMin = -1e9, tMax = 1e9;
    if (Math.abs(ldx) > 1e-8) {
      const t1 = (-halfX - lox) / ldx, t2 = (halfX - lox) / ldx;
      tMin = Math.max(tMin, Math.min(t1, t2)); tMax = Math.min(tMax, Math.max(t1, t2));
    } else if (Math.abs(lox) > halfX) continue;
    if (Math.abs(ldy) > 1e-8) {
      const t1 = (-halfY - loy) / ldy, t2 = (halfY - loy) / ldy;
      tMin = Math.max(tMin, Math.min(t1, t2)); tMax = Math.min(tMax, Math.max(t1, t2));
    } else if (Math.abs(loy) > halfY) continue;
    if (Math.abs(dz) > 1e-8) {
      const t1 = (-halfZ - oz) / dz, t2 = (halfZ - oz) / dz;
      tMin = Math.max(tMin, Math.min(t1, t2)); tMax = Math.min(tMax, Math.max(t1, t2));
    } else if (Math.abs(oz) > halfZ) continue;

    if (tMin <= tMax && tMax > 0) {
      const tHit = tMin > 0 ? tMin : tMax;
      if (tHit < bestT && tHit > 0.5) { bestT = tHit; hitType = "object"; }
    }
  }

  if (hitType === "none") return null;

  const px = dx * bestT, py = dy * bestT, pz = sensorZ + dz * bestT;
  let intensity: number, elongation: number;
  if (hitType === "ground") {
    intensity = 0.15 + 0.25 * (1 - bestT / MAX_RANGE) + gaussRand() * 0.05;
    elongation = rand(0.0, 0.1);
  } else {
    intensity = 0.5 + rand(0, 0.5);
    elongation = rand(0.0, 0.3);
  }
  intensity = Math.max(0, Math.min(1, intensity));

  return {
    x: px + gaussRand() * 0.02, y: py + gaussRand() * 0.02, z: pz + gaussRand() * 0.01,
    intensity, range: bestT, elongation: Math.max(0, Math.min(1, elongation)),
  };
}

function generateLidarFrame(boxes: BBox3D[]): {
  positions: Float32Array; attributes: Float32Array; count: number;
} {
  const occ: SimpleOccupancy = { boxes };
  const maxPts = LIDAR_BEAMS * LIDAR_COLUMNS;
  const positions = new Float32Array(maxPts * 3);
  const attributes = new Float32Array(maxPts * 3);
  let count = 0;
  const colStep = 4;

  for (let beam = 0; beam < LIDAR_BEAMS; beam++) {
    const elevDeg = BEAM_V_MIN + (BEAM_V_MAX - BEAM_V_MIN) * (beam / (LIDAR_BEAMS - 1));
    const elevRad = elevDeg * (Math.PI / 180);
    for (let col = 0; col < LIDAR_COLUMNS; col += colStep) {
      const azimuthRad = (col / LIDAR_COLUMNS) * Math.PI * 2 - Math.PI;
      if (Math.random() < 0.05) continue;
      const hit = traceRay(azimuthRad, elevRad, occ);
      if (!hit) continue;
      const i3 = count * 3;
      positions[i3] = hit.x; positions[i3 + 1] = hit.y; positions[i3 + 2] = hit.z;
      attributes[i3] = hit.intensity; attributes[i3 + 1] = hit.range; attributes[i3 + 2] = hit.elongation;
      count++;
    }
  }

  return { positions: positions.subarray(0, count * 3), attributes: attributes.subarray(0, count * 3), count };
}

// ── Actor trajectory definitions ──────────────────────────────────

interface ActorDef {
  id: string;
  type: ActorType;
  size: [number, number, number]; // sx, sy, sz
  label: string;
  trackId: number;
  trajectory: (t: number) => { x: number; y: number; heading: number; speed: number };
}

// ── Scenario builders ─────────────────────────────────────────────

function makeBaseTraffic(): ActorDef[] {
  const actors: ActorDef[] = [];
  let tid = 1;

  // === SAME-DIRECTION VEHICLES ===
  // Car ahead in ego lane, slightly faster
  actors.push({
    id: "v_ahead1", type: "vehicle", size: [4.8, 2.1, 1.5], label: "Sedan", trackId: tid++,
    trajectory: (t) => ({ x: 25 + t * 12.5, y: EGO_LANE_Y, heading: 0, speed: 12.5 }),
  });
  // Car in left lane, matching speed
  actors.push({
    id: "v_left1", type: "vehicle", size: [4.5, 2.0, 1.6], label: "Sedan", trackId: tid++,
    trajectory: (t) => ({ x: 10 + t * 11.0, y: LEFT_LANE_Y, heading: 0, speed: 11.0 }),
  });
  // SUV ahead in left lane
  actors.push({
    id: "v_left2", type: "vehicle", size: [5.0, 2.2, 1.9], label: "SUV", trackId: tid++,
    trajectory: (t) => ({ x: 40 + t * 10.5, y: LEFT_LANE_Y, heading: 0, speed: 10.5 }),
  });

  // === ONCOMING TRAFFIC ===
  actors.push({
    id: "v_onc1", type: "vehicle", size: [4.6, 2.0, 1.6], label: "Sedan", trackId: tid++,
    trajectory: (t) => ({ x: 80 - t * 13.0, y: ONCOMING_RIGHT_Y, heading: Math.PI, speed: 13.0 }),
  });
  actors.push({
    id: "v_onc2", type: "vehicle", size: [4.8, 2.1, 1.7], label: "Sedan", trackId: tid++,
    trajectory: (t) => ({ x: 120 - t * 14.0, y: ONCOMING_RIGHT_Y, heading: Math.PI, speed: 14.0 }),
  });
  actors.push({
    id: "v_onc3", type: "vehicle", size: [6.5, 2.5, 3.0], label: "Truck", trackId: tid++,
    trajectory: (t) => ({ x: 160 - t * 11.5, y: ONCOMING_LEFT_Y, heading: Math.PI, speed: 11.5 }),
  });

  // === PARKED VEHICLES (right side) ===
  for (let i = 0; i < 6; i++) {
    const px = 15 + i * 12 + rand(-1, 1);
    actors.push({
      id: `v_park_r${i}`, type: "vehicle",
      size: [rand(4.2, 5.2), rand(1.9, 2.2), rand(1.4, 1.9)],
      label: "Parked", trackId: tid++,
      trajectory: () => ({ x: px, y: PARKING_RIGHT_Y, heading: rand(-0.05, 0.05), speed: 0 }),
    });
  }
  // === PARKED VEHICLES (left side) ===
  for (let i = 0; i < 4; i++) {
    const px = 20 + i * 15 + rand(-1, 1);
    actors.push({
      id: `v_park_l${i}`, type: "vehicle",
      size: [rand(4.2, 5.2), rand(1.9, 2.2), rand(1.4, 1.9)],
      label: "Parked", trackId: tid++,
      trajectory: () => ({ x: px, y: PARKING_LEFT_Y, heading: Math.PI + rand(-0.05, 0.05), speed: 0 }),
    });
  }

  // === PEDESTRIANS on sidewalks ===
  // Walking along right sidewalk
  actors.push({
    id: "p_walk1", type: "pedestrian", size: [0.6, 0.6, 1.75], label: "Pedestrian", trackId: tid++,
    trajectory: (t) => ({ x: 30 + t * 1.4, y: RIGHT_SIDEWALK_Y, heading: 0, speed: 1.4 }),
  });
  actors.push({
    id: "p_walk2", type: "pedestrian", size: [0.6, 0.6, 1.65], label: "Pedestrian", trackId: tid++,
    trajectory: (t) => ({ x: 50 - t * 1.2, y: RIGHT_SIDEWALK_Y + 0.5, heading: Math.PI, speed: 1.2 }),
  });
  // Standing on left sidewalk
  actors.push({
    id: "p_stand1", type: "pedestrian", size: [0.6, 0.6, 1.7], label: "Pedestrian", trackId: tid++,
    trajectory: () => ({ x: 35, y: LEFT_SIDEWALK_Y, heading: -Math.PI / 2, speed: 0 }),
  });
  actors.push({
    id: "p_walk3", type: "pedestrian", size: [0.6, 0.6, 1.8], label: "Pedestrian", trackId: tid++,
    trajectory: (t) => ({ x: 60 + t * 1.3, y: LEFT_SIDEWALK_Y + 0.3, heading: 0, speed: 1.3 }),
  });

  // === CYCLISTS ===
  actors.push({
    id: "c1", type: "cyclist", size: [1.8, 0.7, 1.7], label: "Cyclist", trackId: tid++,
    trajectory: (t) => ({
      x: 8 + t * 6.0,
      y: -(LANE_WIDTH + 0.8), // right edge bike lane
      heading: 0, speed: 6.0,
    }),
  });

  // === SIGNS ===
  actors.push({
    id: "s1", type: "sign", size: [0.1, 0.8, 1.5], label: "Speed Limit", trackId: tid++,
    trajectory: () => ({ x: 28, y: PARKING_RIGHT_Y - 1.5, heading: 0, speed: 0 }),
  });
  actors.push({
    id: "s2", type: "sign", size: [0.1, 0.6, 0.9], label: "Stop Sign", trackId: tid++,
    trajectory: () => ({ x: 70, y: PARKING_RIGHT_Y - 1.5, heading: 0, speed: 0 }),
  });
  actors.push({
    id: "s3", type: "sign", size: [0.1, 0.8, 1.2], label: "Yield", trackId: tid++,
    trajectory: () => ({ x: 50, y: PARKING_LEFT_Y + 1.5, heading: Math.PI, speed: 0 }),
  });

  return actors;
}

// ── Incident-specific actors ──────────────────────────────────────

function makeIncidentActors(scenario: ScenarioId): ActorDef[] {
  const actors: ActorDef[] = [];
  let tid = 100;

  switch (scenario) {
    case "near_miss": {
      // Vehicle in left lane suddenly swerves into ego lane
      actors.push({
        id: "v_nearmiss", type: "vehicle", size: [4.7, 2.0, 1.6], label: "Near-Miss Vehicle", trackId: tid++,
        trajectory: (t) => {
          const swerveStart = 5.0;
          const swerveEnd = 7.0;
          const baseY = LEFT_LANE_Y;
          const targetY = EGO_LANE_Y + 0.3; // almost in ego lane
          let y = baseY;
          if (t > swerveStart && t < swerveEnd) {
            const p = smoothstep((t - swerveStart) / (swerveEnd - swerveStart));
            y = lerp(baseY, targetY, p);
          } else if (t >= swerveEnd && t < swerveEnd + 1.5) {
            const p = smoothstep((t - swerveEnd) / 1.5);
            y = lerp(targetY, baseY, p);
          } else if (t >= swerveEnd + 1.5) {
            y = baseY;
          }
          const headingOffset = t > swerveStart && t < swerveEnd + 1.5
            ? Math.sin((t - swerveStart) / (swerveEnd + 1.5 - swerveStart) * Math.PI) * -0.25
            : 0;
          return { x: 15 + t * 11.0, y, heading: headingOffset, speed: 11.0 };
        },
      });
      break;
    }

    case "rear_end": {
      // Slow vehicle ahead, suddenly brakes hard
      actors.push({
        id: "v_braking", type: "vehicle", size: [4.8, 2.1, 1.7], label: "Braking Vehicle", trackId: tid++,
        trajectory: (t) => {
          const brakeStart = 6.0;
          let speed = 12.0;
          let x: number;
          if (t < brakeStart) {
            x = 20 + t * speed;
          } else {
            const dt = t - brakeStart;
            // Decelerate from 12 to 0 over ~2.4 seconds (5 m/s²)
            speed = Math.max(0, 12.0 - 5.0 * dt);
            const brakeDist = 12.0 * dt - 0.5 * 5.0 * dt * dt;
            x = 20 + brakeStart * 12.0 + Math.max(0, brakeDist);
          }
          return { x, y: EGO_LANE_Y, heading: 0, speed };
        },
      });
      // Brake lights effect — add stopped car after collision
      actors.push({
        id: "v_behind_brake", type: "vehicle", size: [4.5, 2.0, 1.6], label: "Following Car", trackId: tid++,
        trajectory: (t) => ({
          x: -10 + t * EGO_SPEED * 0.95,
          y: EGO_LANE_Y + 0.2,
          heading: 0, speed: EGO_SPEED * 0.95,
        }),
      });
      break;
    }

    case "jaywalker": {
      // Pedestrian suddenly darts across the road from between parked cars
      // Ego at t=4.0 is at x=44, jaywalker at x=55 = 11m ahead
      // Ego reaches x=55 at t=5.0s, giving ~1s of crossing visibility
      actors.push({
        id: "p_jaywalker", type: "pedestrian", size: [0.8, 0.8, 1.75], label: "Jaywalker", trackId: tid++,
        trajectory: (t) => {
          const dartStart = 4.0;
          const dartSpeed = 2.5; // running speed (slightly slower for more tension)
          if (t < dartStart) {
            // Waiting at sidewalk edge behind parked cars on right side
            return { x: 55, y: PARKING_RIGHT_Y + 0.5, heading: Math.PI / 2, speed: 0 };
          }
          const dt = t - dartStart;
          return {
            x: 55 + dt * 0.2, // slight forward drift
            y: PARKING_RIGHT_Y + 0.5 + dt * dartSpeed,
            heading: Math.PI / 2,
            speed: dartSpeed,
          };
        },
      });
      // A second pedestrian (child) following behind — 1 second later
      actors.push({
        id: "p_jaywalker2", type: "pedestrian", size: [0.7, 0.7, 1.65], label: "Child", trackId: tid++,
        trajectory: (t) => {
          const dartStart = 5.0;
          if (t < dartStart) {
            return { x: 55.5, y: PARKING_RIGHT_Y + 0.3, heading: Math.PI / 2, speed: 0 };
          }
          const dt = t - dartStart;
          return {
            x: 55.5 + dt * 0.2,
            y: PARKING_RIGHT_Y + 0.3 + dt * 3.0,
            heading: Math.PI / 2,
            speed: 3.0,
          };
        },
      });
      break;
    }

    case "red_light_runner": {
      // Pedestrian sprints across intersection against the light from the left
      // Ego at t=5.0 is at x=55, runner crosses at x=55
      actors.push({
        id: "p_redlight", type: "pedestrian", size: [0.8, 0.8, 1.80], label: "Red-Light Runner", trackId: tid++,
        trajectory: (t) => {
          const enterTime = 4.5;
          const runSpeed = 5.0; // sprinting across
          if (t < enterTime) {
            // Waiting at far sidewalk, starting from the left side
            return { x: 55, y: LEFT_SIDEWALK_Y, heading: -Math.PI / 2, speed: 0 };
          }
          const dt = t - enterTime;
          return {
            x: 55 + dt * 0.3, // slight forward drift
            y: LEFT_SIDEWALK_Y - dt * runSpeed, // running right (negative y)
            heading: -Math.PI / 2,
            speed: runSpeed,
          };
        },
      });
      // A second pedestrian hesitating at the curb then following
      actors.push({
        id: "p_redlight2", type: "pedestrian", size: [0.7, 0.7, 1.70], label: "Follower", trackId: tid++,
        trajectory: (t) => {
          const enterTime = 5.5; // hesitates 1s longer
          const runSpeed = 4.2;
          if (t < enterTime) {
            return { x: 55.5, y: LEFT_SIDEWALK_Y - 0.5, heading: -Math.PI / 2, speed: 0 };
          }
          const dt = t - enterTime;
          return {
            x: 55.5 + dt * 0.2,
            y: LEFT_SIDEWALK_Y - 0.5 - dt * runSpeed,
            heading: -Math.PI / 2,
            speed: runSpeed,
          };
        },
      });
      // Stopped car at intersection
      actors.push({
        id: "v_stopline", type: "vehicle", size: [4.6, 2.0, 1.5], label: "Stopped Car", trackId: tid++,
        trajectory: (t) => {
          if (t < 4.5) return { x: 50, y: ONCOMING_RIGHT_Y, heading: Math.PI, speed: 5.0 };
          return { x: 50, y: ONCOMING_RIGHT_Y, heading: Math.PI, speed: 0 };
        },
      });
      break;
    }

    case "swerving_vehicle": {
      // Erratic driver weaving between lanes
      actors.push({
        id: "v_swerve", type: "vehicle", size: [4.9, 2.1, 1.7], label: "Swerving Vehicle", trackId: tid++,
        trajectory: (t) => {
          const baseSpeed = 13.0;
          const swerveAmplitude = LANE_WIDTH * 0.8;
          const swerveFreq = 0.4; // Hz
          const y = EGO_LANE_Y + swerveAmplitude * Math.sin(2 * Math.PI * swerveFreq * t);
          const dy = swerveAmplitude * 2 * Math.PI * swerveFreq * Math.cos(2 * Math.PI * swerveFreq * t);
          const heading = Math.atan2(dy, baseSpeed);
          return { x: 20 + t * baseSpeed, y, heading, speed: baseSpeed };
        },
      });
      break;
    }

    case "final_model": {
      // Combined gauntlet: all 5 incidents in 15 seconds with time offsets
      // Each incident's actors are shifted so they appear at the right time/place.
      // Ego x at time t ≈ t * EGO_SPEED (approximately, before maneuvers)

      // ── 1. Near Miss (t≈1.0s, ego at x≈11) ──
      // Vehicle in left lane swerves into ego lane
      actors.push({
        id: "fm_nearmiss", type: "vehicle", size: [4.7, 2.0, 1.6], label: "Near-Miss Vehicle", trackId: tid++,
        trajectory: (t) => {
          const tOff = 1.0; // incident offset
          const xOff = tOff * EGO_SPEED; // ego position at offset
          const swerveStart = tOff;
          const swerveEnd = tOff + 2.0;
          const baseY = LEFT_LANE_Y;
          const targetY = EGO_LANE_Y + 0.3;
          let y = baseY;
          if (t > swerveStart && t < swerveEnd) {
            const p = smoothstep((t - swerveStart) / (swerveEnd - swerveStart));
            y = lerp(baseY, targetY, p);
          } else if (t >= swerveEnd && t < swerveEnd + 1.0) {
            const p = smoothstep((t - swerveEnd) / 1.0);
            y = lerp(targetY, baseY, p);
          }
          const headingOff = t > swerveStart && t < swerveEnd + 1.0
            ? Math.sin((t - swerveStart) / (swerveEnd + 1.0 - swerveStart) * Math.PI) * -0.25 : 0;
          return { x: xOff + 5 + t * 11.0, y, heading: headingOff, speed: 11.0 };
        },
      });

      // ── 2. Rear End (t≈3.5s, ego at x≈38.5) ──
      // Lead vehicle brakes hard
      actors.push({
        id: "fm_braking", type: "vehicle", size: [4.8, 2.1, 1.7], label: "Braking Vehicle", trackId: tid++,
        trajectory: (t) => {
          const xOff = 3.5 * EGO_SPEED;
          const brakeStart = 3.5;
          let speed = 12.0;
          let x: number;
          if (t < brakeStart) {
            x = xOff + 12 + t * speed;
          } else {
            const dt = t - brakeStart;
            speed = Math.max(0, 12.0 - 5.0 * dt);
            const brakeDist = 12.0 * dt - 0.5 * 5.0 * dt * dt;
            x = xOff + 12 + brakeStart * 12.0 + Math.max(0, brakeDist);
          }
          return { x, y: EGO_LANE_Y, heading: 0, speed };
        },
      });

      // ── 3. Jaywalker (t≈6.5s, ego at x≈71.5) ──
      // Pedestrian darts from right side
      const jwXOff = 6.5 * EGO_SPEED + 10; // 10m ahead of ego at t=6.5
      actors.push({
        id: "fm_jaywalker", type: "pedestrian", size: [0.8, 0.8, 1.75], label: "Jaywalker", trackId: tid++,
        trajectory: (t) => {
          const dartStart = 6.5;
          const dartSpeed = 2.5;
          if (t < dartStart) {
            return { x: jwXOff, y: PARKING_RIGHT_Y + 0.5, heading: Math.PI / 2, speed: 0 };
          }
          const dt = t - dartStart;
          return {
            x: jwXOff + dt * 0.2,
            y: PARKING_RIGHT_Y + 0.5 + dt * dartSpeed,
            heading: Math.PI / 2,
            speed: dartSpeed,
          };
        },
      });
      actors.push({
        id: "fm_jaywalker2", type: "pedestrian", size: [0.7, 0.7, 1.65], label: "Child", trackId: tid++,
        trajectory: (t) => {
          const dartStart = 7.2;
          if (t < dartStart) {
            return { x: jwXOff + 0.5, y: PARKING_RIGHT_Y + 0.3, heading: Math.PI / 2, speed: 0 };
          }
          const dt = t - dartStart;
          return {
            x: jwXOff + 0.5 + dt * 0.2,
            y: PARKING_RIGHT_Y + 0.3 + dt * 3.0,
            heading: Math.PI / 2,
            speed: 3.0,
          };
        },
      });

      // ── 4. Red Light Runner (t≈9.0s) ──
      // Pedestrian sprints across intersection
      const rlXOff = 9.0 * EGO_SPEED + 10;
      actors.push({
        id: "fm_redlight", type: "pedestrian", size: [0.8, 0.8, 1.80], label: "Red-Light Runner", trackId: tid++,
        trajectory: (t) => {
          const enterTime = 9.0;
          const runSpeed = 5.0;
          if (t < enterTime) {
            return { x: rlXOff, y: LEFT_SIDEWALK_Y, heading: -Math.PI / 2, speed: 0 };
          }
          const dt = t - enterTime;
          return {
            x: rlXOff + dt * 0.3,
            y: LEFT_SIDEWALK_Y - dt * runSpeed,
            heading: -Math.PI / 2,
            speed: runSpeed,
          };
        },
      });

      // ── 5. Swerving Vehicle (t≈11.5s) ──
      // Erratic driver weaving
      const svXOff = 11.5 * EGO_SPEED;
      actors.push({
        id: "fm_swerve", type: "vehicle", size: [4.9, 2.1, 1.7], label: "Swerving Vehicle", trackId: tid++,
        trajectory: (t) => {
          const baseSpeed = 13.0;
          const swerveAmplitude = LANE_WIDTH * 0.8;
          const swerveFreq = 0.5;
          const y = EGO_LANE_Y + swerveAmplitude * Math.sin(2 * Math.PI * swerveFreq * t);
          const dy = swerveAmplitude * 2 * Math.PI * swerveFreq * Math.cos(2 * Math.PI * swerveFreq * t);
          const heading = Math.atan2(dy, baseSpeed);
          return { x: svXOff + 10 + t * baseSpeed, y, heading, speed: baseSpeed };
        },
      });

      break;
    }

    case "normal":
    default:
      // No additional incident actors
      break;
  }

  return actors;
}

// ── Scenario metadata (for UI) ────────────────────────────────────

export interface IncidentWindow {
  startTime: number;   // seconds
  endTime: number;     // seconds
  peakTime: number;    // most dangerous moment
  description: string; // what's happening
}

export interface ScenarioMeta {
  label: string;
  description: string;
  severity: "none" | "warning" | "critical";
  incident: IncidentWindow | null;
}

export const SCENARIO_INFO: Record<ScenarioId, ScenarioMeta> = {
  normal: {
    label: "Normal Driving",
    description: "Standard city traffic flow",
    severity: "none",
    incident: null,
  },
  near_miss: {
    label: "Near Miss",
    description: "Vehicle swerves into ego lane",
    severity: "warning",
    incident: { startTime: 5.0, endTime: 8.5, peakTime: 6.5, description: "Vehicle swerving into lane" },
  },
  rear_end: {
    label: "Rear-End Risk",
    description: "Vehicle ahead brakes hard",
    severity: "critical",
    incident: { startTime: 6.0, endTime: 10.3, peakTime: 7.5, description: "Hard braking ahead" },
  },
  jaywalker: {
    label: "Jaywalker",
    description: "Pedestrian darts from parked cars",
    severity: "critical",
    incident: { startTime: 4.0, endTime: 8.0, peakTime: 5.0, description: "Pedestrian in roadway" },
  },
  red_light_runner: {
    label: "Red Light Runner",
    description: "Pedestrian sprints across intersection against light",
    severity: "critical",
    incident: { startTime: 4.5, endTime: 8.2, peakTime: 5.5, description: "Pedestrian running red light" },
  },
  swerving_vehicle: {
    label: "Swerving Vehicle",
    description: "Erratic driver weaving between lanes",
    severity: "warning",
    incident: { startTime: 2.0, endTime: 16.0, peakTime: 6.0, description: "Erratic lane changes" },
  },
  final_model: {
    label: "Final Model",
    description: "Trained agent — optimal actions across all incidents",
    severity: "critical",
    incident: { startTime: 1.0, endTime: 14.0, peakTime: 6.5, description: "Multi-incident gauntlet" },
  },
};

/** Ordered list of all built-in scenario IDs */
export const ALL_SCENARIOS: ScenarioId[] = [
  "normal", "near_miss", "rear_end", "jaywalker", "red_light_runner", "swerving_vehicle", "final_model",
];

/** Structured scenario definitions for extensibility (sub-scenarios, dashboard reuse) */
export const SCENARIO_DEFINITIONS = ALL_SCENARIOS.map((id) => ({
  id,
  meta: SCENARIO_INFO[id],
}));

// ── Static world geometry (buildings, curbs, poles, etc.) ─────────
// These are world-fixed objects that the LiDAR ray-tracer will hit,
// giving the visual impression of motion as ego drives through them.
// They appear in the point cloud but NOT in the perception bounding boxes.

interface WorldObject {
  worldX: number;  // world X position (along road)
  worldY: number;  // world Y position (across road)
  sx: number; sy: number; sz: number;
  heading: number;
}

function buildWorldScenery(): WorldObject[] {
  const scenery: WorldObject[] = [];
  const totalDist = (NUM_FRAMES / FPS) * EGO_SPEED + MAX_RANGE + 20;

  // === CURBS (continuous low walls along road edges) ===
  // Right curb
  for (let x = -MAX_RANGE; x < totalDist; x += 2.0) {
    scenery.push({ worldX: x, worldY: -(LANE_WIDTH + ROAD_SHOULDER), sx: 2.0, sy: 0.3, sz: 0.15, heading: 0 });
  }
  // Left curb (before median)
  for (let x = -MAX_RANGE; x < totalDist; x += 2.0) {
    scenery.push({ worldX: x, worldY: LANE_WIDTH + 0.5, sx: 2.0, sy: 0.2, sz: 0.12, heading: 0 });
  }
  // Far left curb
  for (let x = -MAX_RANGE; x < totalDist; x += 2.0) {
    scenery.push({ worldX: x, worldY: ONCOMING_LEFT_Y + LANE_WIDTH / 2 + ROAD_SHOULDER, sx: 2.0, sy: 0.3, sz: 0.15, heading: 0 });
  }

  // === BUILDINGS (right side - tall walls set back from road) ===
  const bldgYRight = -(LANE_WIDTH + ROAD_SHOULDER + 6.0);
  for (let x = -20; x < totalDist; x += rand(12, 22)) {
    const w = rand(8, 18);
    const h = rand(4, 12);
    const d = rand(6, 14);
    scenery.push({ worldX: x + w / 2, worldY: bldgYRight - d / 2, sx: w, sy: d, sz: h, heading: rand(-0.02, 0.02) });
  }

  // === BUILDINGS (left side) ===
  const bldgYLeft = ONCOMING_LEFT_Y + LANE_WIDTH / 2 + ROAD_SHOULDER + 5.0;
  for (let x = -10; x < totalDist; x += rand(14, 25)) {
    const w = rand(10, 20);
    const h = rand(3, 10);
    const d = rand(6, 12);
    scenery.push({ worldX: x + w / 2, worldY: bldgYLeft + d / 2, sx: w, sy: d, sz: h, heading: rand(-0.02, 0.02) });
  }

  // === LIGHT POLES (right side) ===
  for (let x = 5; x < totalDist; x += rand(20, 35)) {
    scenery.push({
      worldX: x, worldY: -(LANE_WIDTH + ROAD_SHOULDER + 1.0),
      sx: 0.25, sy: 0.25, sz: 6.0, heading: 0,
    });
  }
  // === LIGHT POLES (left side) ===
  for (let x = 15; x < totalDist; x += rand(25, 40)) {
    scenery.push({
      worldX: x, worldY: ONCOMING_LEFT_Y + LANE_WIDTH / 2 + ROAD_SHOULDER + 1.0,
      sx: 0.25, sy: 0.25, sz: 6.0, heading: 0,
    });
  }

  // === TREES (irregular spacing, right side) ===
  for (let x = 0; x < totalDist; x += rand(8, 18)) {
    const ty = -(LANE_WIDTH + ROAD_SHOULDER + 3.5);
    // Trunk
    scenery.push({ worldX: x, worldY: ty, sx: 0.35, sy: 0.35, sz: 3.5, heading: 0 });
    // Canopy (elevated box — we store height 7m so cz=3.5 which puts it at the right spot)
    scenery.push({ worldX: x, worldY: ty, sx: 3.0, sy: 3.0, sz: 7.0, heading: rand(0, Math.PI) });
  }

  // === TREES (left side) ===
  for (let x = 10; x < totalDist; x += rand(10, 20)) {
    const ty = bldgYLeft - 2.0;
    scenery.push({ worldX: x, worldY: ty, sx: 0.3, sy: 0.3, sz: 3.0, heading: 0 });
    scenery.push({ worldX: x, worldY: ty, sx: 2.5, sy: 2.5, sz: 6.0, heading: rand(0, Math.PI) });
  }

  // === MEDIAN BARRIERS (low concrete walls in center) ===
  for (let x = -MAX_RANGE; x < totalDist; x += 3.0) {
    scenery.push({
      worldX: x, worldY: LANE_WIDTH + 0.5,
      sx: 3.0, sy: 0.6, sz: 0.8, heading: 0,
    });
  }

  return scenery;
}

// Memoize world scenery so it's only built once
let _cachedScenery: WorldObject[] | null = null;
function getWorldScenery(): WorldObject[] {
  if (!_cachedScenery) _cachedScenery = buildWorldScenery();
  return _cachedScenery;
}

// ── Ego trajectory per scenario ───────────────────────────────────
// Returns { x, y, yaw } in world coordinates for the ego at time t.

interface EgoPose { x: number; y: number; yaw: number; }

/** Build a brake→dwell→resume trajectory for scenarios where ego stops. */
function makeBrakeResumeTrajectory(
  brakeStart: number, decel: number, dwellDuration: number, resumeAccel: number,
): (t: number) => EgoPose {
  const stopTime = EGO_SPEED / decel;
  const brakeDist = EGO_SPEED * stopTime - 0.5 * decel * stopTime * stopTime;
  const stopT = brakeStart + stopTime;
  const resumeStartT = stopT + dwellDuration;
  const resumeTime = EGO_SPEED / resumeAccel;
  const resumeEndT = resumeStartT + resumeTime;
  const stopX = brakeStart * EGO_SPEED + brakeDist;
  const resumeDist = 0.5 * resumeAccel * resumeTime * resumeTime;

  return (t) => {
    if (t <= brakeStart) {
      return { x: t * EGO_SPEED, y: 0, yaw: 0 };
    }
    if (t <= stopT) {
      const dt = t - brakeStart;
      const dist = EGO_SPEED * dt - 0.5 * decel * dt * dt;
      return { x: brakeStart * EGO_SPEED + Math.max(0, dist), y: 0, yaw: 0 };
    }
    if (t <= resumeStartT) {
      return { x: stopX, y: 0, yaw: 0 };
    }
    if (t <= resumeEndT) {
      const dt = t - resumeStartT;
      return { x: stopX + 0.5 * resumeAccel * dt * dt, y: 0, yaw: 0 };
    }
    const dt = t - resumeEndT;
    return { x: stopX + resumeDist + dt * EGO_SPEED, y: 0, yaw: 0 };
  };
}

/** Build a swerve trajectory — ego swerves left or right while mildly braking. */
function makeSwerveTrajectory(
  reactStart: number,
  direction: "left" | "right",
  magnitude: number,
  brakeDecel: number = 3.0,
): (t: number) => EgoPose {
  const reactDuration = 2.5;
  const reactEnd = reactStart + reactDuration;
  const sign = direction === "left" ? 1 : -1;

  return (t) => {
    if (t <= reactStart) {
      return { x: t * EGO_SPEED, y: 0, yaw: 0 };
    }
    if (t < reactEnd) {
      const dt = t - reactStart;
      const p = dt / reactDuration;
      const sp = smoothstep(p);
      // Mild braking during swerve
      const speed = EGO_SPEED - brakeDecel * dt;
      const effectiveSpeed = Math.max(speed, EGO_SPEED * 0.5);
      const x = reactStart * EGO_SPEED + dt * effectiveSpeed;
      // Swerve: sinusoidal lateral offset
      const y = Math.sin(sp * Math.PI) * magnitude * sign;
      const yaw = Math.cos(sp * Math.PI) * 0.12 * sign;
      return { x, y, yaw };
    }
    // After swerve: resume straight at reduced speed then recover
    const reactDist = reactDuration * Math.max(EGO_SPEED - brakeDecel * reactDuration, EGO_SPEED * 0.5);
    const dt = t - reactEnd;
    const recoverySpeed = lerp(EGO_SPEED * 0.7, EGO_SPEED, Math.min(1, dt / 3));
    const x = reactStart * EGO_SPEED + reactDist + dt * recoverySpeed;
    return { x, y: 0, yaw: 0 };
  };
}

function getEgoTrajectory(scenario: ScenarioId, variant: SceneVariant = "ground_truth"): (t: number) => EgoPose {
  // For normal scenario, all variants are identical
  if (scenario === "normal") {
    return (t) => ({ x: t * EGO_SPEED, y: 0, yaw: 0 });
  }

  // Variant-specific trajectories
  if (variant !== "ground_truth") {
    const reactTimes: Record<string, number> = {
      normal: 0, near_miss: 5.5, rear_end: 6.0, jaywalker: 4.0,
      red_light_runner: 4.5, swerving_vehicle: 3.0, final_model: 0,
    };
    const rt = reactTimes[scenario] ?? 0;

    switch (variant) {
      case "avoid_left":
        return makeSwerveTrajectory(rt, "left", 1.8, 3.0);
      case "avoid_right":
        return makeSwerveTrajectory(rt, "right", 1.8, 3.0);
      case "emergency_brake":
        // Hard braking — higher decel than ground truth, earlier reaction
        return makeBrakeResumeTrajectory(rt, 8.5, 2.0, 2.5);
    }
  }

  // Ground truth — worst outcome (no evasion / minimal reaction)
  switch (scenario) {
    case "near_miss":
      // No swerve, no braking — drives straight into danger
      return (t) => ({ x: t * EGO_SPEED, y: 0, yaw: 0 });

    case "rear_end":
      // No braking — drives straight at full speed (pretrained, no intervention)
      return (t) => ({ x: t * EGO_SPEED, y: 0, yaw: 0 });

    case "jaywalker":
      // No reaction — drives straight through
      return (t) => ({ x: t * EGO_SPEED, y: 0, yaw: 0 });

    case "red_light_runner":
      // No braking — enters intersection at full speed
      return (t) => ({ x: t * EGO_SPEED, y: 0, yaw: 0 });

    case "swerving_vehicle":
      // Maintains full speed, no evasion
      return (t) => ({ x: t * EGO_SPEED, y: 0, yaw: 0 });

    case "final_model": {
      // Chained optimal trajectory: swerve, brake, swerve, brake, brake
      // Build sub-trajectories and evaluate the active one at each time t
      const swerveR = makeSwerveTrajectory(1.0, "right", 1.8, 3.0);   // near miss
      const brake1 = makeBrakeResumeTrajectory(3.5, 8.5, 0.8, 3.5);   // rear end
      const swerveL = makeSwerveTrajectory(6.5, "left", 1.8, 3.0);    // jaywalker
      const brake2 = makeBrakeResumeTrajectory(9.0, 8.5, 0.8, 3.5);   // red light
      const brake3 = makeBrakeResumeTrajectory(11.5, 8.5, 0.8, 3.5);  // swerving vehicle

      return (t) => {
        if (t < 1.0) return { x: t * EGO_SPEED, y: 0, yaw: 0 };
        if (t < 3.5) return swerveR(t);
        if (t < 6.5) return brake1(t);
        if (t < 9.0) return swerveL(t);
        if (t < 11.5) return brake2(t);
        return brake3(t);
      };
    }

    default:
      return (t) => ({ x: t * EGO_SPEED, y: 0, yaw: 0 });
  }
}

// ── Public API ─────────────────────────────────────────────────────

const sceneCache = new Map<string, SceneData>();

export function generateSceneData(scenario: ScenarioId = "normal", variant: SceneVariant = "ground_truth"): SceneData {
  const cacheId = `${scenario}__${variant}`;
  const cached = sceneCache.get(cacheId);
  if (cached) return cached;

  const baseActors = makeBaseTraffic();
  const incidentActors = makeIncidentActors(scenario);
  const allActors = [...baseActors, ...incidentActors];
  const worldScenery = getWorldScenery();
  const egoTraj = getEgoTrajectory(scenario, variant);
  // Final model is 15 seconds (150 frames), others are default
  const numFrames = scenario === "final_model" ? 150 : NUM_FRAMES;
  const totalSeconds = numFrames / FPS;
  const frames: FrameData[] = [];

  for (let fi = 0; fi < numFrames; fi++) {
    const t = fi / FPS;

    // Ego position from scenario-aware trajectory
    const ego = egoTraj(t);
    const egoX = ego.x;
    const egoY = ego.y;
    const egoYaw = ego.yaw;

    // Build perception boxes (actors only — these are the labeled detections)
    const boxes: BBox3D[] = [];
    for (const actor of allActors) {
      const pose = actor.trajectory(t);
      const relX = pose.x - egoX;
      const relY = pose.y - egoY;
      if (Math.abs(relX) > MAX_RANGE || Math.abs(relY) > MAX_RANGE) continue;

      boxes.push({
        id: actor.id,
        type: actor.type,
        cx: relX,
        cy: relY,
        cz: actor.size[2] / 2,
        sx: actor.size[0],
        sy: actor.size[1],
        sz: actor.size[2],
        heading: pose.heading - egoYaw,
        speed: pose.speed,
        label: actor.label,
        trackId: actor.trackId,
      });
    }

    // Build LiDAR boxes = perception boxes + world scenery (ego-relative)
    // World scenery is only for LiDAR ray-tracing, NOT shown as detections
    const lidarBoxes: BBox3D[] = [...boxes];
    for (const obj of worldScenery) {
      const relX = obj.worldX - egoX;
      const relY = obj.worldY - egoY;
      if (Math.abs(relX) > MAX_RANGE + 5 || Math.abs(relY) > MAX_RANGE + 5) continue;
      lidarBoxes.push({
        id: "_scenery", type: "vehicle",  // type doesn't matter for LiDAR
        cx: relX, cy: relY, cz: obj.sz / 2,
        sx: obj.sx, sy: obj.sy, sz: obj.sz,
        heading: obj.heading,
        speed: 0, label: "", trackId: -1,
      });
    }

    const lidar = generateLidarFrame(lidarBoxes);

    frames.push({
      timestamp: t,
      egoPosition: [egoX, egoY, 0],
      egoYaw,
      boxes,   // Only perception boxes — no scenery
      pointPositions: lidar.positions,
      pointAttributes: lidar.attributes,
      pointCount: lidar.count,
    });
  }

  const data: SceneData = { frames, fps: FPS, totalSeconds, totalFrames: numFrames };
  sceneCache.set(cacheId, data);
  return data;
}

// ── Custom scenario from AI ───────────────────────────────────────

export interface CustomActorDef {
  type: ActorType;
  label: string;
  size: [number, number, number];
  startX: number;
  startY: number;
  heading: number;
  speed: number;
  // Optional events: time-triggered changes
  events?: Array<{
    time: number;
    speed?: number;
    targetY?: number;
    heading?: number;
  }>;
}

export interface CustomScenarioDef {
  name: string;
  description: string;
  severity: "none" | "warning" | "critical";
  ego: {
    speed: number;
    events?: Array<{
      time: number;
      action: "brake" | "swerve_left" | "swerve_right" | "accelerate" | "stop";
      intensity?: number; // 0-1
    }>;
  };
  actors: CustomActorDef[];
  incident?: {
    startTime: number;
    endTime: number;
    peakTime: number;
    description: string;
  };
}

function customActorToActorDef(actor: CustomActorDef, index: number): ActorDef {
  return {
    id: `custom_${index}`,
    type: actor.type,
    size: actor.size,
    label: actor.label,
    trackId: 200 + index,
    trajectory: (t) => {
      let x = actor.startX + t * actor.speed * Math.cos(actor.heading);
      let y = actor.startY + t * actor.speed * Math.sin(actor.heading);
      let heading = actor.heading;
      let speed = actor.speed;

      if (actor.events) {
        for (const ev of actor.events) {
          if (t >= ev.time) {
            const dt = t - ev.time;
            if (ev.speed !== undefined) speed = ev.speed;
            if (ev.heading !== undefined) heading = ev.heading;
            if (ev.targetY !== undefined) {
              const transitionTime = 2.0;
              const p = Math.min(1, dt / transitionTime);
              y = lerp(actor.startY, ev.targetY, smoothstep(p));
            }
            x = actor.startX + ev.time * actor.speed * Math.cos(actor.heading)
                + dt * speed * Math.cos(heading);
          }
        }
      }

      return { x, y, heading, speed };
    },
  };
}

function buildCustomEgoTrajectory(egoDef: CustomScenarioDef["ego"]): (t: number) => EgoPose {
  const baseSpeed = egoDef.speed || EGO_SPEED;

  return (t) => {
    let speed = baseSpeed;
    let y = 0;
    let yaw = 0;
    let x = 0;

    // Integrate with events
    let lastEventTime = 0;
    let xAccum = 0;
    let currentSpeed = baseSpeed;

    if (egoDef.events) {
      // Sort events by time
      const sorted = [...egoDef.events].sort((a, b) => a.time - b.time);

      for (const ev of sorted) {
        if (t < ev.time) break;

        // Add distance from last event to this event at current speed
        xAccum += (ev.time - lastEventTime) * currentSpeed;
        lastEventTime = ev.time;

        const intensity = ev.intensity ?? 0.8;
        switch (ev.action) {
          case "brake":
            currentSpeed = baseSpeed * (1 - intensity);
            break;
          case "stop":
            currentSpeed = 0;
            break;
          case "accelerate":
            currentSpeed = baseSpeed * (1 + intensity * 0.5);
            break;
          case "swerve_left":
            y = LANE_WIDTH * intensity;
            yaw = 0.1 * intensity;
            break;
          case "swerve_right":
            y = -LANE_WIDTH * intensity;
            yaw = -0.1 * intensity;
            break;
        }
      }

      // Add remaining distance
      x = xAccum + (t - lastEventTime) * currentSpeed;
    } else {
      x = t * baseSpeed;
    }

    return { x, y, yaw };
  };
}

export function generateCustomSceneData(def: CustomScenarioDef): SceneData {
  const cacheKey = `custom_${def.name}_${JSON.stringify(def)}`;
  const cached = sceneCache.get(cacheKey);
  if (cached) return cached;

  const baseActors = makeBaseTraffic();
  const customActors = def.actors.map((a, i) => customActorToActorDef(a, i));
  const allActors = [...baseActors, ...customActors];
  const worldScenery = getWorldScenery();
  const egoTraj = buildCustomEgoTrajectory(def.ego);
  const totalSeconds = NUM_FRAMES / FPS;
  const frames: FrameData[] = [];

  for (let fi = 0; fi < NUM_FRAMES; fi++) {
    const t = fi / FPS;
    const ego = egoTraj(t);
    const egoX = ego.x;
    const egoY = ego.y;
    const egoYaw = ego.yaw;

    const boxes: BBox3D[] = [];
    for (const actor of allActors) {
      const pose = actor.trajectory(t);
      const relX = pose.x - egoX;
      const relY = pose.y - egoY;
      if (Math.abs(relX) > MAX_RANGE || Math.abs(relY) > MAX_RANGE) continue;
      boxes.push({
        id: actor.id, type: actor.type,
        cx: relX, cy: relY, cz: actor.size[2] / 2,
        sx: actor.size[0], sy: actor.size[1], sz: actor.size[2],
        heading: pose.heading - egoYaw,
        speed: pose.speed, label: actor.label, trackId: actor.trackId,
      });
    }

    const lidarBoxes: BBox3D[] = [...boxes];
    for (const obj of worldScenery) {
      const relX = obj.worldX - egoX;
      const relY = obj.worldY - egoY;
      if (Math.abs(relX) > MAX_RANGE + 5 || Math.abs(relY) > MAX_RANGE + 5) continue;
      lidarBoxes.push({
        id: "_scenery", type: "vehicle",
        cx: relX, cy: relY, cz: obj.sz / 2,
        sx: obj.sx, sy: obj.sy, sz: obj.sz,
        heading: obj.heading, speed: 0, label: "", trackId: -1,
      });
    }

    const lidar = generateLidarFrame(lidarBoxes);
    frames.push({
      timestamp: t,
      egoPosition: [egoX, egoY, 0],
      egoYaw,
      boxes,
      pointPositions: lidar.positions,
      pointAttributes: lidar.attributes,
      pointCount: lidar.count,
    });
  }

  const data: SceneData = { frames, fps: FPS, totalSeconds, totalFrames: NUM_FRAMES };
  sceneCache.set(cacheKey, data);
  return data;
}

// ── Color constants ───────────────────────────────────────────────

export const BOX_TYPE_COLORS: Record<ActorType, string> = {
  vehicle: "#FF9E00",
  pedestrian: "#CCFF00",
  cyclist: "#DC143C",
  sign: "#FF44FF",
};

export const HIGHLIGHT_COLOR = "#00E5FF";

export function actorColor(type: ActorType): string {
  return BOX_TYPE_COLORS[type] ?? "#6B7280";
}
