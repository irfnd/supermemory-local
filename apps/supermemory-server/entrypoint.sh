#!/bin/sh
set -eu
STORE="$(printf '%s-%sd' "${SUPERMEMORY_EMBEDDING_MODEL:?}" "${SUPERMEMORY_EMBEDDING_DIMENSIONS:?}" | tr -c 'A-Za-z0-9._-' '_')"
export SUPERMEMORY_DATA_DIR="/data/stores/$STORE"
mkdir -p "$SUPERMEMORY_DATA_DIR"
ln -sfn "stores/$STORE" /data/current
exec supermemory-server
