// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { SERVICE_LAUNCHER_PROTOCOL } from "../cloud/serviceProtocol.ts";
import {
  defaultNativeStoreAuthorityStateDir,
  nativeStoreAuthorityBaseDirFingerprint,
} from "./nativeStoreAuthorityPath.ts";
import {
  advanceNativeStoreAuthority,
  decodeNativeStoreAuthorityState,
  fenceNativeStoreAuthority,
  initializeNativeStoreAuthority,
  initializeNativeStoreAuthorityForBaseDir,
  NATIVE_STORE_AUTHORITY_WITNESS_VERSION,
  nativeStoreAuthorityPaths,
  readNativeStoreAuthorityState,
  readVerifiedNativeStoreAuthority,
} from "./nativeStoreAuthorityPersistence.ts";

const withDirectory = (run: (directory: string) => void): void => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-native-authority-test-"));
  try {
    run(NodePath.join(root, "authority"));
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
};

const authorityFixture = (authorityStateDir: string) => {
  const baseDir = NodePath.dirname(authorityStateDir);
  const witnessPath = NodePath.join(baseDir, "userdata", "native-store-authority-witness-v1.json");
  NodeFS.mkdirSync(NodePath.dirname(witnessPath), { recursive: true, mode: 0o700 });
  return {
    witnessPath,
    baseDirFingerprint: nativeStoreAuthorityBaseDirFingerprint(baseDir),
  };
};

describe("native store authority persistence", () => {
  it("enrolls only from the persisted T3 environment identity", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-native-enroll-test-"));
    try {
      NodeFS.mkdirSync(NodePath.join(root, "userdata"), { recursive: true, mode: 0o700 });
      NodeFS.writeFileSync(
        NodePath.join(root, "userdata", "environment-id"),
        "environment-native-enrollment\n",
      );
      NodeFS.mkdirSync(NodePath.join(root, "runtime"), { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(root, "runtime", "service-state.json"),
        JSON.stringify({ protocol: SERVICE_LAUNCHER_PROTOCOL, activeVersion: "1.0.0" }),
        { mode: 0o600 },
      );
      const authorityStateDir = NodePath.join(root, "test-authority");
      const state = initializeNativeStoreAuthorityForBaseDir(
        root,
        SERVICE_LAUNCHER_PROTOCOL,
        authorityStateDir,
      );
      expect(state.environment_id).toBe("environment-native-enrollment");
      expect(state.state).toBe("active");
      expect(() =>
        initializeNativeStoreAuthorityForBaseDir(
          root,
          SERVICE_LAUNCHER_PROTOCOL,
          authorityStateDir,
        ),
      ).not.toThrow();
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the high-water record outside T3 home and rejects a rolled-back witness", () => {
    const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-native-high-water-"));
    try {
      const baseDir = NodePath.join(scratch, "base");
      const cloneDir = NodePath.join(scratch, "clone");
      const authorityStateDir = NodePath.join(scratch, "authority");
      const witnessPath = NodePath.join(
        baseDir,
        "userdata",
        "native-store-authority-witness-v1.json",
      );
      NodeFS.mkdirSync(NodePath.dirname(witnessPath), { recursive: true, mode: 0o700 });
      const baseDirFingerprint = nativeStoreAuthorityBaseDirFingerprint(baseDir);
      const initial = initializeNativeStoreAuthority(
        authorityStateDir,
        witnessPath,
        "environment-high-water",
        baseDirFingerprint,
      );
      const rolledBackWitness = NodeFS.readFileSync(witnessPath);
      fenceNativeStoreAuthority(
        authorityStateDir,
        witnessPath,
        "environment-high-water",
        baseDirFingerprint,
      );
      const databasePath = NodePath.join(baseDir, "userdata", "state.sqlite");
      NodeFS.writeFileSync(databasePath, "SQLite format 3\0current");
      const advanced = advanceNativeStoreAuthority(
        authorityStateDir,
        witnessPath,
        "environment-high-water",
        baseDirFingerprint,
        databasePath,
      );
      expect(advanced.store_generation).toBe(initial.store_generation + 1);

      NodeFS.writeFileSync(witnessPath, rolledBackWitness, { mode: 0o600 });
      expect(() =>
        readVerifiedNativeStoreAuthority(
          authorityStateDir,
          witnessPath,
          "environment-high-water",
          baseDirFingerprint,
        ),
      ).toThrow("does not match");
      expect(defaultNativeStoreAuthorityStateDir(baseDir)).not.toContain(`${baseDir}/`);
      expect(defaultNativeStoreAuthorityStateDir(cloneDir)).not.toBe(
        defaultNativeStoreAuthorityStateDir(baseDir),
      );
      expect(() =>
        readVerifiedNativeStoreAuthority(
          authorityStateDir,
          witnessPath,
          "environment-high-water",
          nativeStoreAuthorityBaseDirFingerprint(cloneDir),
        ),
      ).toThrow("environment changed");
    } finally {
      NodeFS.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("creates one private authority and advances only after a durable fence", () => {
    withDirectory((authorityStateDir) => {
      const environmentId = "environment-native-authority";
      const { witnessPath, baseDirFingerprint } = authorityFixture(authorityStateDir);
      const initial = initializeNativeStoreAuthority(
        authorityStateDir,
        witnessPath,
        environmentId,
        baseDirFingerprint,
      );
      expect(initial.authority_namespace).toMatch(/^t3-native:[0-9a-f-]{36}$/);
      expect(initial.store_generation).toBe(1);
      expect(initial.state).toBe("active");
      expect(NodeFS.statSync(authorityStateDir).mode & 0o777).toBe(0o700);
      expect(
        NodeFS.statSync(nativeStoreAuthorityPaths(authorityStateDir).statePath).mode & 0o777,
      ).toBe(0o600);

      const restarted = initializeNativeStoreAuthority(
        authorityStateDir,
        witnessPath,
        environmentId,
        baseDirFingerprint,
      );
      expect(restarted).toEqual(initial);

      const fenced = fenceNativeStoreAuthority(
        authorityStateDir,
        witnessPath,
        environmentId,
        baseDirFingerprint,
      );
      expect(fenced.state).toBe("fenced");
      expect(fenced.transition_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(() => readNativeStoreAuthorityState(authorityStateDir)).not.toThrow();

      const databasePath = NodePath.join(NodePath.dirname(authorityStateDir), "state.sqlite");
      NodeFS.writeFileSync(databasePath, "SQLite format 3\0");
      const active = advanceNativeStoreAuthority(
        authorityStateDir,
        witnessPath,
        environmentId,
        baseDirFingerprint,
        databasePath,
      );
      expect(active.state).toBe("active");
      expect(active.transition_id).toBeNull();
      expect(active.store_generation).toBe(2);
      expect(readNativeStoreAuthorityState(authorityStateDir)).toEqual(active);

      const refenced = fenceNativeStoreAuthority(
        authorityStateDir,
        witnessPath,
        environmentId,
        baseDirFingerprint,
      );
      NodeFS.writeFileSync(
        witnessPath,
        `${JSON.stringify({
          record_version: NATIVE_STORE_AUTHORITY_WITNESS_VERSION,
          environment_id: refenced.environment_id,
          authority_namespace: refenced.authority_namespace,
          store_generation: refenced.store_generation + 1,
          base_dir_fingerprint: refenced.base_dir_fingerprint,
        })}\n`,
        { mode: 0o600 },
      );
      expect(
        advanceNativeStoreAuthority(
          authorityStateDir,
          witnessPath,
          environmentId,
          baseDirFingerprint,
          databasePath,
        ).store_generation,
      ).toBe(3);
    });
  });

  it("fails closed for malformed, fenced, mismatched, and unreviewable transitions", () => {
    expect(() =>
      decodeNativeStoreAuthorityState({
        record_version: "t3-native-store-authority/1.0.0",
        environment_id: "env",
        authority_namespace: "t3-native:00000000-0000-4000-8000-000000000000",
        store_generation: 1,
        state: "active",
        transition_id: "not-null",
      }),
    ).toThrow();

    withDirectory((authorityStateDir) => {
      const { witnessPath, baseDirFingerprint } = authorityFixture(authorityStateDir);
      initializeNativeStoreAuthority(authorityStateDir, witnessPath, "env-a", baseDirFingerprint);
      expect(() =>
        fenceNativeStoreAuthority(authorityStateDir, witnessPath, "env-b", baseDirFingerprint),
      ).toThrow("Native authority environment changed");
      const fenced = fenceNativeStoreAuthority(
        authorityStateDir,
        witnessPath,
        "env-a",
        baseDirFingerprint,
      );
      expect(
        fenceNativeStoreAuthority(authorityStateDir, witnessPath, "env-a", baseDirFingerprint),
      ).toEqual(fenced);
      expect(() =>
        advanceNativeStoreAuthority(
          authorityStateDir,
          witnessPath,
          "env-a",
          baseDirFingerprint,
          NodePath.join(authorityStateDir, "missing.sqlite"),
        ),
      ).toThrow();
      const invalidDatabasePath = NodePath.join(authorityStateDir, "invalid.sqlite");
      NodeFS.writeFileSync(invalidDatabasePath, "not sqlite");
      expect(() =>
        advanceNativeStoreAuthority(
          authorityStateDir,
          witnessPath,
          "env-a",
          baseDirFingerprint,
          invalidDatabasePath,
        ),
      ).toThrow("not a SQLite database");
    });
  });
});
