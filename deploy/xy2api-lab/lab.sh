#!/usr/bin/env bash
# xy2api contract stack: pinned xy2api release + postgres + redis + mock upstream.
#
#   XY2API_TAG=0.2.5  deploy/xy2api-lab/lab.sh all      # up + seed + record
#   XY2API_TAG=latest deploy/xy2api-lab/lab.sh up|seed|record|version|logs|down
#
# State (generated secrets, seeded accounts, recorded fixtures) lives in
# $XY2API_LAB_DIR (default: $RUNNER_TEMP or ~/.cache, per tag), mode 700/600.
# Nothing secret is printed. Seeding requires XY2API_LAB_ACCEPT_ADMIN_COMPLIANCE=1
# (see seed.mjs) — the operator's explicit opt-in to xy2api's admin terms on
# this throwaway instance.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TAG=${XY2API_TAG:?set XY2API_TAG (e.g. 0.2.5 or latest)}
SLUG=$(printf '%s' "$TAG" | tr -c 'a-zA-Z0-9' '-')
STATE=${XY2API_LAB_DIR:-${RUNNER_TEMP:-$HOME/.cache}/xy2api-lab-$SLUG}
ENV_FILE=$STATE/lab.env
ACCOUNTS=$STATE/accounts.json

log() { printf '[xy2api-lab] %s\n' "$*"; }

ensure_env() {
  mkdir -p "$STATE"
  chmod 700 "$STATE"
  [[ -f $ENV_FILE ]] && return
  (
    umask 077
    cat >"$ENV_FILE" <<EOF
XY2API_LAB_PROJECT=xy2api-contract-$SLUG
XY2API_TAG=$TAG
XY2API_PORT=${XY2API_PORT:-18180}
MOCK_PORT=${MOCK_PORT:-18190}
MOCK_UPSTREAM_KEY=$(openssl rand -hex 24)
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
TOTP_ENCRYPTION_KEY=$(openssl rand -hex 32)
XY2API_ADMIN_EMAIL=contract-admin@xy-lab.test
XY2API_ADMIN_PASSWORD=$(openssl rand -hex 16)
EOF
  )
  log "generated $ENV_FILE"
}

load_env() {
  ensure_env
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  export XY2API_BASE_URL="http://127.0.0.1:${XY2API_PORT}"
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$HERE/compose.yml" -f "$HERE/compose.gateway.yml" "$@"
}

cmd_up() {
  load_env
  log "starting xy2api:$TAG (project $XY2API_LAB_PROJECT, port $XY2API_PORT)"
  compose pull --quiet xy2api
  compose up -d --wait --wait-timeout 300
  log "xy2api version: $(cmd_version)"
}

cmd_version() {
  load_env >/dev/null
  curl -fsS "$XY2API_BASE_URL/api/v1/settings/public" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).data?.version ?? "unknown"))'
}

cmd_seed() {
  load_env
  MOCK_UPSTREAM_BASE_URL=http://mock-upstream:8000 node "$HERE/seed.mjs" --out "$ACCOUNTS"
}

cmd_record() {
  load_env
  local version out
  version=$(cmd_version)
  out=${XY2API_FIXTURES_OUT:-$STATE/fixtures}/$version
  node "$HERE/record-fixtures.mjs" --accounts "$ACCOUNTS" --out-dir "$out"
  log "fixtures: $out"
}

# Container logs (xy2api + mock). Neither logs credentials; the mock logs
# method/path/status only.
cmd_logs() {
  load_env
  compose logs --no-color --tail "${LOGS_TAIL:-200}" "$@"
}

cmd_down() {
  load_env
  compose down -v --remove-orphans
}

case "${1:-}" in
  up) cmd_up ;;
  seed) cmd_seed ;;
  record) cmd_record ;;
  version) cmd_version ;;
  logs) shift && cmd_logs "$@" ;;
  down) cmd_down ;;
  all) cmd_up && cmd_seed && cmd_record ;;
  *)
    echo "usage: XY2API_TAG=<tag> $0 up|seed|record|version|logs|down|all" >&2
    exit 2
    ;;
esac
