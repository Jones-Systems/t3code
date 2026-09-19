// @effect-diagnostics nodeBuiltinImport:off
// This module is also imported by the standalone service launcher. Keep its
// runtime dependencies limited to Node built-ins.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import {
  nativeStoreAuthorityBaseDirFingerprint,
  resolveNativeStoreAuthorityStateDir,
} from "./nativeStoreAuthorityPath.ts";

export const NATIVE_STORE_AUTHORITY_RECORD_VERSION = "t3-native-store-authority/3.0.0" as const;
export const NATIVE_STORE_AUTHORITY_FILE = "native-store-authority-v3.json" as const;
export const NATIVE_STORE_AUTHORITY_COORDINATOR_FILE =
  "native-store-authority-coordinator-v1.sqlite" as const;
export const NATIVE_STORE_AUTHORITY_NAMESPACE_PREFIX = "t3-native:" as const;

export type NativeStoreAuthorityState = {
  readonly record_version: typeof NATIVE_STORE_AUTHORITY_RECORD_VERSION;
  readonly environment_id: string;
  readonly authority_namespace: string;
  readonly store_generation: number;
  readonly orchestration_sequence: number;
  readonly base_dir_fingerprint: string;
  readonly state: "active" | "fenced";
  readonly transition_id: string | null;
};

export type NativeStoreAuthorityErrorCode =
  | "missing"
  | "corrupt"
  | "fenced"
  | "launcher_upgrade_required"
  | "environment_mismatch"
  | "generation_regression"
  | "sequence_mismatch"
  | "source_unavailable";

export class NativeStoreAuthorityPersistenceError extends Error {
  readonly code: NativeStoreAuthorityErrorCode;
  override readonly cause: unknown;

  constructor(code: NativeStoreAuthorityErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "NativeStoreAuthorityPersistenceError";
    this.code = code;
    this.cause = cause;
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AUTHORITY_NAMESPACE =
  /^t3-native:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE_DIR_FINGERPRINT = /^sha256:[0-9a-f]{64}$/;
const NOFOLLOW = NodeFS.constants.O_NOFOLLOW ?? 0;
const DIRECTORY = NodeFS.constants.O_DIRECTORY ?? 0;
const REQUIRED_STATE_KEYS = [
  "record_version",
  "environment_id",
  "authority_namespace",
  "store_generation",
  "orchestration_sequence",
  "base_dir_fingerprint",
  "state",
  "transition_id",
] as const;

const error = (code: NativeStoreAuthorityErrorCode, message: string, cause?: unknown) =>
  new NativeStoreAuthorityPersistenceError(code, message, cause);
const isErrno = (cause: unknown, code: string): boolean =>
  cause instanceof Error && "code" in cause && cause.code === code;
const mode = (stat: NodeFS.Stats): number => stat.mode & 0o777;

const verifyOwner = (stat: NodeFS.Stats, path: string): void => {
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (uid !== undefined && stat.uid !== uid) {
    throw error("source_unavailable", `Native authority path is not owner-controlled: ${path}`);
  }
};

const validateBinding = (environmentId: string, fingerprint: string): void => {
  if (
    environmentId.length < 1 ||
    environmentId.length > 512 ||
    !/^\S(?:[\s\S]*\S)?$/.test(environmentId)
  ) {
    throw error("environment_mismatch", "Native environment identity is invalid.");
  }
  if (!BASE_DIR_FINGERPRINT.test(fingerprint)) {
    throw error("environment_mismatch", "Native authority base binding is invalid.");
  }
};

const verifyAuthorityDirectory = (directory: string): void => {
  if (!NodePath.isAbsolute(directory)) {
    throw error("source_unavailable", "Native authority directory must be absolute.");
  }
  let stat: NodeFS.Stats;
  try {
    stat = NodeFS.lstatSync(directory);
  } catch (cause) {
    if (!isErrno(cause, "ENOENT")) {
      throw error("source_unavailable", "Native authority directory is unavailable.", cause);
    }
    try {
      NodeFS.mkdirSync(directory, { recursive: true, mode: 0o700 });
      stat = NodeFS.lstatSync(directory);
    } catch (mkdirCause) {
      throw error(
        "source_unavailable",
        "Native authority directory could not be created.",
        mkdirCause,
      );
    }
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || mode(stat) !== 0o700) {
    throw error("source_unavailable", "Native authority directory is not private.");
  }
  verifyOwner(stat, directory);
};

const verifyPrivateFile = (path: string, missingCode: NativeStoreAuthorityErrorCode): void => {
  let stat: NodeFS.Stats;
  try {
    stat = NodeFS.lstatSync(path);
  } catch (cause) {
    if (isErrno(cause, "ENOENT"))
      throw error(missingCode, `Native authority file is missing: ${path}`);
    throw error("source_unavailable", `Native authority file is unavailable: ${path}`, cause);
  }
  if (stat.isSymbolicLink() || !stat.isFile() || mode(stat) !== 0o600) {
    throw error("corrupt", `Native authority file is not private: ${path}`);
  }
  verifyOwner(stat, path);
};

export const nativeStoreAuthorityPaths = (authorityStateDir: string) => ({
  authorityStateDir,
  statePath: NodePath.join(authorityStateDir, NATIVE_STORE_AUTHORITY_FILE),
  coordinatorPath: NodePath.join(authorityStateDir, NATIVE_STORE_AUTHORITY_COORDINATOR_FILE),
});

export const nativeStoreAuthorityStateDirForBaseDir = (baseDir: string): string =>
  resolveNativeStoreAuthorityStateDir(baseDir, process.env.T3CODE_NATIVE_AUTHORITY_STATE_DIR);

export const decodeNativeStoreAuthorityState = (value: unknown): NativeStoreAuthorityState => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw error("corrupt", "Native authority state is not an object.");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== REQUIRED_STATE_KEYS.length ||
    REQUIRED_STATE_KEYS.some((key) => !Object.hasOwn(record, key)) ||
    record.record_version !== NATIVE_STORE_AUTHORITY_RECORD_VERSION ||
    typeof record.environment_id !== "string" ||
    typeof record.authority_namespace !== "string" ||
    !AUTHORITY_NAMESPACE.test(record.authority_namespace) ||
    typeof record.store_generation !== "number" ||
    !Number.isSafeInteger(record.store_generation) ||
    record.store_generation < 1 ||
    typeof record.orchestration_sequence !== "number" ||
    !Number.isSafeInteger(record.orchestration_sequence) ||
    record.orchestration_sequence < 0 ||
    typeof record.base_dir_fingerprint !== "string" ||
    !BASE_DIR_FINGERPRINT.test(record.base_dir_fingerprint) ||
    (record.state !== "active" && record.state !== "fenced") ||
    (record.transition_id !== null &&
      (typeof record.transition_id !== "string" || !UUID_V4.test(record.transition_id)))
  ) {
    throw error("corrupt", "Native authority state failed its schema checks.");
  }
  validateBinding(record.environment_id, record.base_dir_fingerprint);
  if (
    (record.state === "active" && record.transition_id !== null) ||
    (record.state === "fenced" && record.transition_id === null)
  ) {
    throw error("corrupt", "Native authority state transition is invalid.");
  }
  return record as NativeStoreAuthorityState;
};

const readState = (directory: string): NativeStoreAuthorityState => {
  const { statePath } = nativeStoreAuthorityPaths(directory);
  verifyAuthorityDirectory(directory);
  verifyPrivateFile(statePath, "missing");
  let fd: number | undefined;
  try {
    fd = NodeFS.openSync(statePath, NodeFS.constants.O_RDONLY | NOFOLLOW);
    return decodeNativeStoreAuthorityState(JSON.parse(NodeFS.readFileSync(fd, "utf8")) as unknown);
  } catch (cause) {
    if (cause instanceof NativeStoreAuthorityPersistenceError) throw cause;
    throw error("corrupt", "Native authority state could not be read.", cause);
  } finally {
    if (fd !== undefined) NodeFS.closeSync(fd);
  }
};

const syncDirectory = (directory: string): void => {
  let fd: number | undefined;
  try {
    fd = NodeFS.openSync(directory, NodeFS.constants.O_RDONLY | DIRECTORY | NOFOLLOW);
    NodeFS.fsyncSync(fd);
  } catch (cause) {
    throw error("source_unavailable", "Native authority directory could not be synced.", cause);
  } finally {
    if (fd !== undefined) NodeFS.closeSync(fd);
  }
};

const writeState = (directory: string, state: NativeStoreAuthorityState): void => {
  const { statePath } = nativeStoreAuthorityPaths(directory);
  verifyAuthorityDirectory(directory);
  try {
    verifyPrivateFile(statePath, "missing");
  } catch (cause) {
    if (!(cause instanceof NativeStoreAuthorityPersistenceError) || cause.code !== "missing")
      throw cause;
  }
  const temporaryPath = NodePath.join(
    directory,
    `.${NATIVE_STORE_AUTHORITY_FILE}.${process.pid}.${NodeCrypto.randomUUID()}.tmp`,
  );
  let fd: number | undefined;
  try {
    fd = NodeFS.openSync(
      temporaryPath,
      NodeFS.constants.O_WRONLY | NodeFS.constants.O_CREAT | NodeFS.constants.O_EXCL | NOFOLLOW,
      0o600,
    );
    NodeFS.writeFileSync(fd, `${JSON.stringify(state)}\n`, "utf8");
    NodeFS.fsyncSync(fd);
    NodeFS.closeSync(fd);
    fd = undefined;
    NodeFS.renameSync(temporaryPath, statePath);
    syncDirectory(directory);
  } catch (cause) {
    if (cause instanceof NativeStoreAuthorityPersistenceError) throw cause;
    throw error("source_unavailable", "Native authority state could not be committed.", cause);
  } finally {
    if (fd !== undefined) NodeFS.closeSync(fd);
    try {
      NodeFS.rmSync(temporaryPath, { force: true });
    } catch {
      // Readers use only the fixed state path; a leftover temp file is inert.
    }
  }
};

const openCoordinator = (directory: string): NodeSqlite.DatabaseSync => {
  verifyAuthorityDirectory(directory);
  const { coordinatorPath } = nativeStoreAuthorityPaths(directory);
  try {
    try {
      verifyPrivateFile(coordinatorPath, "missing");
    } catch (cause) {
      if (!(cause instanceof NativeStoreAuthorityPersistenceError) || cause.code !== "missing") {
        throw cause;
      }
    }
    const database = new NodeSqlite.DatabaseSync(coordinatorPath);
    database.exec(
      "PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL",
    );
    database.exec(`CREATE TABLE IF NOT EXISTS restore_barriers (
      singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
      update_id TEXT NOT NULL UNIQUE,
      base_dir_fingerprint TEXT NOT NULL
    ) STRICT`);
    NodeFS.chmodSync(coordinatorPath, 0o600);
    verifyPrivateFile(coordinatorPath, "source_unavailable");
    return database;
  } catch (cause) {
    if (cause instanceof NativeStoreAuthorityPersistenceError) throw cause;
    throw error("source_unavailable", "Native authority coordinator is unavailable.", cause);
  }
};

const withCoordinator = <A>(
  directory: string,
  operation: (database: NodeSqlite.DatabaseSync) => A,
): A => {
  const database = openCoordinator(directory);
  let transaction = false;
  try {
    database.exec("BEGIN IMMEDIATE");
    transaction = true;
    const result = operation(database);
    database.exec("COMMIT");
    transaction = false;
    return result;
  } catch (cause) {
    if (transaction) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Closing SQLite releases the process-owned lock.
      }
    }
    if (cause instanceof NativeStoreAuthorityPersistenceError) throw cause;
    throw error("source_unavailable", "Native authority coordination failed.", cause);
  } finally {
    database.close();
  }
};

const barrierCount = (database: NodeSqlite.DatabaseSync): number => {
  const row = database.prepare("SELECT COUNT(*) AS count FROM restore_barriers").get() as
    | { readonly count: number }
    | undefined;
  return row?.count ?? 0;
};

const requireNoBarrier = (database: NodeSqlite.DatabaseSync): void => {
  if (barrierCount(database) !== 0) {
    throw error("fenced", "Native authority has an active restore barrier.");
  }
};

export const readNativeStoreOrchestrationSequence = (databasePath: string): number => {
  let stat: NodeFS.Stats;
  try {
    stat = NodeFS.lstatSync(databasePath);
  } catch (cause) {
    throw error("source_unavailable", "Native database is unavailable.", cause);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw error("source_unavailable", "Native database is not a regular file.");
  }
  verifyOwner(stat, databasePath);
  let database: NodeSqlite.DatabaseSync | undefined;
  try {
    database = new NodeSqlite.DatabaseSync(databasePath, { readOnly: true });
    const row = database
      .prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM orchestration_events")
      .get() as { readonly sequence: number | bigint } | undefined;
    const sequence = Number(row?.sequence ?? 0);
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw error("corrupt", "Native database sequence is invalid.");
    }
    return sequence;
  } catch (cause) {
    if (cause instanceof NativeStoreAuthorityPersistenceError) throw cause;
    throw error("source_unavailable", "Native database sequence is unavailable.", cause);
  } finally {
    database?.close();
  }
};

const requireBinding = (
  state: NativeStoreAuthorityState,
  environmentId: string,
  fingerprint: string,
): void => {
  if (state.environment_id !== environmentId || state.base_dir_fingerprint !== fingerprint) {
    throw error("environment_mismatch", "Native authority environment changed.");
  }
};

export const hasNativeStoreAuthorityState = (directory: string): boolean => {
  try {
    NodeFS.lstatSync(nativeStoreAuthorityPaths(directory).statePath);
    return true;
  } catch (cause) {
    return !isErrno(cause, "ENOENT");
  }
};

export const readNativeStoreAuthorityState = (directory: string): NativeStoreAuthorityState =>
  readState(directory);

export const readVerifiedNativeStoreAuthority = (
  directory: string,
  databasePath: string,
  environmentId: string,
  fingerprint: string,
): NativeStoreAuthorityState => {
  validateBinding(environmentId, fingerprint);
  return withCoordinator(directory, (database) => {
    requireNoBarrier(database);
    const state = readState(directory);
    requireBinding(state, environmentId, fingerprint);
    if (state.state !== "active") throw error("fenced", "Native authority is fenced.");
    if (readNativeStoreOrchestrationSequence(databasePath) !== state.orchestration_sequence) {
      throw error(
        "sequence_mismatch",
        "Native database sequence does not match the independent high-water record.",
      );
    }
    return state;
  });
};

export const initializeNativeStoreAuthority = (
  directory: string,
  databasePath: string,
  environmentId: string,
  fingerprint: string,
): NativeStoreAuthorityState =>
  withCoordinator(directory, (database) => {
    validateBinding(environmentId, fingerprint);
    requireNoBarrier(database);
    const sequence = readNativeStoreOrchestrationSequence(databasePath);
    try {
      const current = readState(directory);
      requireBinding(current, environmentId, fingerprint);
      if (current.state !== "active") {
        throw error("fenced", "Native authority remains fenced and requires launcher recovery.");
      }
      if (current.orchestration_sequence === sequence) return current;
      const nextGeneration = current.store_generation + 1;
      if (!Number.isSafeInteger(nextGeneration)) {
        throw error("generation_regression", "Native authority generation cannot advance.");
      }
      const recovered = {
        ...current,
        store_generation: nextGeneration,
        orchestration_sequence: sequence,
      };
      writeState(directory, recovered);
      return recovered;
    } catch (cause) {
      if (!(cause instanceof NativeStoreAuthorityPersistenceError) || cause.code !== "missing")
        throw cause;
      const state: NativeStoreAuthorityState = {
        record_version: NATIVE_STORE_AUTHORITY_RECORD_VERSION,
        environment_id: environmentId,
        authority_namespace: `${NATIVE_STORE_AUTHORITY_NAMESPACE_PREFIX}${NodeCrypto.randomUUID()}`,
        store_generation: 1,
        orchestration_sequence: sequence,
        base_dir_fingerprint: fingerprint,
        state: "active",
        transition_id: null,
      };
      writeState(directory, state);
      return state;
    }
  });

/**
 * Called after the caller appended events inside its SQLite transaction and
 * before COMMIT. The external mark advances first, so rollback fails closed.
 */
export const prepareNativeStoreAuthorityAdvance = (
  directory: string,
  databasePath: string,
  environmentId: string,
  fingerprint: string,
  expectedPreviousSequence: number,
  nextSequence: number,
): NativeStoreAuthorityState | null => {
  if (!hasNativeStoreAuthorityState(directory)) return null;
  return withCoordinator(directory, (database) => {
    validateBinding(environmentId, fingerprint);
    requireNoBarrier(database);
    if (
      !Number.isSafeInteger(expectedPreviousSequence) ||
      !Number.isSafeInteger(nextSequence) ||
      expectedPreviousSequence < 0 ||
      nextSequence <= expectedPreviousSequence
    ) {
      throw error("sequence_mismatch", "Native authority sequence advance is invalid.");
    }
    const current = readState(directory);
    requireBinding(current, environmentId, fingerprint);
    if (current.state !== "active") throw error("fenced", "Native authority is fenced.");
    // The independent connection cannot see the caller's uncommitted rows.
    if (readNativeStoreOrchestrationSequence(databasePath) !== expectedPreviousSequence) {
      throw error("sequence_mismatch", "Native database sequence changed concurrently.");
    }
    if (current.orchestration_sequence !== expectedPreviousSequence) {
      throw error("sequence_mismatch", "Native authority sequence has an unexpected preimage.");
    }
    const advanced = { ...current, orchestration_sequence: nextSequence };
    writeState(directory, advanced);
    return advanced;
  });
};

export const fenceNativeStoreAuthority = (
  directory: string,
  updateId: string,
  environmentId: string,
  fingerprint: string,
): NativeStoreAuthorityState | null => {
  if (!UUID_V4.test(updateId)) throw error("corrupt", "Native authority update ID is invalid.");
  return withCoordinator(directory, (database) => {
    validateBinding(environmentId, fingerprint);
    const existing = database
      .prepare("SELECT update_id, base_dir_fingerprint FROM restore_barriers WHERE singleton = 1")
      .get() as { readonly update_id: string; readonly base_dir_fingerprint: string } | undefined;
    if (
      existing !== undefined &&
      (existing.update_id !== updateId || existing.base_dir_fingerprint !== fingerprint)
    ) {
      throw error("fenced", "Native authority is fenced by another restore.");
    }
    if (existing === undefined) {
      database
        .prepare(
          "INSERT INTO restore_barriers(singleton, update_id, base_dir_fingerprint) VALUES (1, ?, ?)",
        )
        .run(updateId, fingerprint);
    }
    if (!hasNativeStoreAuthorityState(directory)) return null;
    const current = readState(directory);
    requireBinding(current, environmentId, fingerprint);
    if (current.state === "fenced") {
      if (current.transition_id !== updateId) {
        throw error("fenced", "Native authority is fenced by another restore.");
      }
      return current;
    }
    const fenced: NativeStoreAuthorityState = {
      ...current,
      state: "fenced",
      transition_id: updateId,
    };
    writeState(directory, fenced);
    return fenced;
  });
};

export const advanceNativeStoreAuthority = (
  directory: string,
  databasePath: string,
  updateId: string,
  environmentId: string,
  fingerprint: string,
): NativeStoreAuthorityState | null => {
  if (!UUID_V4.test(updateId)) throw error("corrupt", "Native authority update ID is invalid.");
  return withCoordinator(directory, (database) => {
    if (
      database
        .prepare(
          "SELECT update_id FROM restore_barriers WHERE singleton = 1 AND update_id = ? AND base_dir_fingerprint = ?",
        )
        .get(updateId, fingerprint) === undefined
    ) {
      throw error("fenced", "Native authority restore barrier is missing.");
    }
    if (!hasNativeStoreAuthorityState(directory)) {
      database
        .prepare("DELETE FROM restore_barriers WHERE singleton = 1 AND update_id = ?")
        .run(updateId);
      return null;
    }
    validateBinding(environmentId, fingerprint);
    const current = readState(directory);
    requireBinding(current, environmentId, fingerprint);
    const sequence = readNativeStoreOrchestrationSequence(databasePath);
    let active: NativeStoreAuthorityState;
    if (current.state === "fenced" && current.transition_id === updateId) {
      const nextGeneration = current.store_generation + 1;
      if (!Number.isSafeInteger(nextGeneration)) {
        throw error("generation_regression", "Native authority generation cannot advance.");
      }
      active = {
        ...current,
        store_generation: nextGeneration,
        orchestration_sequence: sequence,
        state: "active",
        transition_id: null,
      };
      writeState(directory, active);
    } else if (
      current.state === "active" &&
      current.transition_id === null &&
      current.orchestration_sequence === sequence
    ) {
      // JSON advanced before a crash prevented coordinator COMMIT.
      active = current;
    } else {
      throw error("fenced", "Native authority restore transition does not match.");
    }
    database
      .prepare("DELETE FROM restore_barriers WHERE singleton = 1 AND update_id = ?")
      .run(updateId);
    return active;
  });
};

const readEnvironmentIdForBaseDir = (baseDir: string): string => {
  const path = NodePath.join(baseDir, "userdata", "environment-id");
  let fd: number | undefined;
  try {
    fd = NodeFS.openSync(path, NodeFS.constants.O_RDONLY | NOFOLLOW);
    const value = NodeFS.readFileSync(fd, "utf8").trim();
    validateBinding(value, nativeStoreAuthorityBaseDirFingerprint(baseDir));
    return value;
  } catch (cause) {
    if (cause instanceof NativeStoreAuthorityPersistenceError) throw cause;
    throw error("source_unavailable", "Native environment identity is unavailable.", cause);
  } finally {
    if (fd !== undefined) NodeFS.closeSync(fd);
  }
};

export const fenceNativeStoreAuthorityForBaseDir = (
  baseDir: string,
  updateId: string,
  authorityStateDir = nativeStoreAuthorityStateDirForBaseDir(baseDir),
): NativeStoreAuthorityState | null =>
  fenceNativeStoreAuthority(
    authorityStateDir,
    updateId,
    readEnvironmentIdForBaseDir(baseDir),
    nativeStoreAuthorityBaseDirFingerprint(baseDir),
  );

export const initializeNativeStoreAuthorityForBaseDir = (
  baseDir: string,
  databasePath: string,
  requiredLauncherProtocol: number,
  authorityStateDir = nativeStoreAuthorityStateDirForBaseDir(baseDir),
): NativeStoreAuthorityState => {
  requireNativeStoreAuthorityLauncherProtocolForBaseDir(baseDir, requiredLauncherProtocol);
  return initializeNativeStoreAuthority(
    authorityStateDir,
    databasePath,
    readEnvironmentIdForBaseDir(baseDir),
    nativeStoreAuthorityBaseDirFingerprint(baseDir),
  );
};

export const advanceNativeStoreAuthorityForBaseDir = (
  baseDir: string,
  databasePath: string,
  updateId: string,
  authorityStateDir = nativeStoreAuthorityStateDirForBaseDir(baseDir),
): NativeStoreAuthorityState | null =>
  advanceNativeStoreAuthority(
    authorityStateDir,
    databasePath,
    updateId,
    readEnvironmentIdForBaseDir(baseDir),
    nativeStoreAuthorityBaseDirFingerprint(baseDir),
  );

export const requireNativeStoreAuthorityLauncherProtocolForBaseDir = (
  baseDir: string,
  requiredLauncherProtocol: number,
): void => {
  const statePath = NodePath.join(baseDir, "runtime", "service-state.json");
  let fd: number | undefined;
  try {
    fd = NodeFS.openSync(statePath, NodeFS.constants.O_RDONLY | NOFOLLOW);
    const stat = NodeFS.fstatSync(fd);
    verifyOwner(stat, statePath);
    if (!stat.isFile() || (mode(stat) & 0o022) !== 0) {
      throw error("launcher_upgrade_required", "Installed service launcher state is not private.");
    }
    const value: unknown = JSON.parse(NodeFS.readFileSync(fd, "utf8"));
    if (
      typeof value !== "object" ||
      value === null ||
      !("protocol" in value) ||
      value.protocol !== requiredLauncherProtocol
    ) {
      throw error(
        "launcher_upgrade_required",
        "The installed service launcher must be upgraded before native authority can be trusted.",
      );
    }
  } catch (cause) {
    if (cause instanceof NativeStoreAuthorityPersistenceError) throw cause;
    throw error(
      "launcher_upgrade_required",
      "The installed service launcher must be upgraded before native authority can be trusted.",
      cause,
    );
  } finally {
    if (fd !== undefined) NodeFS.closeSync(fd);
  }
};
