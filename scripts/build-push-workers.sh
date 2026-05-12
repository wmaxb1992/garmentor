#!/bin/bash
# Build and push all RunPod worker Docker images to GHCR.
#
# Usage:
#   # Login first (one time):
#   echo $GITHUB_TOKEN | docker login ghcr.io -u wmaxb1992 --password-stdin
#
#   # Then build & push:
#   bash scripts/build-push-workers.sh
#
#   # Or build just one:
#   bash scripts/build-push-workers.sh flux-edit

set -euo pipefail
cd "$(dirname "$0")/.."

REGISTRY="ghcr.io/wmaxb1992"

declare -A CONTEXTS=(
  [flux-edit]="runpod/flux-edit"
  [triposr]="runpod/triposr"
  [cloth-sim]="runpod/cloth-sim"
  [garment-gpt]="runpod/garment-gpt"
)

declare -A IMAGE_NAMES=(
  [flux-edit]="garmentor-flux-edit"
  [triposr]="garmentor-3d"
  [cloth-sim]="garmentor-cloth-sim"
  [garment-gpt]="garmentor-pattern"
)

TARGETS="${1:-all}"

for worker in flux-edit triposr cloth-sim garment-gpt; do
  if [ "$TARGETS" != "all" ] && [ "$TARGETS" != "$worker" ]; then
    continue
  fi

  ctx="${CONTEXTS[$worker]}"
  name="${IMAGE_NAMES[$worker]}"
  tag="$REGISTRY/$name:latest"

  echo ""
  echo "════════════════════════════════════════════"
  echo "  Building $worker → $tag"
  echo "  Context: $ctx"
  echo "════════════════════════════════════════════"
  echo ""

  docker build --platform linux/amd64 -t "$tag" "$ctx"
  docker push "$tag"

  echo ""
  echo "  ✅ $name pushed successfully"
done

echo ""
echo "All done! Workers will pick up the new images on next cold start."
echo "To force a restart, scale workers to 0 then back up in the RunPod console."
