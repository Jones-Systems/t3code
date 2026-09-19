// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { describe, expect, it } from "vite-plus/test";

import { nativeStoreAuthorityBaseDirFingerprint } from "./nativeStoreAuthorityPath.ts";
import {
  advanceNativeStoreAuthority,
  decodeNativeStoreAuthorityState,
  fenceNativeStoreAuthority,
  initializeNativeStoreAuthority,
  nativeStoreAuthorityPaths,
  prepareNativeStoreAuthorityAdvance,
  readVerifiedNativeStoreAuthority,
} from "./nativeStoreAuthorityPersistence.ts";

const UPDATE_A = "00000000-0000-4000-8000-000000000001";
const UPDATE_B = "00000000-0000-4000-8000-000000000002";

const makeFixture = (root: string) => {
  const baseDir = NodePath.join(root, "base");
  const authorityStateDir = NodePath.join(root, "authority");
  const databasePath = NodePath.join(baseDir, "userdata", "state.sqlite");
  NodeFS.mkdirSync(NodePath.dirname(databasePath), { recursive: true, mode: 0o700 });
  const database = new NodeSqlite.DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("CREATE TABLE orchestration_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT)");
  database.close();
  return {
    authorityStateDir,
    databasePath,
    environmentId: "environment-native-authority",
    fingerprint: nativeStoreAuthorityBaseDirFingerprint(baseDir),
  };
};

const withFixture = (run: (fixture: ReturnType<typeof makeFixture>) => void): void => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-native-authority-test-"));
  try {
    run(makeFixture(root));
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
};

const enroll = (fixture: ReturnType<typeof makeFixture>) =>
  initializeNativeStoreAuthority(
    fixture.authorityStateDir,
    fixture.databasePath,
    fixture.environmentId,
    fixture.fingerprint,
  );

const appendPrepared = (fixture: ReturnType<typeof makeFixture>, commit: boolean): void => {
  const database = new NodeSqlite.DatabaseSync(fixture.databasePath);
  const previous = Number(
    (
      database
        .prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM orchestration_events")
        .get() as { readonly sequence: number }
    ).sequence,
  );
  database.exec("BEGIN IMMEDIATE");
  database.exec("INSERT INTO orchestration_events DEFAULT VALUES");
  prepareNativeStoreAuthorityAdvance(
    fixture.authorityStateDir,
    fixture.databasePath,
    fixture.environmentId,
    fixture.fingerprint,
    previous,
    previous + 1,
  );
  database.exec(commit ? "COMMIT" : "ROLLBACK");
  database.close();
};

describe("native store authority persistence", () => {
  it("detects same-path ordinary database rollback", () => {
    withFixture((fixture) => {
      enroll(fixture);
      const backup = `${fixture.databasePath}.backup`;
      NodeFS.copyFileSync(fixture.databasePath, backup);
      appendPrepared(fixture, true);
      expect(
        readVerifiedNativeStoreAuthority(
          fixture.authorityStateDir,
          fixture.databasePath,
          fixture.environmentId,
          fixture.fingerprint,
        ).orchestration_sequence,
      ).toBe(1);
      NodeFS.copyFileSync(backup, fixture.databasePath);
      expect(() =>
        readVerifiedNativeStoreAuthority(
          fixture.authorityStateDir,
          fixture.databasePath,
          fixture.environmentId,
          fixture.fingerprint,
        ),
      ).toThrow("does not match");
    });
  });

  it("fails closed after external prepare when the main transaction rolls back", () => {
    withFixture((fixture) => {
      enroll(fixture);
      appendPrepared(fixture, false);
      expect(() =>
        readVerifiedNativeStoreAuthority(
          fixture.authorityStateDir,
          fixture.databasePath,
          fixture.environmentId,
          fixture.fingerprint,
        ),
      ).toThrow("does not match");
    });
  });

  it("explicit enrollment recovers a sequence mismatch by advancing generation", () => {
    withFixture((fixture) => {
      const initial = enroll(fixture);
      appendPrepared(fixture, false);
      const recovered = enroll(fixture);
      expect(recovered.store_generation).toBe(initial.store_generation + 1);
      expect(recovered.orchestration_sequence).toBe(0);
    });
  });

  it("serializes rollback while absent, accepts retry, and clears the barrier", () => {
    withFixture((fixture) => {
      expect(
        fenceNativeStoreAuthority(
          fixture.authorityStateDir,
          UPDATE_A,
          fixture.environmentId,
          fixture.fingerprint,
        ),
      ).toBeNull();
      expect(
        fenceNativeStoreAuthority(
          fixture.authorityStateDir,
          UPDATE_A,
          fixture.environmentId,
          fixture.fingerprint,
        ),
      ).toBeNull();
      expect(() =>
        fenceNativeStoreAuthority(
          fixture.authorityStateDir,
          UPDATE_B,
          fixture.environmentId,
          fixture.fingerprint,
        ),
      ).toThrow("another restore");
      expect(() => enroll(fixture)).toThrow("restore barrier");
      expect(
        advanceNativeStoreAuthority(
          fixture.authorityStateDir,
          fixture.databasePath,
          UPDATE_A,
          fixture.environmentId,
          fixture.fingerprint,
        ),
      ).toBeNull();
      expect(() => enroll(fixture)).not.toThrow();
    });
  });

  it("advances generation to the restored database sequence", () => {
    withFixture((fixture) => {
      const initial = enroll(fixture);
      appendPrepared(fixture, true);
      fenceNativeStoreAuthority(
        fixture.authorityStateDir,
        UPDATE_A,
        fixture.environmentId,
        fixture.fingerprint,
      );
      const database = new NodeSqlite.DatabaseSync(fixture.databasePath);
      database.exec("DELETE FROM orchestration_events");
      database.close();
      const active = advanceNativeStoreAuthority(
        fixture.authorityStateDir,
        fixture.databasePath,
        UPDATE_A,
        fixture.environmentId,
        fixture.fingerprint,
      );
      expect(active?.store_generation).toBe(initial.store_generation + 1);
      expect(active?.orchestration_sequence).toBe(0);
      expect(active?.state).toBe("active");
    });
  });

  it("releases an interrupted SQLite coordinator transaction after process death", async () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-native-authority-test-"));
    const fixture = makeFixture(root);
    enroll(fixture);
    const coordinatorPath = nativeStoreAuthorityPaths(fixture.authorityStateDir).coordinatorPath;
    const child = NodeChildProcess.spawn(
      process.execPath,
      [
        "-e",
        `const { DatabaseSync } = require("node:sqlite"); const database = new DatabaseSync(process.argv[1]); database.exec("BEGIN IMMEDIATE"); process.stdout.write("locked"); setInterval(() => {}, 1000);`,
        coordinatorPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.stdout.once("data", () => resolve());
      });
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill("SIGKILL");
      await exited;
      expect(() =>
        fenceNativeStoreAuthority(
          fixture.authorityStateDir,
          UPDATE_A,
          fixture.environmentId,
          fixture.fingerprint,
        ),
      ).not.toThrow();
    } finally {
      child.kill("SIGKILL");
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects malformed state, bad update IDs, symlinks, and public directories", () => {
    expect(() => decodeNativeStoreAuthorityState({ record_version: "old" })).toThrow();
    withFixture((fixture) => {
      expect(() =>
        fenceNativeStoreAuthority(
          fixture.authorityStateDir,
          "bad-id",
          fixture.environmentId,
          fixture.fingerprint,
        ),
      ).toThrow("update ID");
      NodeFS.symlinkSync(NodePath.dirname(fixture.authorityStateDir), fixture.authorityStateDir);
      expect(() => enroll(fixture)).toThrow("not private");
    });
    withFixture((fixture) => {
      NodeFS.mkdirSync(fixture.authorityStateDir, { mode: 0o755 });
      expect(() => enroll(fixture)).toThrow("not private");
    });
    withFixture((fixture) => {
      NodeFS.mkdirSync(fixture.authorityStateDir, { mode: 0o700 });
      NodeFS.symlinkSync(
        fixture.databasePath,
        nativeStoreAuthorityPaths(fixture.authorityStateDir).coordinatorPath,
      );
      expect(() => enroll(fixture)).toThrow("not private");
      const database = new NodeSqlite.DatabaseSync(fixture.databasePath, { readOnly: true });
      expect(() => database.prepare("SELECT 1").get()).not.toThrow();
      database.close();
    });
  });
});
