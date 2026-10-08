#!/bin/sh
set -eu
: "${XY_DEPLOY_DIR:?Set XY_DEPLOY_DIR to the prepared directory}"
case "$XY_DEPLOY_DIR" in /*) ;; *) echo 'XY_DEPLOY_DIR must be absolute' >&2; exit 1;; esac
[ -f "$XY_DEPLOY_DIR/deployment.json" ] || { echo 'Not a prepared deployment' >&2; exit 1; }
# Never print docker compose config without --quiet; it includes all secrets.
exec docker compose --project-directory "$XY_DEPLOY_DIR" --env-file "$XY_DEPLOY_DIR/.env" -f "$XY_DEPLOY_DIR/compose.json" "$@"
