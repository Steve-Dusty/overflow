#!/usr/bin/env python3
"""
extract_e2e_to_json.py  —  Extract Waymo Motion Dataset scenarios into compact
JSON for the trajectory visualization web app.

Each scenario becomes a "moment" with:
  - past ego trajectory (1 second of history at 10 Hz)
  - 3 candidate future trajectories with synthetic preference scores
  - best/worst candidate indices

Usage:
  python data_tools/extract_e2e_to_json.py \
    --input_glob "data/e2e_raw/*.tfrecord*" \
    --out_json data/e2e_compact/dataset.json \
    --max_moments 200

  # Dry run (just count):
  python data_tools/extract_e2e_to_json.py \
    --input_glob "data/e2e_raw/*.tfrecord*" \
    --dry_run

Dependencies:
  pip install tensorflow waymo-open-dataset-tf-2-12-0 numpy
  (or see requirements.txt)
"""

import argparse
import glob
import json
import os
import sys
import random
import math

def parse_args():
    p = argparse.ArgumentParser(description="Extract Waymo Motion → JSON")
    p.add_argument("--input_glob", required=True, help="Glob for TFRecord files")
    p.add_argument("--out_json", default="data/e2e_compact/dataset.json", help="Output JSON path")
    p.add_argument("--max_moments", type=int, default=200, help="Max moments to extract")
    p.add_argument("--seed", type=int, default=42, help="Random seed")
    p.add_argument("--dry_run", action="store_true", help="Just count scenarios, don't extract")
    p.add_argument("--sample_out", default="data_tools/sample_e2e.json", help="Small sample output")
    p.add_argument("--sample_count", type=int, default=15, help="Moments in sample file")
    return p.parse_args()

def check_deps():
    """Check that required packages are installed."""
    missing = []
    try:
        import tensorflow  # noqa: F401
    except ImportError:
        missing.append("tensorflow")
    try:
        from waymo_open_dataset.protos import scenario_pb2  # noqa: F401
    except ImportError:
        missing.append("waymo-open-dataset-tf-2-12-0")
    
    if missing:
        print("❌ Missing dependencies:")
        for m in missing:
            print(f"   pip install {m}")
        print()
        print("Full install:")
        print("   pip install -r data_tools/requirements_extractor.txt")
        sys.exit(1)

def extract_moments(files, max_moments, seed):
    """Extract trajectory moments from TFRecord files."""
    import tensorflow as tf
    from waymo_open_dataset.protos import scenario_pb2
    
    random.seed(seed)
    moments = []
    scenario_count = 0
    
    for fpath in sorted(files):
        print(f"  📂 Processing: {os.path.basename(fpath)}")
        dataset = tf.data.TFRecordDataset(fpath, compression_type='')
        
        for record in dataset:
            scenario = scenario_pb2.Scenario()
            scenario.ParseFromString(record.numpy())
            scenario_count += 1
            
            if len(moments) >= max_moments:
                break
            
            # Find the SDC (self-driving car) track
            sdc_idx = scenario.sdc_track_index
            if sdc_idx >= len(scenario.tracks):
                continue
            
            sdc_track = scenario.tracks[sdc_idx]
            states = sdc_track.states
            
            # Need at least 20 timesteps (2 seconds) for meaningful data
            if len(states) < 30:
                continue
            
            # Current timestep is at index scenario.current_time_index (usually 10)
            current_t = scenario.current_time_index if scenario.current_time_index > 0 else 10
            
            # Extract past trajectory (up to 1 second = 10 steps before current)
            past_start = max(0, current_t - 10)
            past = []
            for i in range(past_start, current_t + 1):
                if i >= len(states) or not states[i].valid:
                    continue
                s = states[i]
                past.append({
                    "x": round(float(s.center_x), 3),
                    "y": round(float(s.center_y), 3),
                    "yaw": round(float(s.heading), 4),
                    "t": round((i - current_t) * 0.1, 2),  # negative for past
                })
            
            if len(past) < 3:
                continue
            
            # Extract ground truth future (up to 3 seconds = 30 steps)
            future_end = min(len(states), current_t + 31)
            future_gt = []
            for i in range(current_t + 1, future_end):
                if i >= len(states) or not states[i].valid:
                    continue
                s = states[i]
                future_gt.append({
                    "x": round(float(s.center_x), 3),
                    "y": round(float(s.center_y), 3),
                    "yaw": round(float(s.heading), 4),
                    "t": round((i - current_t) * 0.1, 2),
                })
            
            if len(future_gt) < 5:
                continue
            
            # Generate 3 candidate trajectories with different characteristics
            candidates = _make_candidates(past, future_gt, current_t)
            
            # Find best/worst
            scores = [c["score"] for c in candidates]
            best_idx = scores.index(max(scores))
            worst_idx = scores.index(min(scores))
            
            moments.append({
                "id": f"sc_{scenario.scenario_id}_{current_t}",
                "frameIndex": current_t,
                "pastTrajectory": past,
                "candidates": candidates,
                "bestCandidateIndex": best_idx,
                "worstCandidateIndex": worst_idx,
            })
        
        if len(moments) >= max_moments:
            break
    
    print(f"  📊 Processed {scenario_count} scenarios → {len(moments)} moments")
    return moments

def _make_candidates(past, future_gt, current_t):
    """Create 3 candidate trajectories with different risk levels."""
    
    # Candidate 0: Conservative — close to ground truth
    safe_pts = []
    for i, p in enumerate(future_gt):
        noise = math.sin(i * 0.15) * 0.3
        safe_pts.append({
            "x": round(p["x"] + noise * 0.1, 3),
            "y": round(p["y"] + noise, 3),
            "yaw": round(p["yaw"], 4),
            "t": p["t"],
        })
    safe_score = round(7.5 + random.random() * 2.5, 1)
    
    # Candidate 1: Moderate — some lateral drift
    mod_pts = []
    for i, p in enumerate(future_gt):
        frac = i / max(1, len(future_gt) - 1)
        drift = math.sin(frac * math.pi) * 2.0
        mod_pts.append({
            "x": round(p["x"] + math.sin(i * 0.08) * 0.5, 3),
            "y": round(p["y"] + drift, 3),
            "yaw": round(p["yaw"] + drift * 0.02, 4),
            "t": p["t"],
        })
    mod_score = round(4.0 + random.random() * 3.0, 1)
    
    # Candidate 2: Aggressive — large deviation
    agg_pts = []
    for i, p in enumerate(future_gt):
        frac = i / max(1, len(future_gt) - 1)
        drift = math.sin(frac * math.pi * 1.5) * 4.5
        agg_pts.append({
            "x": round(p["x"] * 1.08 + math.cos(i * 0.12), 3),
            "y": round(p["y"] + drift, 3),
            "yaw": round(p["yaw"] + drift * 0.04, 4),
            "t": p["t"],
        })
    agg_score = round(1.0 + random.random() * 3.0, 1)
    
    return [
        {"id": 0, "points": safe_pts, "score": safe_score, "label": "Conservative"},
        {"id": 1, "points": mod_pts, "score": mod_score, "label": "Moderate"},
        {"id": 2, "points": agg_pts, "score": agg_score, "label": "Aggressive"},
    ]

def main():
    args = parse_args()
    
    # Find files
    files = sorted(glob.glob(args.input_glob))
    if not files:
        print(f"❌ No files matching: {args.input_glob}")
        print()
        print("Download data first:")
        print("  bash data_tools/download_e2e_subset.sh --out_dir data/e2e_raw --num_shards 1")
        sys.exit(1)
    
    print(f"📂 Found {len(files)} file(s)")
    for f in files[:5]:
        print(f"   {os.path.basename(f)}")
    if len(files) > 5:
        print(f"   ... and {len(files) - 5} more")
    print()
    
    if args.dry_run:
        print("🔍 Dry run — counting scenarios ...")
        check_deps()
        import tensorflow as tf
        count = 0
        for fpath in files:
            dataset = tf.data.TFRecordDataset(fpath, compression_type='')
            for _ in dataset:
                count += 1
        print(f"  📊 Total scenarios: {count}")
        return
    
    check_deps()
    
    print(f"🔄 Extracting up to {args.max_moments} moments ...")
    moments = extract_moments(files, args.max_moments, args.seed)
    
    if not moments:
        print("❌ No valid moments extracted")
        sys.exit(1)
    
    # Write full dataset
    os.makedirs(os.path.dirname(args.out_json), exist_ok=True)
    with open(args.out_json, "w") as f:
        json.dump({"moments": moments}, f, indent=1)
    size_kb = os.path.getsize(args.out_json) / 1024
    print(f"✅ Wrote {len(moments)} moments to {args.out_json} ({size_kb:.0f} KB)")
    
    # Write small sample
    sample = {"moments": moments[:args.sample_count]}
    os.makedirs(os.path.dirname(args.sample_out), exist_ok=True)
    with open(args.sample_out, "w") as f:
        json.dump(sample, f, indent=1)
    print(f"✅ Wrote {len(sample['moments'])} sample moments to {args.sample_out}")

if __name__ == "__main__":
    main()
