#!/usr/bin/env bash
set -euo pipefail

# An isolated PostgreSQL fixture, not a replacement for staging Supabase checks.
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$script_dir/../../.." && pwd)"
container_name="loomic-xy2api-migration-check-$$"
cleanup() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$container_name" --label loomic.task=xy2api-migration-check \
  --tmpfs /var/lib/postgresql -e POSTGRES_HOST_AUTH_METHOD=trust \
  postgres:18.1-alpine3.23 >/dev/null
# Bootstrap accepts Unix sockets before restarting; wait for final TCP listener.
ready=false
for _ in {1..30}; do
  if docker exec "$container_name" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then echo 'Isolated PostgreSQL did not become ready' >&2; exit 1; fi
sql() { docker exec -i "$container_name" psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1; }
sql < "$script_dir/fixtures/xy2api-migration-bootstrap.sql"
sql < "$script_dir/fixtures/selfhost-runtime-bootstrap.sql"
for _ in 1 2; do
  sql < "$repo_dir/supabase/migrations/20261007000001_xy2api_integration.sql"
  sql < "$repo_dir/supabase/migrations/20261007000002_xy2api_job_write_boundary.sql"
  sql < "$repo_dir/supabase/migrations/20261009000001_user_chat_providers.sql"
  sql < "$repo_dir/supabase/migrations/20261009000002_selfhost_runtime_checks.sql"
  sql < "$repo_dir/supabase/migrations/20261009000003_retired_rpc_permissions.sql"
  sql < "$repo_dir/supabase/migrations/20261009000004_canvases_bucket_lockdown.sql"
done
sql < "$script_dir/fixtures/xy2api-migration-assert.sql"
sql < "$script_dir/fixtures/chat-provider-migration-assert.sql"

sql < "$script_dir/fixtures/selfhost-runtime-assert.sql"
