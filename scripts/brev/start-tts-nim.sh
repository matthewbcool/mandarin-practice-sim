#!/usr/bin/env bash
set -euo pipefail

MODEL_NAME="${MODEL_NAME:-magpie-tts-multilingual}"
IMAGE="${IMAGE:-nvcr.io/nim/nvidia/magpie-tts-multilingual:latest}"
CONTAINER_NAME="${CONTAINER_NAME:-boba-tts-nim}"
HOST_PORT="${HOST_PORT:-9001}"
CONTAINER_PORT="${CONTAINER_PORT:-9000}"
NIM_CACHE="${NIM_CACHE:-$HOME/.cache/nim}"
ENV_FILE="${ENV_FILE:-$HOME/boba-speech/.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ -z "${NGC_API_KEY:-}" ]]; then
  echo "Missing NGC_API_KEY."
  echo "Create $ENV_FILE on the Brev instance with:"
  echo "  NGC_API_KEY=nvapi-..."
  exit 1
fi

mkdir -p "$NIM_CACHE"

echo "$NGC_API_KEY" | docker login nvcr.io -u '$oauthtoken' --password-stdin

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --gpus all \
  --shm-size=8GB \
  -e NGC_API_KEY="$NGC_API_KEY" \
  -e NIM_MODEL_NAME="$MODEL_NAME" \
  -v "$NIM_CACHE:/opt/nim/.cache" \
  -p "$HOST_PORT:$CONTAINER_PORT" \
  "$IMAGE"

echo "Started $CONTAINER_NAME on host port $HOST_PORT."
echo "Logs: docker logs -f $CONTAINER_NAME"
