# XY-IMAGE self-hosted deployment

Read `../../docs/XY_IMAGE_SELFHOST.md` before running operational commands.

- `prepare.mjs`: verify pinned vendor assets, create a new private deployment directory; never starts containers or overwrites credentials.
- `compose.sh`: explicit deployment-directory wrapper; use `config --quiet` to avoid printing secrets.
- `backup.mjs`: maintenance-window backup; stops writers, includes DB/Storage/secrets, resumes only after completion. Backups need external encryption and an actual restore drill.
- `verify-backup.mjs`: verify required artifacts and SHA-256 checksums.
- `hot-backup.mjs`: daily backup while the site runs (`backup.mjs --hot`), verified, with local daily/weekly retention and `latest.json` for the monitor. Local only until an offsite destination exists.
- `object-storage.mjs`: `status|copy|verify|switch|prune-local` moves Storage's files to an S3-compatible bucket (Cloudflare R2) and back. Copies run inside the storage container with keys on stdin; `switch` verifies before and after and restarts only Storage; `prune-local` deletes only local files whose bucket copy matches. New deployments can start on a bucket with `prepare.mjs --object-storage s3 --s3-credentials <600 file>`. Steps in `docs/XY_IMAGE_SELFHOST.md` (图片搬到 R2).
- `restore-drill.mjs`: restores a backup into a throwaway, network-less database container of the same image and compares table and Storage counts with the live deployment; writes nothing to the deployment.
- `xy2api-route.mjs`: `enable|disable` the `xy2api-route` service, an HAProxy that answers for the main site's hostname inside the deployment network and passes TLS through to the main site over a private WireGuard link, falling back to the public address when the link is down (FINDINGS G7: Cloudflare cuts calls after 125 s). Setup in `docs/XY_IMAGE_SELFHOST.md`.
- `generate-types.mjs`: generate real public/langgraph types via pinned postgres-meta on the private network.
- `nginx.conf.template`: TLS/WS public API boundary, loopback upstreams, no query logging. `prepare.mjs --cdn cloudflare` adds realip rules that trust only Cloudflare edges.
- `nginx.single.conf.template` / `Caddyfile.single.template`: the same boundary on one domain (`prepare.mjs --origin https://… [--web-root /var/www/xy-image]`): static site at `/`, XY API at `/api`, Supabase at `/supabase` with the prefix removed. The Caddy template is the pre-launch server's live config.
- `vendor/`: upstream Apache-2.0 resources, source commit and file checksums. No real credentials.

Offline checks: `node --test deploy/selfhost/*.test.mjs`. Tests place temporary synthetic credentials under `/workspace/xy-ops/agent03/selfhost/` and remove them afterwards. Run there as paseo; do not use `/tmp` for development artifacts.

Operations automation: read `../../docs/XY_IMAGE_OPERATIONS_AUTOMATION.md`.
`operations.mjs` provides encrypted offsite backups with scoped retention and safe
health/disk/backup checks; without `alertFile` the monitor prints `[operations] ALERT`
lines to the journal instead of calling a webhook. `systemd/` contains inactive service/timer
templates; destinations, credentials, maintenance windows and real restore/alert
acceptance must be configured before activation. `operations.example.json` fails
closed until an operator confirms the actual offsite repository.
