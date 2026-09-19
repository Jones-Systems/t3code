// @effect-diagnostics nodeBuiltinImport:off - CLI integration exercises the filesystem boundary.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import { expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/unstable/cli";

import { SERVICE_LAUNCHER_PROTOCOL } from "../cloud/serviceProtocol.ts";
import {
  fenceNativeStoreAuthority,
  initializeNativeStoreAuthority,
} from "../environment/nativeStoreAuthorityPersistence.ts";
import { nativeStoreAuthorityBaseDirFingerprint } from "../environment/nativeStoreAuthorityPath.ts";
import { workstreamCommand } from "./workstream.ts";

const runtimeLayer = Layer.mergeAll(
  NodeServices.layer,
  Layer.succeed(NetService.NetService, {
    findAvailablePort: () => Effect.succeed(3773),
  } as unknown as NetService.NetService["Service"]),
  TestConsole.layer,
);

const runEnroll = (baseDir: string, authorityStateDir: string) =>
  Command.runWith(workstreamCommand, { version: "0.0.0" })([
    "authority",
    "enroll",
    "--base-dir",
    baseDir,
  ]).pipe(
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: { T3CODE_NATIVE_AUTHORITY_STATE_DIR: authorityStateDir },
        }),
      ),
    ),
  );

const writeEnvironment = (baseDir: string, environmentId: string) => {
  const stateDir = NodePath.join(baseDir, "userdata");
  NodeFS.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  NodeFS.chmodSync(stateDir, 0o700);
  NodeFS.writeFileSync(NodePath.join(stateDir, "environment-id"), `${environmentId}\n`);
};

const writeLauncherState = (baseDir: string, protocol = SERVICE_LAUNCHER_PROTOCOL) => {
  NodeFS.mkdirSync(NodePath.join(baseDir, "runtime"), { recursive: true });
  NodeFS.writeFileSync(
    NodePath.join(baseDir, "runtime", "service-state.json"),
    JSON.stringify({ protocol, activeVersion: "1.0.0" }),
    { mode: 0o600 },
  );
};

it.effect("enrolls idempotently only with a current launcher and reports blocked states", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "t3-workstream-enroll-cli-" });
    const root = NodePath.join(scratch, "base");
    const authorityStateDir = NodePath.join(scratch, "authority");
    writeEnvironment(root, "environment-enroll");

    const missingLauncher = yield* runEnroll(root, authorityStateDir).pipe(Effect.flip);
    expect(String(missingLauncher)).toContain("service launcher must be upgraded");

    writeLauncherState(root);
    yield* runEnroll(root, authorityStateDir);
    yield* runEnroll(root, authorityStateDir);
    expect(
      (yield* TestConsole.logLines).filter(
        (line): line is string => typeof line === "string" && line.includes("Enrolled"),
      ),
    ).toHaveLength(2);

    fenceNativeStoreAuthority(
      authorityStateDir,
      NodePath.join(root, "userdata", "native-store-authority-witness-v1.json"),
      "environment-enroll",
      nativeStoreAuthorityBaseDirFingerprint(root),
    );
    const fenced = yield* runEnroll(root, authorityStateDir).pipe(Effect.flip);
    expect(String(fenced)).toContain("remains fenced");

    const mismatchScratch = yield* fs.makeTempDirectoryScoped({
      prefix: "t3-workstream-enroll-mismatch-cli-",
    });
    const mismatchRoot = NodePath.join(mismatchScratch, "base");
    const mismatchAuthorityStateDir = NodePath.join(mismatchScratch, "authority");
    writeEnvironment(mismatchRoot, "environment-current");
    writeLauncherState(mismatchRoot);
    initializeNativeStoreAuthority(
      mismatchAuthorityStateDir,
      NodePath.join(mismatchRoot, "userdata", "native-store-authority-witness-v1.json"),
      "environment-other",
      nativeStoreAuthorityBaseDirFingerprint(mismatchRoot),
    );
    const mismatch = yield* runEnroll(mismatchRoot, mismatchAuthorityStateDir).pipe(Effect.flip);
    expect(String(mismatch)).toContain("environment changed");
  }).pipe(Effect.provide(runtimeLayer)),
);
