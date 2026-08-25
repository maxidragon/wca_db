#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Computing best ever ranks (this takes a couple of minutes)..."
cd "$SCRIPT_DIR"
node dist/compute_best_ever_ranks.js
