/**
 * scenarioAI — Converts natural language into CustomScenarioDef via LLM.
 * Enhanced with detailed physics modeling, multi-actor interactions,
 * and chain-of-thought prompting for significantly better scenarios.
 */

import type { CustomScenarioDef } from "../mockData";

const LS_KEY = "openenv_openai_key";
// Set your key in-app (stored in localStorage) or via a local .env file: VITE_OPENAI_API_KEY=sk-...
const DEFAULT_KEY = import.meta.env.VITE_OPENAI_API_KEY ?? "";

export function getApiKey(): string {
  return localStorage.getItem(LS_KEY) || DEFAULT_KEY;
}

export function setApiKey(key: string) {
  localStorage.setItem(LS_KEY, key);
}

const SYSTEM_PROMPT = `You are an expert autonomous vehicle simulation engineer building scenarios for Overflow, a self-driving perception visualization platform.

Given a natural-language driving scenario, produce ONLY a valid JSON object (no markdown, no explanation).

JSON SCHEMA:
{
  "name": "Short scenario name (3-6 words)",
  "description": "Detailed one-line description of the whole scenario",
  "severity": "none" | "warning" | "critical",
  "ego": {
    "speed": <number, m/s — city=8-14, highway=25-35>,
    "events": [
      {
        "time": <seconds>,
        "action": "brake" | "swerve_left" | "swerve_right" | "accelerate" | "stop",
        "intensity": <0.0 to 1.0>
      }
    ]
  },
  "actors": [
    {
      "type": "vehicle" | "pedestrian" | "cyclist" | "sign",
      "label": "Descriptive label e.g. 'White SUV', 'Delivery Truck', 'Jogger'",
      "size": [length, width, height],
      "startX": <meters ahead of ego at t=0, positive=ahead>,
      "startY": <meters left of ego, negative=right>,
      "heading": <radians: 0=same as ego, PI=oncoming>,
      "speed": <m/s>,
      "events": [
        {
          "time": <seconds>,
          "speed": <new m/s>,
          "heading": <new radians>,
          "targetY": <new lateral position>
        }
      ]
    }
  ],
  "incident": {
    "startTime": <seconds>,
    "endTime": <seconds>,
    "peakTime": <most dangerous moment>,
    "description": "Precise description of what is happening"
  }
}

COORDINATE SYSTEM (Waymo-style, ego-relative at t=0):
- X axis = forward (direction of travel). startX=30 means 30m ahead of ego.
- Y axis = leftward. Positive Y = left of ego. Negative Y = right.
- Standard lane width = 3.7m
- Ego center (its lane) = Y ≈ 0 (mapped to right lane at Y=-1.85 internally)
- Left lane center = Y ≈ 3.7
- Oncoming lanes = Y ≈ 8.4 and Y ≈ 12.1
- Right sidewalk ≈ Y = -7.0
- Left sidewalk ≈ Y = 13.0

VEHICLE SIZES (realistic):
- Sedan: [4.5-4.8, 2.0-2.1, 1.4-1.5]
- SUV: [4.8-5.2, 2.1-2.3, 1.7-1.9]
- Pickup truck: [5.5-6.0, 2.2-2.5, 1.8-2.0]
- Semi truck: [16.0, 2.6, 4.0]
- Delivery van: [6.0, 2.2, 2.8]
- Bus: [12.0, 2.6, 3.2]
- Motorcycle: [2.2, 0.8, 1.3]
- Pedestrian: [0.5-0.7, 0.5-0.7, 1.6-1.85]
- Cyclist: [1.8, 0.7, 1.7]
- Sign/cone: [0.1-0.5, 0.5-0.8, 0.8-2.0]

SPEEDS (m/s):
- City driving: 8-14 (18-31 mph)
- Residential: 5-9 (11-20 mph)
- Highway: 25-35 (56-78 mph)
- Pedestrian walk: 1.2-1.5
- Pedestrian run: 2.5-4.0
- Cyclist: 4-8
- Braking deceleration: 3-8 m/s² (normal=3-4, hard=5-6, emergency=7-8)

CRITICAL RULES:
1. The scene is 19.8 seconds (198 frames at 10fps). Use the FULL duration — spread events across time.
2. Include AT LEAST 6-12 actors for realism: mix of moving traffic, parked cars, pedestrians, cyclists.
3. Place parked cars along both sides (Y ≈ -5.5 right, Y ≈ 11.5 left) every 8-15m.
4. Include oncoming traffic (heading=PI) in opposite lanes (Y ≈ 8.4, 12.1).
5. Include ambient pedestrians on sidewalks and cyclists in bike lanes.
6. The ego MUST react realistically:
   - For sudden obstacles: brake HARD (intensity 0.8-1.0), possibly stop
   - For lane incursions: swerve + moderate brake
   - For rear-end risk: hard brake, check if stopped
   - After stopping/braking, ego should NOT resume full speed immediately
7. Actor events must have CONTINUITY: if a car brakes to 0, it stays at 0 (add another event).
8. If something crosses the road, the crossing takes 3-5 seconds at walking speed.
9. Time-to-collision (TTC) for realistic incidents should be 1-3 seconds.
10. Multiple events per actor are ENCOURAGED for complex behaviors.
11. Include parked cars, signs, and static objects for scene depth.
12. Make the incident UNMISTAKABLE and DRAMATIC — position actors so the collision/near-miss is clearly visible.

EXAMPLE PATTERNS:
- Rear-end: Place vehicle at startX=25 in ego lane, have it brake to 0 at t=5. Ego brakes at t=5.5.
- Jaywalker: Pedestrian at startX=40 on sidewalk, at t=4 changes heading to cross road (heading=PI/2 or -PI/2), speed=2.5.
- Cut-in: Vehicle in left lane, at t=6 targetY shifts to ego lane (Y≈0), heading tilts -0.15 rad.
- Head-on swerve: Oncoming vehicle drifts into ego lane via targetY change.
- Intersection: Cross-traffic at startX=50, startY=30, heading=-PI/2, crosses at high speed.
- Multi-vehicle: Chain reaction where first car brakes, second swerves, ego reacts.

RESPOND WITH ONLY THE JSON. No markdown code blocks, no explanations.`;

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function generateScenario(
  prompt: string,
  onStatus?: (msg: string) => void,
): Promise<{ scenario: CustomScenarioDef | null; error: string | null; raw: string }> {
  onStatus?.("Generating scenario…");

  try {
    // Through the Overflow backend (/api/chat): key stays server-side and the
    // call is captured as a Sentry gen_ai span joined to the browser's trace.
    const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787";
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system: SYSTEM_PROMPT,
        user: `Generate a detailed, complex, and realistic driving scenario based on this description:\n\n"${prompt}"\n\nRemember:\n- Include 8-12 actors minimum (moving traffic, parked cars, pedestrians, cyclists)\n- Make ego reactions physically realistic\n- Use the full 19.8s timeline\n- Make the incident dramatic and easy to spot\n- Include multiple actor events for complex behavior\n- Output ONLY valid JSON`,
        model: "gpt-4o-mini",
        temperature: 0.8,
        maxTokens: 4000,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return { scenario: null, error: `Scenario service error ${res.status}: ${errBody.slice(0, 200)}`, raw: errBody };
    }

    onStatus?.("Parsing response…");

    const data = await res.json();
    const content: string = data.text ?? "";

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    const parsed = JSON.parse(jsonStr) as CustomScenarioDef;

    // Validate basic structure
    if (!parsed.name || !parsed.ego || !Array.isArray(parsed.actors)) {
      return { scenario: null, error: "AI returned invalid scenario structure.", raw: content };
    }

    // Ensure defaults and fix up
    if (!parsed.severity) parsed.severity = "warning";
    if (!parsed.ego.speed) parsed.ego.speed = 11;
    if (!parsed.ego.events) parsed.ego.events = [];

    for (const actor of parsed.actors) {
      if (!actor.size || actor.size.length !== 3) {
        actor.size = actor.type === "vehicle" ? [4.8, 2.1, 1.5]
          : actor.type === "pedestrian" ? [0.6, 0.6, 1.75]
          : actor.type === "cyclist" ? [1.8, 0.7, 1.7]
          : [0.1, 0.8, 1.2];
      }
      if (!actor.events) actor.events = [];
      if (actor.speed === undefined) actor.speed = 0;
      if (actor.heading === undefined) actor.heading = 0;
      if (actor.startX === undefined) actor.startX = 0;
      if (actor.startY === undefined) actor.startY = 0;
    }

    // Validate actor count — warn if too few
    if (parsed.actors.length < 4) {
      console.warn(`[scenarioAI] Only ${parsed.actors.length} actors — may look sparse.`);
    }

    onStatus?.("Scenario ready!");
    return { scenario: parsed, error: null, raw: content };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("JSON")) {
      return { scenario: null, error: `AI returned invalid JSON: ${msg}`, raw: "" };
    }
    return { scenario: null, error: `Error: ${msg}`, raw: "" };
  }
}
