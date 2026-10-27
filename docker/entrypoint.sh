#!/bin/sh
set -e
cd /app

case "${1:-serve}" in
  serve)
    bun docker/init.ts &
    INIT=$!
    NODE_ENV=production node site/.output/server/index.mjs &
    SERVER=$!
    trap 'kill -TERM "$INIT" "$SERVER" 2>/dev/null || true' TERM INT
    status=0
    wait "$SERVER" || status=$?
    while kill -0 "$SERVER" 2>/dev/null; do wait "$SERVER" 2>/dev/null || status=$?; done
    kill -TERM "$INIT" 2>/dev/null || true
    wait "$INIT" 2>/dev/null || true
    exit "$status"
    ;;
  backfill) shift; exec bun src/backfill/cli.ts "$@" ;;
  bench)    shift; exec bun src/cli.ts "$@" ;;
  setup)    exec bun src/cli.ts setup ;;
  shell)    exec bash ;;
  *)        exec "$@" ;;
esac
