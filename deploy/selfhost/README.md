# XY-IMAGE self-hosted deployment

Read `../../docs/XY_IMAGE_SELFHOST.md` before running operational commands.

- `prepare.mjs`: verify pinned vendor assets, create a new private deployment directory; never starts containers or overwrites credentials.
- `compose.sh`: explicit deployment-directory wrapper; use `config --quiet` to avoid printing secrets.
- `backup.mjs`: maintenance-window backup; stops writers, includes DB/Storage/secrets, resumes only after completion. Backups need external encryption and an actual restore drill.
- `verify-backup.mjs`: verify required artifacts and SHA-256 checksums.
- `generate-types.mjs`: generate real public/langgraph types via pinned postgres-meta on the private network.
- `nginx.conf.template`: TLS/WS public API boundary, loopback upstreams, no query logging. `prepare.mjs --cdn cloudflare` adds realip rules that trust only Cloudflare edges.
- `vendor/`: upstream Apache-2.0 resources, source commit and file checksums. No real credentials.

Offline checks: `node --test deploy/selfhost/*.test.mjs`. Tests place temporary synthetic credentials under `/workspace/xy-ops/agent03/selfhost/` and remove them afterwards. Run there as paseo; do not use `/tmp` for development artifacts.

Operations automation: read `../../docs/XY_IMAGE_OPERATIONS_AUTOMATION.md`.
`operations.mjs` provides encrypted offsite backups with scoped retention and safe
health/disk/backup webhook checks. `systemd/` contains inactive service/timer
templates; destinations, credentials, maintenance windows and real restore/alert
acceptance must be configured before activation. `operations.example.json` fails
closed until an operator confirms the actual offsite repository.
