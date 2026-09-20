// @effect-diagnostics nodeBuiltinImport:off - launcher tests exercise the filesystem boundary.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  configuredDatabasePathForBaseDir,
  Launcher,
  readServiceState,
  validateDatabasePathForBaseDir,
  writeServiceState,
} from "./serviceLauncher.ts";
import {
  compareExactServiceVersions,
  decodeServiceState,
  isExactServiceVersion,
  SERVICE_LAUNCHER_PROTOCOL,
  SERVICE_STOP_MARKER_FILE,
} from "./cloud/serviceProtocol.ts";
import {
  initializeNativeStoreAuthority,
  readNativeStoreAuthorityState,
} from "./environment/nativeStoreAuthorityPersistence.ts";
import { nativeStoreAuthorityBaseDirFingerprint } from "./environment/nativeStoreAuthorityPath.ts";

const initializeLauncherAuthority = (
  root: string,
  authorityStateDir: string,
  environmentId: string,
) => {
  NodeFS.chmodSync(NodePath.join(root, "userdata"), 0o700);
  return initializeNativeStoreAuthority(
    authorityStateDir,
    NodePath.join(root, "userdata", "state.sqlite"),
    environmentId,
    nativeStoreAuthorityBaseDirFingerprint(root),
  );
};

const writeDatabase = (databasePath: string, sequence: number) => {
  NodeFS.mkdirSync(NodePath.dirname(databasePath), { recursive: true, mode: 0o700 });
  const database = new NodeSqlite.DatabaseSync(databasePath);
  try {
    database.exec("CREATE TABLE orchestration_events (sequence INTEGER PRIMARY KEY)");
    if (sequence > 0) {
      database.prepare("INSERT INTO orchestration_events (sequence) VALUES (?)").run(sequence);
    }
  } finally {
    database.close();
  }
};

const readDatabaseSequence = (databasePath: string): number => {
  const database = new NodeSqlite.DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = database
      .prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM orchestration_events")
      .get() as { readonly sequence: number };
    return row.sequence;
  } finally {
    database.close();
  }
};

it("accepts only exact semantic versions", () => {
  for (const version of ["0.0.0", "1.2.3", "1.2.3-alpha.1", "1.2.3-0", "1.2.3+001"]) {
    assert.isTrue(isExactServiceVersion(version), version);
  }
  for (const version of ["latest", "01.2.3", "1.2.3-01", "1.2.3-alpha..1", "1.2.3+."]) {
    assert.isFalse(isExactServiceVersion(version), version);
  }
});

it("orders exact semantic versions without treating build metadata as precedence", () => {
  assert.equal(compareExactServiceVersions("1.2.3", "1.2.3"), 0);
  assert.equal(compareExactServiceVersions("1.2.4", "1.2.3"), 1);
  assert.equal(compareExactServiceVersions("2.0.0-alpha.1", "2.0.0-alpha.2"), -1);
  assert.equal(compareExactServiceVersions("2.0.0-alpha.2", "2.0.0-alpha.beta"), -1);
  assert.equal(compareExactServiceVersions("2.0.0-alpha-beta", "2.0.0-alpha-alpha"), 1);
  assert.equal(compareExactServiceVersions("2.0.0", "2.0.0-rc.1"), 1);
  assert.equal(compareExactServiceVersions("2.0.0+one", "2.0.0+two"), 0);
});

it("rejects contradictory service state", () => {
  assert.isUndefined(
    decodeServiceState({
      protocol: SERVICE_LAUNCHER_PROTOCOL,
      activeVersion: "0.0.31",
      update: {
        id: "update-1",
        fromVersion: "0.0.30",
        targetVersion: "0.0.32",
        dbPath: "/tmp/state.sqlite",
        status: "pending",
        phase: "trial-ready",
      },
    }),
  );

  assert.isUndefined(
    decodeServiceState({
      protocol: SERVICE_LAUNCHER_PROTOCOL,
      activeVersion: "1.0.0",
      update: {
        id: "update-3",
        fromVersion: "1.0.0",
        targetVersion: "1.1.0",
        status: "pending",
        phase: "trial-ready",
      },
    }),
  );

  assert.isUndefined(
    decodeServiceState({
      protocol: SERVICE_LAUNCHER_PROTOCOL,
      activeVersion: "1.0.0",
      update: {
        id: "update-2",
        fromVersion: "1.0.0",
        targetVersion: "0.9.0",
        dbPath: "/tmp/state.sqlite",
        status: "pending",
        phase: "trial-ready",
      },
    }),
  );
});

it("rejects persisted update IDs that could escape the backup root", () => {
  assert.isUndefined(
    decodeServiceState({
      protocol: SERVICE_LAUNCHER_PROTOCOL,
      activeVersion: "1.0.0",
      update: {
        id: "../../userdata",
        fromVersion: "1.0.0",
        targetVersion: "1.1.0",
        dbPath: "/tmp/state.sqlite",
        status: "pending",
        phase: "trial-ready",
      },
    }),
  );
});

it("binds service updates to the configured database path", () => {
  const baseDir = "/tmp/t3-service-path-test";
  const configuredPath = configuredDatabasePathForBaseDir(baseDir);
  assert.equal(validateDatabasePathForBaseDir(baseDir, configuredPath), configuredPath);
  assert.throws(
    () => validateDatabasePathForBaseDir(baseDir, "/tmp/alternate-state.sqlite"),
    /configured userdata\/state.sqlite/,
  );
});

it.layer(NodeServices.layer)("service state persistence", (it) => {
  it.effect("durably replaces and strictly reads one state document", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-service-launcher-test-" });
      const statePath = path.join(root, "runtime", "service-state.json");
      const state = {
        protocol: SERVICE_LAUNCHER_PROTOCOL,
        activeVersion: "0.0.31",
      } as const;

      yield* Effect.promise(() => writeServiceState(statePath, state));
      assert.deepEqual(yield* Effect.promise(() => readServiceState(statePath)), state);
    }),
  );

  it.effect("serializes shutdown with launcher recovery", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-service-launcher-stop-" });
      const statePath = path.join(root, "runtime", "service-state.json");
      const versionDir = path.join(root, "runtime", "versions", "1.0.0");
      const entryPath = path.join(versionDir, "node_modules", "t3", "dist", "bin.mjs");
      yield* fs.makeDirectory(path.dirname(entryPath), { recursive: true });
      yield* fs.writeFileString(entryPath, "setInterval(() => {}, 1_000);\n");
      yield* fs.writeFileString(path.join(versionDir, ".install-complete"), "1.0.0\n");
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
        }),
      );

      const launcher = new Launcher(root, yield* Effect.promise(() => readServiceState(statePath)));
      const running = launcher.run();
      const stopping = launcher.stop("SIGTERM");
      // An explicit stop leaves the marker that tells a child shutting down
      // mid-update that no replacement server is coming. It is present as
      // soon as stop() returns its promise, before queued transitions run.
      assert.isTrue(yield* fs.exists(path.join(root, "runtime", SERVICE_STOP_MARKER_FILE)));
      yield* Effect.promise(() => stopping);
      yield* Effect.promise(() => running);
    }),
  );

  it.effect("commits only after the trial reports prepared", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-service-launcher-flow-" });
      const statePath = path.join(root, "runtime", "service-state.json");
      const databasePath = path.join(root, "userdata", "state.sqlite");
      writeDatabase(databasePath, 0);
      // @effect-diagnostics-next-line preferSchemaOverJson:off - embeds a path in fake child source.
      const encodedDatabasePath = JSON.stringify(databasePath);
      const childSource = `
const context = JSON.parse(process.env.T3_SERVICE_LAUNCHER_CONTEXT);
if (context.update?.status === "pending") {
  process.send({ type: "prepared", updateId: context.update.id });
  process.on("message", (message) => {
    if (message.type === "committed") process.exit(0);
  });
} else if (context.update === undefined) {
  process.send({ type: "request-update", targetVersion: "1.1.0", dbPath: ${encodedDatabasePath} });
  setInterval(() => {}, 1_000);
} else {
  process.exit(0);
}
`;
      for (const version of ["1.0.0", "1.1.0"]) {
        const versionDir = path.join(root, "runtime", "versions", version);
        const entryPath = path.join(versionDir, "node_modules", "t3", "dist", "bin.mjs");
        yield* fs.makeDirectory(path.dirname(entryPath), { recursive: true });
        yield* fs.writeFileString(entryPath, childSource);
        yield* fs.writeFileString(path.join(versionDir, ".install-complete"), `${version}\n`);
      }
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
        }),
      );

      const launcher = new Launcher(root, yield* Effect.promise(() => readServiceState(statePath)));
      yield* Effect.promise(() =>
        launcher.run().then(
          () => Promise.reject(new Error("launcher unexpectedly completed")),
          () => Promise.resolve(),
        ),
      );

      const state = yield* Effect.promise(() => readServiceState(statePath));
      assert.equal(state.activeVersion, "1.1.0");
      assert.equal(state.update?.status, "committed");
    }),
  );

  it.effect("rolls back a trial that reports the wrong update ID", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-service-launcher-rollback-" });
      const statePath = path.join(root, "runtime", "service-state.json");
      const databasePath = path.join(root, "userdata", "state.sqlite");
      writeDatabase(databasePath, 0);
      yield* fs.writeFileString(
        path.join(root, "userdata", "environment-id"),
        "environment-unenrolled\n",
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off - embeds a path in fake child source.
      const encodedDatabasePath = JSON.stringify(databasePath);
      const childSource = `
const context = JSON.parse(process.env.T3_SERVICE_LAUNCHER_CONTEXT);
if (context.update?.status === "pending") {
  process.send({ type: "prepared", updateId: "wrong-update" });
} else if (context.update === undefined) {
  process.send({ type: "request-update", targetVersion: "1.1.0", dbPath: ${encodedDatabasePath} });
  setInterval(() => {}, 1_000);
} else {
  process.exit(0);
}
`;
      for (const version of ["1.0.0", "1.1.0"]) {
        const versionDir = path.join(root, "runtime", "versions", version);
        const entryPath = path.join(versionDir, "node_modules", "t3", "dist", "bin.mjs");
        yield* fs.makeDirectory(path.dirname(entryPath), { recursive: true });
        yield* fs.writeFileString(entryPath, childSource);
        yield* fs.writeFileString(path.join(versionDir, ".install-complete"), `${version}\n`);
      }
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
        }),
      );

      const launcher = new Launcher(root, yield* Effect.promise(() => readServiceState(statePath)));
      yield* Effect.promise(() =>
        launcher.run().then(
          () => Promise.reject(new Error("launcher unexpectedly completed")),
          () => Promise.resolve(),
        ),
      );

      const state = yield* Effect.promise(() => readServiceState(statePath));
      assert.equal(state.activeVersion, "1.0.0");
      assert.equal(state.update?.status, "rolled-back");
      assert.equal(
        state.update?.status === "rolled-back" ? state.update.reason : undefined,
        "invalid-prepared",
      );
    }),
  );

  it.effect("restores the database when a migrating trial exits", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-service-launcher-db-" });
      const statePath = path.join(root, "runtime", "service-state.json");
      const databasePath = path.join(root, "userdata", "state.sqlite");
      const authorityStateDir = path.join(root, "native-store-authority");
      writeDatabase(databasePath, 4);
      yield* fs.writeFileString(
        path.join(root, "userdata", "environment-id"),
        "environment-launcher\n",
      );
      initializeLauncherAuthority(root, authorityStateDir, "environment-launcher");
      // @effect-diagnostics-next-line preferSchemaOverJson:off - embeds a path in fake child source.
      const encodedDatabasePath = JSON.stringify(databasePath);
      const childSource = `
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const context = JSON.parse(process.env.T3_SERVICE_LAUNCHER_CONTEXT);
if (context.update?.status === "pending") {
  const database = new DatabaseSync(context.update.dbPath);
  database.prepare("INSERT INTO orchestration_events (sequence) VALUES (?)").run(5);
  database.close();
  writeFileSync(context.update.dbPath + "-wal", "trial wal");
  writeFileSync(context.update.dbPath + "-shm", "trial shm");
  process.exit(1);
} else if (context.update === undefined) {
  process.send({ type: "request-update", targetVersion: "1.1.0", dbPath: ${encodedDatabasePath} });
  setInterval(() => {}, 1_000);
} else {
  process.exit(0);
}
`;
      for (const version of ["1.0.0", "1.1.0"]) {
        const versionDir = path.join(root, "runtime", "versions", version);
        const entryPath = path.join(versionDir, "node_modules", "t3", "dist", "bin.mjs");
        yield* fs.makeDirectory(path.dirname(entryPath), { recursive: true });
        yield* fs.writeFileString(entryPath, childSource);
        yield* fs.writeFileString(path.join(versionDir, ".install-complete"), `${version}\n`);
      }
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
        }),
      );

      const launcher = new Launcher(
        root,
        yield* Effect.promise(() => readServiceState(statePath)),
        authorityStateDir,
      );
      yield* Effect.promise(() =>
        launcher.run().then(
          () => Promise.reject(new Error("launcher unexpectedly completed")),
          () => Promise.resolve(),
        ),
      );

      const state = yield* Effect.promise(() => readServiceState(statePath));
      assert.equal(state.activeVersion, "1.0.0");
      assert.equal(state.update?.status, "rolled-back");
      assert.equal(readDatabaseSequence(databasePath), 4);
      const authority = readNativeStoreAuthorityState(authorityStateDir);
      assert.equal(authority.state, "active");
      assert.equal(authority.store_generation, 2);
      assert.equal(authority.orchestration_sequence, 4);
      assert.isFalse(yield* fs.exists(`${databasePath}-wal`));
      assert.isFalse(yield* fs.exists(`${databasePath}-shm`));
      const updateId = state.update?.id;
      assert.isDefined(updateId);
      assert.isFalse(yield* fs.exists(path.join(root, "runtime", "db-backup", updateId)));
    }),
  );

  it.effect("fences authority without replacing a missing rollback baseline", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-service-launcher-missing-backup-",
      });
      const statePath = path.join(root, "runtime", "service-state.json");
      const databasePath = path.join(root, "userdata", "state.sqlite");
      writeDatabase(databasePath, 5);
      yield* fs.writeFileString(
        path.join(root, "userdata", "environment-id"),
        "environment-missing-backup\n",
      );
      const authorityStateDir = path.join(root, "native-store-authority");
      initializeLauncherAuthority(root, authorityStateDir, "environment-missing-backup");
      const targetEntry = path.join(
        root,
        "runtime",
        "versions",
        "1.1.0",
        "node_modules",
        "t3",
        "dist",
        "bin.mjs",
      );
      yield* fs.makeDirectory(path.dirname(targetEntry), { recursive: true });
      yield* fs.writeFileString(targetEntry, "process.exit(0);\n");
      yield* fs.writeFileString(
        path.join(root, "runtime", "versions", "1.1.0", ".install-complete"),
        "1.1.0\n",
      );
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
          update: {
            id: "123e4567-e89b-42d3-a456-426614174000",
            fromVersion: "1.0.0",
            targetVersion: "1.1.0",
            dbPath: databasePath,
            status: "pending",
            phase: "trial-ready",
          },
        }),
      );

      const launcher = new Launcher(
        root,
        yield* Effect.promise(() => readServiceState(statePath)),
        authorityStateDir,
      );
      yield* Effect.promise(() =>
        launcher.run().then(
          () => Promise.reject(new Error("launcher unexpectedly completed")),
          () => Promise.resolve(),
        ),
      );

      const authority = readNativeStoreAuthorityState(path.join(root, "native-store-authority"));
      assert.equal(authority.state, "fenced");
      assert.equal(readDatabaseSequence(databasePath), 5);
      assert.equal(
        (yield* Effect.promise(() => readServiceState(statePath))).update?.status,
        "pending",
      );
      assert.isFalse(
        yield* fs.exists(
          path.join(root, "runtime", "db-backup", "123e4567-e89b-42d3-a456-426614174000"),
        ),
      );
    }),
  );

  it.effect("resumes a marked restore before any trial can restart", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-service-launcher-restore-resume-",
      });
      const updateId = "123e4567-e89b-42d3-a456-426614174001";
      const statePath = path.join(root, "runtime", "service-state.json");
      const databasePath = path.join(root, "userdata", "state.sqlite");
      const backupDir = path.join(root, "runtime", "db-backup", updateId);
      writeDatabase(databasePath, 7);
      yield* fs.makeDirectory(backupDir, { recursive: true });
      yield* fs.writeFileString(
        path.join(root, "userdata", "environment-id"),
        "environment-restore-resume\n",
      );
      writeDatabase(path.join(backupDir, "database"), 4);
      yield* fs.writeFileString(path.join(backupDir, ".restore-pending"), "");
      const authorityStateDir = path.join(root, "native-store-authority");
      initializeLauncherAuthority(root, authorityStateDir, "environment-restore-resume");

      const versionDir = path.join(root, "runtime", "versions", "1.0.0");
      const entryPath = path.join(versionDir, "node_modules", "t3", "dist", "bin.mjs");
      yield* fs.makeDirectory(path.dirname(entryPath), { recursive: true });
      yield* fs.writeFileString(entryPath, "process.exit(0);\n");
      yield* fs.writeFileString(path.join(versionDir, ".install-complete"), "1.0.0\n");
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
          update: {
            id: updateId,
            fromVersion: "1.0.0",
            targetVersion: "1.1.0",
            dbPath: databasePath,
            status: "pending",
            phase: "trial-ready",
          },
        }),
      );

      const launcher = new Launcher(
        root,
        yield* Effect.promise(() => readServiceState(statePath)),
        authorityStateDir,
      );
      yield* Effect.promise(() =>
        launcher.run().then(
          () => Promise.reject(new Error("launcher unexpectedly completed")),
          () => Promise.resolve(),
        ),
      );

      const state = yield* Effect.promise(() => readServiceState(statePath));
      assert.equal(state.update?.status, "failed");
      assert.equal(
        state.update?.status === "failed" ? state.update.reason : undefined,
        "rollback-interrupted",
      );
      assert.equal(readDatabaseSequence(databasePath), 4);
      const authority = readNativeStoreAuthorityState(path.join(root, "native-store-authority"));
      assert.equal(authority.store_generation, 2);
      assert.equal(authority.orchestration_sequence, 4);
      assert.isFalse(yield* fs.exists(backupDir));
    }),
  );

  it.effect("rejects a symlinked database before rollback writes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-service-launcher-db-link-" });
      const statePath = path.join(root, "runtime", "service-state.json");
      const databasePath = path.join(root, "userdata", "state.sqlite");
      const outsideDatabase = path.join(root, "outside.sqlite");
      const updateId = "123e4567-e89b-42d3-a456-426614174002";
      const backupDir = path.join(root, "runtime", "db-backup", updateId);
      yield* fs.makeDirectory(backupDir, { recursive: true });
      writeDatabase(databasePath, 5);
      initializeLauncherAuthority(
        root,
        path.join(root, "native-store-authority"),
        "environment-db-link",
      );
      NodeFS.renameSync(databasePath, outsideDatabase);
      NodeFS.symlinkSync(outsideDatabase, databasePath);
      writeDatabase(path.join(backupDir, "database"), 4);
      yield* fs.writeFileString(path.join(backupDir, ".restore-pending"), "");
      yield* fs.writeFileString(
        path.join(root, "userdata", "environment-id"),
        "environment-db-link\n",
      );
      const authorityStateDir = path.join(root, "native-store-authority");

      const versionDir = path.join(root, "runtime", "versions", "1.0.0");
      const entryPath = path.join(versionDir, "node_modules", "t3", "dist", "bin.mjs");
      yield* fs.makeDirectory(path.dirname(entryPath), { recursive: true });
      yield* fs.writeFileString(entryPath, "process.exit(0);\n");
      yield* fs.writeFileString(path.join(versionDir, ".install-complete"), "1.0.0\n");
      yield* Effect.promise(() =>
        writeServiceState(statePath, {
          protocol: SERVICE_LAUNCHER_PROTOCOL,
          activeVersion: "1.0.0",
          update: {
            id: updateId,
            fromVersion: "1.0.0",
            targetVersion: "1.1.0",
            dbPath: databasePath,
            status: "pending",
            phase: "trial-ready",
          },
        }),
      );

      const launcher = new Launcher(
        root,
        yield* Effect.promise(() => readServiceState(statePath)),
        authorityStateDir,
      );
      yield* Effect.promise(() =>
        launcher.run().then(
          () => Promise.reject(new Error("launcher unexpectedly completed")),
          () => Promise.resolve(),
        ),
      );
      assert.equal(readDatabaseSequence(outsideDatabase), 5);
      assert.isTrue(NodeFS.lstatSync(databasePath).isSymbolicLink());
    }),
  );
});
