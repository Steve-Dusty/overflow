#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# download_e2e_subset.sh  —  Download ONE shard of Waymo Motion Dataset v1.2.1
#
# The Motion Dataset contains 9-second trajectory snippets at 10 Hz with
# past + future trajectories for up to 128 objects per scenario. This is the
# dataset used for trajectory prediction / E2E driving comparisons.
#
# Usage:
#   bash data_tools/download_e2e_subset.sh                   # defaults
#   bash data_tools/download_e2e_subset.sh --out_dir my_dir  # custom output
#   bash data_tools/download_e2e_subset.sh --num_shards 3    # more data
#   bash data_tools/download_e2e_subset.sh --list            # just list files
#
# Prerequisites:
#   1. Accept license at https://waymo.com/open/
#   2. Install gcloud SDK: https://cloud.google.com/sdk/docs/install
#   3. gcloud auth login  (with same Google account that accepted license)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Defaults ────────────────────────────────────────────────────────
BUCKET="gs://waymo_open_dataset_motion_v_1_2_1"
SPLIT="validation"           # validation is smaller and sufficient for POC
OUT_DIR="data/e2e_raw"
NUM_SHARDS=1
LIST_ONLY=false

# ── Parse args ──────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out_dir)   OUT_DIR="$2";     shift 2 ;;
    --num_shards) NUM_SHARDS="$2"; shift 2 ;;
    --split)     SPLIT="$2";       shift 2 ;;
    --list)      LIST_ONLY=true;   shift   ;;
    --help|-h)
      echo "Usage: $0 [--out_dir DIR] [--num_shards N] [--split train|validation|test] [--list]"
      exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

SRC="${BUCKET}/${SPLIT}"

# ── Check for gsutil / gcloud ───────────────────────────────────────
if command -v gsutil &>/dev/null; then
  COPY_CMD="gsutil -m cp"
  LIST_CMD="gsutil ls"
elif command -v gcloud &>/dev/null; then
  COPY_CMD="gcloud storage cp"
  LIST_CMD="gcloud storage ls"
else
  echo "❌  Neither gsutil nor gcloud found."
  echo ""
  echo "Install the Google Cloud SDK:"
  echo "  https://cloud.google.com/sdk/docs/install"
  echo ""
  echo "Then run:"
  echo "  gcloud auth login"
  echo "  gcloud components install gsutil   (if needed)"
  exit 1
fi

# ── List available files ────────────────────────────────────────────
echo "📂  Listing files in ${SRC} ..."
FILES=$($LIST_CMD "${SRC}/" 2>/dev/null | head -20)

if [ -z "$FILES" ]; then
  echo "❌  No files found. Make sure you have accepted the Waymo license."
  echo "    Visit: https://waymo.com/open/"
  echo "    Then: gcloud auth login"
  exit 1
fi

echo ""
echo "Available files (first 20):"
echo "$FILES"
echo ""

if $LIST_ONLY; then
  echo "(--list mode, not downloading)"
  exit 0
fi

# ── Download ────────────────────────────────────────────────────────
SELECTED=$(echo "$FILES" | head -"$NUM_SHARDS")
mkdir -p "$OUT_DIR"

echo "⬇️  Downloading $NUM_SHARDS shard(s) to $OUT_DIR ..."
echo ""

for F in $SELECTED; do
  FNAME=$(basename "$F")
  if [ -f "$OUT_DIR/$FNAME" ]; then
    echo "  ✓ Already exists: $FNAME"
  else
    echo "  ⬇ $FNAME ..."
    $COPY_CMD "$F" "$OUT_DIR/"
  fi
done

echo ""
echo "✅  Done! Downloaded $NUM_SHARDS shard(s) to $OUT_DIR"
echo ""
echo "Next step:"
echo "  python data_tools/extract_e2e_to_json.py \\"
echo "    --input_glob \"$OUT_DIR/*.tfrecord*\" \\"
echo "    --out_json data/e2e_compact/dataset.json \\"
echo "    --max_moments 200"
