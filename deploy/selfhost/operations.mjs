import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { acquireLock } from "./operation-lock.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const fail = (code) => {
  throw new Error(code);
};
export async function privateFile(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    fail("private_file_permissions");
  return readFile(file, "utf8");
}
export async function quietRun(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { summaryOnly = false, ...spawnOptions } = options;
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...spawnOptions,
    });
    let output = "";
    let lineBuffer = "";
    let overflow = false;
    const consumeLine = (line) => {
      try {
        if (JSON.parse(line).message_type === "summary") output = line;
      } catch {
        return;
      }
    };
    child.stdout.on("data", (chunk) => {
      if (summaryOnly) {
        lineBuffer += chunk;
        let boundary = lineBuffer.indexOf("\n");
        while (boundary !== -1) {
          consumeLine(lineBuffer.slice(0, boundary));
          lineBuffer = lineBuffer.slice(boundary + 1);
          boundary = lineBuffer.indexOf("\n");
        }
        if (lineBuffer.length > 2_000_000) {
          overflow = true;
          child.kill("SIGTERM");
        }
      } else if (output.length + chunk.length > 2_000_000) {
        overflow = true;
        child.kill("SIGTERM");
      } else output += chunk;
    });
    child.stdout.on("end", () => {
      if (summaryOnly && lineBuffer) consumeLine(lineBuffer);
    });
    child.stderr.resume(); // Never expose subprocess URLs, credentials, dump contents or diagnostics.
    child.once("error", () => reject(new Error("command_failed")));
    child.once("close", (code) =>
      code === 0 && !overflow
        ? resolve(output)
        : reject(new Error("command_failed")),
    );
  });
}
export async function atomicJson(file, data) {
  const temporary = `${file}.${process.pid}.new`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, file);
}
async function jsonOrNull(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export async function loadConfig(file) {
  const config = JSON.parse(await privateFile(file));
  for (const key of [
    "deployDir",
    "backupRoot",
    "stateDir",
    "resticEnvFile",
    "alertFile",
  ])
    if (typeof config[key] !== "string" || !path.isAbsolute(config[key]))
      fail("invalid_config_path");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(config.host))
    fail("invalid_host");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(config.tag))
    fail("invalid_tag");
  if (config.offsiteConfirmed !== true) fail("offsite_not_confirmed");
  for (const key of [
    "keepDaily",
    "keepWeekly",
    "keepMonthly",
    "maxBackupAgeHours",
    "minFreeGiB",
    "reminderMinutes",
  ])
    if (!Number.isInteger(config[key]) || config[key] < 1)
      fail("invalid_threshold");
  // Optional; older configs get the default.
  config.billingUnknownHours ??= 30;
  if (
    !Number.isInteger(config.billingUnknownHours) ||
    config.billingUnknownHours < 1
  )
    fail("invalid_threshold");
  if (
    !Array.isArray(config.requiredServices) ||
    config.requiredServices.length === 0 ||
    config.requiredServices.some((v) => !/^[a-z][a-z0-9-]*$/.test(v))
  )
    fail("invalid_services");
  const ready = new URL(config.readyUrl);
  if (
    ready.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(ready.hostname) ||
    ready.username ||
    ready.password ||
    ready.search ||
    ready.hash ||
    ready.pathname !== "/api/ready"
  )
    fail("invalid_ready_url");
  await readFile(path.join(config.deployDir, "deployment.json"));
  for (const dir of [config.stateDir, config.backupRoot]) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const info = await lstat(dir);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0
    )
      fail("private_directory_permissions");
  }
  return config;
}
const composeArgs = (config) => [
  "compose",
  "--project-directory",
  config.deployDir,
  "--env-file",
  path.join(config.deployDir, ".env"),
  "-f",
  path.join(config.deployDir, "compose.json"),
];
async function resticEnvironment(config) {
  const secrets = parseEnv(await privateFile(config.resticEnvFile));
  // Explicit remote backend only. Operator must still establish a separate failure domain.
  if (
    !/^(s3:https:\/\/|sftp:|rest:https:\/\/)/.test(
      secrets.RESTIC_REPOSITORY ?? "",
    )
  )
    fail("remote_repository_required");
  if (!path.isAbsolute(secrets.RESTIC_PASSWORD_FILE ?? ""))
    fail("password_file_required");
  if (!(await privateFile(secrets.RESTIC_PASSWORD_FILE)).trim())
    fail("empty_repository_password");
  if (
    secrets.RESTIC_PASSWORD ||
    secrets.RESTIC_PASSWORD_COMMAND ||
    secrets.RESTIC_INSECURE_NO_PASSWORD
  )
    fail("unsafe_repository_config");
  const allowed = new Set([
    "RESTIC_REPOSITORY",
    "RESTIC_PASSWORD_FILE",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_DEFAULT_REGION",
    "AWS_REGION",
  ]);
  if (Object.keys(secrets).some((key) => !allowed.has(key)))
    fail("unsupported_repository_option");
  const cacheDir = path.join(config.stateDir, "restic-cache");
  const temporaryDir = path.join(config.stateDir, "restic-tmp");
  for (const directory of [cacheDir, temporaryDir]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0
    )
      fail("private_restic_directory_permissions");
  }
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("RESTIC_") && !key.startsWith("AWS_"),
    ),
  );
  return {
    ...env,
    ...secrets,
    RESTIC_CACHE_DIR: cacheDir,
    TMPDIR: temporaryDir,
  };
}
export async function scheduledBackup(config, dependencies = {}) {
  const run = dependencies.run ?? quietRun;
  const now = dependencies.now ?? (() => new Date());
  const release = await acquireLock(config.deployDir, ".xy-automation.lock");
  const stateFile = path.join(config.stateDir, "backup.json");
  let phase = "preflight";
  let previous;
  try {
    previous = await jsonOrNull(stateFile);
    const env = await resticEnvironment(config);
    const restic = (args, options = {}) =>
      run("restic", args, { env, ...options });
    await restic([
      "snapshots",
      "--json",
      "--host",
      config.host,
      "--tag",
      config.tag,
    ]); // Fail before stopping writers if repository/credentials unavailable.
    const output = path.join(
      config.backupRoot,
      `backup-${now().toISOString().replace(/[:.]/g, "-")}`,
    );
    phase = "local_backup";
    await run(process.execPath, [
      path.join(here, "backup.mjs"),
      "--dir",
      config.deployDir,
      "--output",
      output,
    ]);
    phase = "local_verify";
    await run(process.execPath, [path.join(here, "verify-backup.mjs"), output]);
    phase = "encrypted_upload";
    const result = await restic(
      [
        "backup",
        "--json",
        "--host",
        config.host,
        "--tag",
        config.tag,
        "--group-by",
        "host,tags",
        output,
      ],
      { summaryOnly: true },
    );
    const summary = result
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .findLast((row) => row.message_type === "summary");
    if (!/^[a-f0-9]{64}$/.test(summary?.snapshot_id ?? ""))
      fail("snapshot_confirmation_failed");
    phase = "repository_verify";
    const snapshots = JSON.parse(
      await restic(["snapshots", "--json", summary.snapshot_id]),
    );
    if (
      !snapshots.some(
        (row) =>
          row.id === summary.snapshot_id &&
          row.hostname === config.host &&
          row.tags?.includes(config.tag),
      )
    )
      fail("snapshot_confirmation_failed");
    await restic(["check"]); // Metadata consistency. Full restore/read-data drill remains required.
    phase = "retention";
    await restic([
      "forget",
      "--host",
      config.host,
      "--tag",
      config.tag,
      "--group-by",
      "host,tags",
      "--keep-daily",
      String(config.keepDaily),
      "--keep-weekly",
      String(config.keepWeekly),
      "--keep-monthly",
      String(config.keepMonthly),
      "--prune",
    ]);
    phase = "local_cleanup";
    await rm(output, { recursive: true }); // Only this verified upload; never erase failed or older local backups.
    await atomicJson(stateFile, {
      lastSuccessAt: now().toISOString(),
      lastAttemptAt: now().toISOString(),
      status: "ok",
      snapshotId: summary.snapshot_id,
    });
    return { status: "ok" };
  } catch {
    await atomicJson(stateFile, {
      lastSuccessAt: previous?.lastSuccessAt ?? null,
      lastAttemptAt: now().toISOString(),
      status: "failed",
      phase,
    });
    throw new Error(`backup_failed_${phase}`);
  } finally {
    await release();
  }
}
export async function sendAlert(config, event, dependencies = {}) {
  const secret = JSON.parse(await privateFile(config.alertFile));
  const url = new URL(secret.url);
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    fail("invalid_alert_destination");
  const response = await (dependencies.fetch ?? fetch)(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "content-type": "application/json",
      ...(secret.bearerToken
        ? { authorization: `Bearer ${secret.bearerToken}` }
        : {}),
    },
    body: JSON.stringify({ source: "xy-image", host: config.host, ...event }),
  });
  await response.body?.cancel();
  if (!response.ok) fail("alert_delivery_failed");
}
export async function monitor(config, dependencies = {}) {
  const run = dependencies.run ?? quietRun;
  const fetcher = dependencies.fetch ?? fetch;
  const disk = dependencies.statfs ?? statfs;
  const now = dependencies.now ?? (() => new Date());
  const release = await acquireLock(config.stateDir, ".monitor.lock");
  try {
    const problems = [];
    for (const [label, dir] of [
      ["deployment", config.deployDir],
      ["backup", config.backupRoot],
    ]) {
      try {
        const fs = await disk(dir);
        if (
          Number(fs.bavail) * Number(fs.bsize) <
          config.minFreeGiB * 1024 ** 3
        )
          problems.push(`disk_low_${label}`);
      } catch {
        problems.push(`disk_unknown_${label}`);
      }
    }
    const backup = await jsonOrNull(path.join(config.stateDir, "backup.json"));
    const age = now().getTime() - Date.parse(backup?.lastSuccessAt ?? "");
    if (
      !Number.isFinite(age) ||
      age < 0 ||
      age > config.maxBackupAgeHours * 3600_000
    )
      problems.push("backup_stale");
    if (backup?.status === "failed") problems.push("backup_failed");
    try {
      await lstat(path.join(config.deployDir, ".xy-backup-recovery.json"));
      problems.push("backup_recovery_required");
    } catch (error) {
      if (error.code !== "ENOENT") problems.push("backup_recovery_unknown");
    }
    try {
      const text = await run("docker", [
        ...composeArgs(config),
        "ps",
        "--all",
        "--format",
        "json",
      ]);
      const rows = text.trim().startsWith("[")
        ? JSON.parse(text)
        : text.trim().split("\n").filter(Boolean).map(JSON.parse);
      for (const service of config.requiredServices) {
        const row = rows.find((item) => item.Service === service);
        if (
          !row ||
          row.State !== "running" ||
          (row.Health && row.Health !== "healthy")
        )
          problems.push(`service_unhealthy_${service}`);
      }
    } catch {
      problems.push("docker_unavailable");
    }
    // Paid work that needs a person (docs/XY2API_OPERATIONS.md): images whose
    // upload ran out of retries (kept in xy2api_pending_deliveries for manual
    // recovery), and 待核对 jobs the reconciler could not settle in a day (no
    // request id, or it kept failing). Counts only leave the database.
    try {
      const hours = config.billingUnknownHours ?? 30;
      const text = await run("docker", [
        ...composeArgs(config),
        "exec",
        "-T",
        "db",
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-AtX",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `SELECT (SELECT count(*) FROM public.xy2api_pending_deliveries d JOIN public.background_jobs j ON j.id = d.job_id WHERE j.status = 'dead_letter'), (SELECT count(*) FROM public.background_jobs WHERE billing_status = 'unknown' AND updated_at < now() - interval '${Number(hours)} hours')`,
      ]);
      const [held, unknown] = text.trim().split("|").map(Number);
      if (!Number.isInteger(held) || !Number.isInteger(unknown))
        problems.push("billing_check_unknown");
      else {
        if (held > 0) problems.push("images_held_for_recovery");
        if (unknown > 0) problems.push("billing_unknown_stale");
      }
    } catch {
      problems.push("billing_check_unknown");
    }
    try {
      const result = await fetcher(config.readyUrl, {
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
      await result.body?.cancel();
      if (!result.ok) problems.push("api_not_ready");
    } catch {
      problems.push("api_not_ready");
    }
    problems.sort();
    const previous = await jsonOrNull(
      path.join(config.stateDir, "monitor.json"),
    );
    const changed =
      JSON.stringify(previous?.problems ?? []) !== JSON.stringify(problems);
    const reminder =
      problems.length > 0 &&
      (!previous?.lastAlertAt ||
        now().getTime() - Date.parse(previous.lastAlertAt) >=
          config.reminderMinutes * 60_000);
    const notify = changed || reminder;
    if (notify)
      await sendAlert(
        config,
        {
          status: problems.length ? "firing" : "resolved",
          problems,
          observedAt: now().toISOString(),
        },
        dependencies,
      );
    await atomicJson(path.join(config.stateDir, "monitor.json"), {
      checkedAt: now().toISOString(),
      problems,
      lastAlertAt: notify
        ? now().toISOString()
        : (previous?.lastAlertAt ?? null),
    });
    return { status: problems.length ? "unhealthy" : "ok", problems };
  } finally {
    await release();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [command, configFile] = process.argv.slice(2);
    const config = await loadConfig(configFile);
    if (command === "backup") {
      await scheduledBackup(config);
      console.log(
        "[operations] Encrypted backup and scoped retention completed",
      );
    } else if (command === "monitor") {
      const result = await monitor(config);
      console.log(
        `[operations] ${result.status}: ${result.problems.join(",")}`,
      );
      if (result.problems.length) process.exitCode = 1;
    } else if (command === "test-alert") {
      await sendAlert(config, {
        status: "test",
        problems: [],
        observedAt: new Date().toISOString(),
      });
      console.log("[operations] Test alert accepted by destination");
    } else fail("unknown_command");
  } catch {
    console.error(
      "[operations] Operation failed; inspect protected state files and service status locally. No secrets are logged.",
    );
    process.exitCode = 1;
  }
}
