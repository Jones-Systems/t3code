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
import { workstreamCommand } from "./workstream.ts";

const runtimeLayer = Layer.mergeAll(
  NodeServices.layer,
  NetService.layer,
  TestConsole.layer,
  ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
);

const runEnroll = (baseDir: string) =>
  Command.runWith(workstreamCommand, { version: "0.0.0" })([
    "authority",
    "enroll",
    "--base-dir",
    baseDir,
  ]);

const writeEnvironment = (baseDir: string, environmentId: string) => {
  NodeFS.mkdirSync(NodePath.join(baseDir, "userdata"), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(baseDir, "userdata", "environment-id"), `${environmentId}\n`);
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
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-workstream-enroll-cli-" });
    writeEnvironment(root, "environment-enroll");

    const missingLauncher = yield* runEnroll(root).pipe(Effect.flip);
    expect(String(missingLauncher)).toContain("service launcher must be upgraded");

    writeLauncherState(root);
    yield* runEnroll(root);
    yield* runEnroll(root);
    expect(
      (yield* TestConsole.logLines).filter(
        (line): line is string => typeof line === "string" && line.includes("Enrolled"),
      ),
    ).toHaveLength(2);

    fenceNativeStoreAuthority(NodePath.join(root, "native-store-authority"), "environment-enroll");
    const fenced = yield* runEnroll(root).pipe(Effect.flip);
    expect(String(fenced)).toContain("remains fenced");

    const mismatchRoot = yield* fs.makeTempDirectoryScoped({
      prefix: "t3-workstream-enroll-mismatch-cli-",
    });
    writeEnvironment(mismatchRoot, "environment-current");
    writeLauncherState(mismatchRoot);
    initializeNativeStoreAuthority(
      NodePath.join(mismatchRoot, "native-store-authority"),
      "environment-other",
    );
    const mismatch = yield* runEnroll(mismatchRoot).pipe(Effect.flip);
    expect(String(mismatch)).toContain("environment changed");
  }).pipe(Effect.provide(runtimeLayer)),
);
