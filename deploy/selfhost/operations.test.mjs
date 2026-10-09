import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  atomicJson,
  loadConfig,
  monitor,
  quietRun,
  scheduledBackup,
} from "./operations.mjs";
import { createTestDirectory } from "./test-sandbox.mjs";
const id = "a".repeat(64);
const fixedNow = () => new Date("2026-10-09T03:00:00Z");
async function setup() {
  const root = await createTestDirectory("operations-");
  const config = {
    deployDir: path.join(root, "deployment"),
    backupRoot: path.join(root, "backups"),
    stateDir: path.join(root, "state"),
    resticEnvFile: path.join(root, "restic.env"),
    alertFile: path.join(root, "alert.json"),
    host: "test-host",
    tag: "test-complete",
    offsiteConfirmed: true,
    keepDaily: 7,
    keepWeekly: 4,
    keepMonthly: 6,
    maxBackupAgeHours: 30,
    minFreeGiB: 1,
    reminderMinutes: 60,
    readyUrl: "http://127.0.0.1:3101/api/ready",
    requiredServices: ["db", "xy-api", "xy-worker"],
  };
  for (const name of [config.deployDir, config.backupRoot, config.stateDir])
    await mkdir(name, { mode: 0o700 });
  await writeFile(path.join(config.deployDir, "deployment.json"), "{}", {
    mode: 0o600,
  });
  await writeFile(
    path.join(root, "password"),
    "synthetic-repository-password",
    { mode: 0o600 },
  );
  await writeFile(
    config.resticEnvFile,
    `RESTIC_REPOSITORY=s3:https://storage.example.invalid/private\nRESTIC_PASSWORD_FILE=${path.join(root, "password")}\nAWS_SECRET_ACCESS_KEY=synthetic-storage-secret\n`,
    { mode: 0o600 },
  );
  await writeFile(
    config.alertFile,
    JSON.stringify({
      url: "https://alerts.example.invalid/secret-path",
      bearerToken: "synthetic-webhook-secret",
    }),
    { mode: 0o600 },
  );
  const configFile = path.join(root, "operations.json");
  await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
  return { root, config, configFile };
}
function runner(config, calls, failAt) {
  return async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === process.execPath && args[0].endsWith("/backup.mjs")) {
      const output = args.at(-1);
      await mkdir(output, { mode: 0o700 });
      await writeFile(
        path.join(output, "private.dump"),
        "synthetic-sensitive-dump",
      );
    }
    if (command === "restic" && args[0] === failAt)
      throw new Error("synthetic-sensitive-command-error");
    if (command === "restic" && args[0] === "backup")
      return JSON.stringify({ message_type: "summary", snapshot_id: id });
    if (command === "restic" && args[0] === "snapshots")
      return JSON.stringify(
        args.includes(id)
          ? [{ id, hostname: config.host, tags: [config.tag] }]
          : [],
      );
    return "";
  };
}
test("scheduled backup verifies encrypted snapshot before scoped retention and local cleanup", async () => {
  const { root, config } = await setup();
  try {
    const calls = [];
    await scheduledBackup(config, {
      now: fixedNow,
      run: runner(config, calls),
    });
    for (const call of calls.filter((item) => item.command === "restic")) {
      assert.equal(
        call.options.env.TMPDIR,
        path.join(config.stateDir, "restic-tmp"),
      );
      assert.equal(
        call.options.env.RESTIC_CACHE_DIR,
        path.join(config.stateDir, "restic-cache"),
      );
    }
    for (const name of ["restic-tmp", "restic-cache"])
      assert.equal(
        (await lstat(path.join(config.stateDir, name))).mode & 0o777,
        0o700,
      );
    const backupCall = calls.find(
      (call) =>
        call.command === process.execPath &&
        call.args[0].endsWith("/backup.mjs"),
    );
    await assert.rejects(
      readFile(path.join(backupCall.args.at(-1), "private.dump")),
      { code: "ENOENT" },
    );
    const retention = calls.find(
      (call) => call.command === "restic" && call.args[0] === "forget",
    );
    assert.deepEqual(retention.args, [
      "forget",
      "--host",
      "test-host",
      "--tag",
      "test-complete",
      "--group-by",
      "host,tags",
      "--keep-daily",
      "7",
      "--keep-weekly",
      "4",
      "--keep-monthly",
      "6",
      "--prune",
    ]);
    assert.ok(
      calls.findIndex((call) => call.args[0] === "check") <
        calls.indexOf(retention),
    );
    assert.equal(
      JSON.parse(
        await readFile(path.join(config.stateDir, "backup.json"), "utf8"),
      ).snapshotId,
      id,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("failed encrypted upload preserves local backup and previous success without retention", async () => {
  const { root, config } = await setup();
  try {
    await atomicJson(path.join(config.stateDir, "backup.json"), {
      lastSuccessAt: "2026-10-08T03:00:00Z",
      status: "ok",
    });
    const calls = [];
    await assert.rejects(
      scheduledBackup(config, {
        now: fixedNow,
        run: runner(config, calls, "backup"),
      }),
      /backup_failed_encrypted_upload/,
    );
    assert.ok(!calls.some((call) => call.args[0] === "forget"));
    const local = calls
      .find(
        (call) =>
          call.command === process.execPath &&
          call.args[0].endsWith("/backup.mjs"),
      )
      .args.at(-1);
    assert.equal(
      await readFile(path.join(local, "private.dump"), "utf8"),
      "synthetic-sensitive-dump",
    );
    const state = await readFile(
      path.join(config.stateDir, "backup.json"),
      "utf8",
    );
    assert.equal(JSON.parse(state).lastSuccessAt, "2026-10-08T03:00:00Z");
    assert.ok(!state.includes("synthetic-sensitive"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("unavailable repository fails before maintenance and existing automation lock blocks overlap", async () => {
  const { root, config } = await setup();
  try {
    const calls = [];
    await assert.rejects(
      scheduledBackup(config, { run: runner(config, calls, "snapshots") }),
      /backup_failed_preflight/,
    );
    assert.equal(calls.length, 1);
    await mkdir(path.join(config.deployDir, ".xy-automation.lock"));
    await assert.rejects(
      scheduledBackup(config, { run: runner(config, calls) }),
      /Operation lock unavailable/,
    );
    assert.equal(calls.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("configuration requires private files and explicit offsite confirmation", async () => {
  const { root, config, configFile } = await setup();
  try {
    assert.equal((await loadConfig(configFile)).tag, config.tag);
    await chmod(configFile, 0o644);
    await assert.rejects(loadConfig(configFile), /private_file_permissions/);
    await chmod(configFile, 0o600);
    await writeFile(
      configFile,
      JSON.stringify({ ...config, offsiteConfirmed: false }),
    );
    await assert.rejects(loadConfig(configFile), /offsite_not_confirmed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("monitor alerts on backup, disk and worker health then deduplicates and reports recovery", async () => {
  const { root, config } = await setup();
  try {
    let healthy = false;
    const events = [];
    const dependencies = {
      now: fixedNow,
      statfs: async () => ({ bavail: healthy ? 1024 ** 3 : 1, bsize: 4096 }),
      run: async (_command, args) => {
        assert.ok(!args.includes("restart"));
        if (args.includes("psql")) return "0|0\n";
        return JSON.stringify(
          config.requiredServices.map((Service) => ({
            Service,
            State: "running",
            Health:
              !healthy && Service === "xy-worker" ? "unhealthy" : "healthy",
          })),
        );
      },
      fetch: async (url, options) => {
        if (String(url).startsWith("https:")) {
          events.push(JSON.parse(options.body));
          assert.equal(options.redirect, "error");
        }
        return new Response(null, { status: 200 });
      },
    };
    const failed = await monitor(config, dependencies);
    assert.deepEqual(failed.problems, [
      "backup_stale",
      "disk_low_backup",
      "disk_low_deployment",
      "service_unhealthy_xy-worker",
    ]);
    assert.equal(events.length, 1);
    await monitor(config, dependencies);
    assert.equal(events.length, 1);
    healthy = true;
    await atomicJson(path.join(config.stateDir, "backup.json"), {
      lastSuccessAt: fixedNow().toISOString(),
      status: "ok",
    });
    assert.equal((await monitor(config, dependencies)).status, "ok");
    assert.equal(events.at(-1).status, "resolved");
    assert.ok(!JSON.stringify(events).includes("synthetic-"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("monitor alerts on paid work that needs a person, by count only", async () => {
  const { root, config } = await setup();
  try {
    await atomicJson(path.join(config.stateDir, "backup.json"), {
      lastSuccessAt: fixedNow().toISOString(),
      status: "ok",
    });
    let counts = "2|3\n";
    const queries = [];
    const events = [];
    const dependencies = {
      now: fixedNow,
      statfs: async () => ({ bavail: 1024 ** 3, bsize: 4096 }),
      run: async (_command, args) => {
        if (args.includes("psql")) {
          queries.push(args.at(-1));
          if (counts instanceof Error) throw counts;
          return counts;
        }
        return JSON.stringify(
          config.requiredServices.map((Service) => ({
            Service,
            State: "running",
            Health: "healthy",
          })),
        );
      },
      fetch: async (url, options) => {
        if (String(url).startsWith("https:"))
          events.push(JSON.parse(options.body));
        return new Response(null, { status: 200 });
      },
    };
    assert.deepEqual((await monitor(config, dependencies)).problems, [
      "billing_unknown_stale",
      "images_held_for_recovery",
    ]);
    // The 待核对 threshold defaults to 30 hours (the reconciler settles in 24).
    assert.match(queries[0], /interval '30 hours'/);
    assert.match(queries[0], /j\.status = 'dead_letter'/);
    counts = "garbage";
    assert.deepEqual((await monitor(config, dependencies)).problems, [
      "billing_check_unknown",
    ]);
    counts = new Error("synthetic-sensitive-psql-error");
    assert.deepEqual((await monitor(config, dependencies)).problems, [
      "billing_check_unknown",
    ]);
    counts = "0|0\n";
    assert.equal((await monitor(config, dependencies)).status, "ok");
    assert.equal(events.at(-1).status, "resolved");
    assert.ok(!JSON.stringify(events).includes("synthetic-"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("failed webhook delivery does not mark alert sent and retries at next monitor run", async () => {
  const { root, config } = await setup();
  try {
    let attempts = 0;
    const dependencies = {
      now: fixedNow,
      statfs: async () => ({ bavail: 1024 ** 3, bsize: 4096 }),
      run: async (_command, args) =>
        args.includes("psql")
          ? "0|0\n"
          : JSON.stringify(
              config.requiredServices.map((Service) => ({
                Service,
                State: "running",
                Health: "healthy",
              })),
            ),
      fetch: async (url) => {
        if (String(url).startsWith("https:")) {
          attempts += 1;
          return new Response(null, { status: 503 });
        }
        return new Response(null, { status: 200 });
      },
    };
    await assert.rejects(
      monitor(config, dependencies),
      /alert_delivery_failed/,
    );
    await assert.rejects(
      monitor(config, dependencies),
      /alert_delivery_failed/,
    );
    assert.equal(attempts, 2);
    await assert.rejects(readFile(path.join(config.stateDir, "monitor.json")), {
      code: "ENOENT",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("subprocess JSON summary capture tolerates long progress without logging secrets", async () => {
  const output = await quietRun(
    process.execPath,
    [
      "-e",
      `for(let i=0;i<30000;i++)process.stdout.write(JSON.stringify({message_type:"status",current_files:["synthetic-sensitive-path"],bytes_done:i})+"\\n");process.stdout.write(JSON.stringify({message_type:"summary",snapshot_id:"${id}"}));`,
    ],
    { summaryOnly: true },
  );
  assert.equal(JSON.parse(output).snapshot_id, id);
  assert.ok(!output.includes("synthetic-sensitive"));
  await assert.rejects(
    quietRun(process.execPath, [
      "-e",
      'process.stderr.write("synthetic-sensitive-credential");process.exit(3)',
    ]),
    (error) => error.message === "command_failed",
  );
});

test("restic rejects symlink or broadly readable cache and temporary directories before invoking commands", async () => {
  for (const name of ["restic-tmp", "restic-cache"]) {
    const { root, config } = await setup();
    try {
      const target = path.join(root, "outside-state");
      await mkdir(target, { mode: 0o700 });
      const directory = path.join(config.stateDir, name);
      await symlink(target, directory);
      const calls = [];
      await assert.rejects(
        scheduledBackup(config, { run: runner(config, calls) }),
        /backup_failed_preflight/,
      );
      assert.equal(calls.length, 0);
      await rm(directory);
      await mkdir(directory, { mode: 0o755 });
      await assert.rejects(
        scheduledBackup(config, { run: runner(config, calls) }),
        /backup_failed_preflight/,
      );
      assert.equal(calls.length, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
