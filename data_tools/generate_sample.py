#!/usr/bin/env python3
"""
generate_sample.py  —  Generate a realistic sample_e2e.json without any
Waymo downloads. Creates synthetic but realistic-looking trajectory moments
based on common urban driving scenarios.

Usage:
  python data_tools/generate_sample.py
  python data_tools/generate_sample.py --count 20 --out sample_e2e.json
"""

import json
import math
import random
import argparse
import os

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--count", type=int, default=15, help="Number of moments")
    p.add_argument("--out", default="data_tools/sample_e2e.json", help="Output path")
    p.add_argument("--seed", type=int, default=42)
    return p.parse_args()

def make_straight_drive(base_x, base_y, base_yaw, speed, n_past=10, n_future=30):
    """Ego driving straight at given speed."""
    past = []
    for i in range(-n_past, 1):
        t = i * 0.1
        dx = speed * t
        past.append({
            "x": round(base_x + dx * math.cos(base_yaw), 3),
            "y": round(base_y + dx * math.sin(base_yaw), 3),
            "yaw": round(base_yaw, 4),
            "t": round(t, 2),
        })
    
    future = []
    for i in range(1, n_future + 1):
        t = i * 0.1
        dx = speed * t
        future.append({
            "x": round(base_x + dx * math.cos(base_yaw), 3),
            "y": round(base_y + dx * math.sin(base_yaw), 3),
            "yaw": round(base_yaw, 4),
            "t": round(t, 2),
        })
    
    return past, future

def make_curve(base_x, base_y, base_yaw, speed, turn_rate, n_past=10, n_future=30):
    """Ego following a curved path."""
    past = []
    x, y, yaw = base_x, base_y, base_yaw
    # Go backwards for past
    positions = []
    for i in range(-n_past, n_future + 1):
        t = i * 0.1
        if i <= 0:
            # Past positions (compute backwards from base)
            dt = i * 0.1
            px = base_x + speed * dt * math.cos(base_yaw + turn_rate * dt * 0.5)
            py = base_y + speed * dt * math.sin(base_yaw + turn_rate * dt * 0.5)
            pyaw = base_yaw + turn_rate * dt
            positions.append((round(px, 3), round(py, 3), round(pyaw, 4), round(t, 2)))
        else:
            # Future
            dt = i * 0.1
            px = base_x + speed * dt * math.cos(base_yaw + turn_rate * dt * 0.5)
            py = base_y + speed * dt * math.sin(base_yaw + turn_rate * dt * 0.5)
            pyaw = base_yaw + turn_rate * dt
            positions.append((round(px, 3), round(py, 3), round(pyaw, 4), round(t, 2)))
    
    past = [{"x": p[0], "y": p[1], "yaw": p[2], "t": p[3]} for p in positions[:n_past + 1]]
    future = [{"x": p[0], "y": p[1], "yaw": p[2], "t": p[3]} for p in positions[n_past + 1:]]
    return past, future

def make_lane_change(base_x, base_y, base_yaw, speed, lane_width=3.5, n_past=10, n_future=30):
    """Ego performing a smooth lane change."""
    past = []
    future = []
    
    for i in range(-n_past, n_future + 1):
        t = i * 0.1
        dx = speed * t
        # Sigmoid lane change starting at t=0
        if t <= 0:
            lateral = 0
        else:
            progress = min(1, t / 2.0)  # 2-second lane change
            lateral = lane_width * (3 * progress**2 - 2 * progress**3)  # smooth step
        
        x = base_x + dx * math.cos(base_yaw) - lateral * math.sin(base_yaw)
        y = base_y + dx * math.sin(base_yaw) + lateral * math.cos(base_yaw)
        yaw = base_yaw + math.atan2(lateral * 0.1, speed * 0.1) if t > 0 and t < 2.0 else base_yaw
        
        pt = {"x": round(x, 3), "y": round(y, 3), "yaw": round(yaw, 4), "t": round(t, 2)}
        if i <= 0:
            past.append(pt)
        else:
            future.append(pt)
    
    return past, future

def perturb_trajectory(gt_future, drift_scale, speed_scale=1.0, noise=0.3):
    """Create a perturbed candidate from ground truth."""
    pts = []
    for i, p in enumerate(gt_future):
        frac = i / max(1, len(gt_future) - 1)
        drift = math.sin(frac * math.pi) * drift_scale
        speed_mod = (speed_scale - 1.0) * frac * 2.0  # accumulates over time
        
        pts.append({
            "x": round(p["x"] + speed_mod * math.cos(p["yaw"]) + random.gauss(0, noise * 0.1), 3),
            "y": round(p["y"] + drift + random.gauss(0, noise * 0.1), 3),
            "yaw": round(p["yaw"] + drift * 0.01, 4),
            "t": p["t"],
        })
    return pts

def make_candidates(gt_future):
    """Generate 3 candidates from ground truth future."""
    # Conservative: close to GT
    safe_pts = perturb_trajectory(gt_future, drift_scale=0.3, noise=0.15)
    safe_score = round(7.5 + random.random() * 2.5, 1)
    
    # Moderate: some drift
    mod_pts = perturb_trajectory(gt_future, drift_scale=2.0 + random.random(), noise=0.3)
    mod_score = round(4.0 + random.random() * 3.0, 1)
    
    # Aggressive: large deviation
    agg_pts = perturb_trajectory(gt_future, drift_scale=4.0 + random.random() * 2, speed_scale=1.1, noise=0.5)
    agg_score = round(1.0 + random.random() * 3.0, 1)
    
    candidates = [
        {"id": 0, "points": safe_pts, "score": safe_score, "label": "Conservative"},
        {"id": 1, "points": mod_pts, "score": mod_score, "label": "Moderate"},
        {"id": 2, "points": agg_pts, "score": agg_score, "label": "Aggressive"},
    ]
    
    scores = [c["score"] for c in candidates]
    best = scores.index(max(scores))
    worst = scores.index(min(scores))
    
    return candidates, best, worst

def generate_moments(count, seed):
    random.seed(seed)
    moments = []
    
    # Define several driving scenarios
    scenarios = [
        # Straight drives at different speeds
        ("straight_fast", lambda bx, by: make_straight_drive(bx, by, 0.0, 15.0)),
        ("straight_slow", lambda bx, by: make_straight_drive(bx, by, 0.0, 8.0)),
        ("straight_angled", lambda bx, by: make_straight_drive(bx, by, 0.3, 12.0)),
        # Curves
        ("curve_left", lambda bx, by: make_curve(bx, by, 0.0, 10.0, 0.15)),
        ("curve_right", lambda bx, by: make_curve(bx, by, 0.0, 10.0, -0.12)),
        ("curve_tight", lambda bx, by: make_curve(bx, by, 0.0, 8.0, 0.25)),
        # Lane changes
        ("lane_change_left", lambda bx, by: make_lane_change(bx, by, 0.0, 12.0, 3.5)),
        ("lane_change_right", lambda bx, by: make_lane_change(bx, by, 0.0, 12.0, -3.5)),
        # Diagonal
        ("diagonal_drive", lambda bx, by: make_straight_drive(bx, by, 0.45, 11.0)),
        ("reverse_angle", lambda bx, by: make_straight_drive(bx, by, -0.2, 9.0)),
    ]
    
    for i in range(count):
        # Pick a scenario and randomize base position
        sc_name, sc_fn = scenarios[i % len(scenarios)]
        base_x = random.uniform(-20, 20)
        base_y = random.uniform(-10, 10)
        
        past, future_gt = sc_fn(base_x, base_y)
        
        if len(future_gt) < 5:
            continue
        
        candidates, best_idx, worst_idx = make_candidates(future_gt)
        
        frame_idx = 10 + i * 20  # spread across frames
        
        moments.append({
            "id": f"sample_{sc_name}_{i:03d}",
            "frameIndex": frame_idx,
            "pastTrajectory": past,
            "candidates": candidates,
            "bestCandidateIndex": best_idx,
            "worstCandidateIndex": worst_idx,
        })
    
    return moments

def main():
    args = parse_args()
    moments = generate_moments(args.count, args.seed)
    
    data = {"moments": moments}
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    
    with open(args.out, "w") as f:
        json.dump(data, f, indent=1)
    
    size_kb = os.path.getsize(args.out) / 1024
    print(f"Done! Generated {len(moments)} moments -> {args.out} ({size_kb:.1f} KB)")

if __name__ == "__main__":
    main()
