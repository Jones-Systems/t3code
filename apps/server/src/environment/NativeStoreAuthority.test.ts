// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "./ServerEnvironment.ts";
import {
  fenceNativeStoreAuthority,
  initializeNativeStoreAuthority,
} from "./nativeStoreAuthorityPersistence.ts";
import * as NativeStoreAuthority from "./NativeStoreAuthority.ts";

const authorityLayer = (authorityStateDir: string, environmentId: string) =>
  Layer.mergeAll(
    Layer.succeed(ServerConfig.ServerConfig, {
      authorityStateDir,
    } as ServerConfig.ServerConfig["Service"]),
    Layer.succeed(
      ServerEnvironment.ServerEnvironmentIdentity,
      ServerEnvironment.ServerEnvironmentIdentity.of({
        getEnvironmentId: Effect.succeed(EnvironmentId.make(environmentId)),
      }),
    ),
  );

it.effect("publishes only the current T3-owned tuple and fails closed when fenced", () =>
  Effect.gen(function* () {
    const root = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3-native-authority-layer-test-"),
    );
    try {
      const authorityStateDir = NodePath.join(root, "authority");
      const environmentId = "environment-layer-test";
      const initial = initializeNativeStoreAuthority(authorityStateDir, environmentId);

      const authority = yield* NativeStoreAuthority.make().pipe(
        Effect.provide(authorityLayer(authorityStateDir, environmentId)),
      );
      expect(yield* authority.readCurrent).toEqual({
        environmentId,
        authorityNamespace: initial.authority_namespace,
        storeGeneration: initial.store_generation,
      });
      expect(authority.trustProvider.readTrustedEnvironments()).toEqual([
        {
          environmentId,
          authorityNamespace: initial.authority_namespace,
          storeGeneration: initial.store_generation,
        },
      ]);

      fenceNativeStoreAuthority(authorityStateDir, environmentId);
      expect((yield* Effect.result(authority.readCurrent))._tag).toBe("Failure");
      expect(authority.trustProvider.readTrustedEnvironments()).toEqual([]);
      expect(authority.trustProvider.isReady?.()).toBe(false);
      expect(initial.authority_namespace).toMatch(/^t3-native:/);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  }),
);

it.effect("keeps live placement fail-closed when the native authority is missing or unusable", () =>
  Effect.gen(function* () {
    const root = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3-native-authority-layer-test-"),
    );
    try {
      const missingAuthority = yield* NativeStoreAuthority.make().pipe(
        Effect.provide(
          authorityLayer(NodePath.join(root, "missing-authority"), "environment-missing"),
        ),
      );
      expect(missingAuthority.trustProvider.readTrustedEnvironments()).toEqual([]);
      expect(missingAuthority.trustProvider.isReady?.()).toBe(false);

      const authorityStatePath = NodePath.join(root, "authority-state");
      NodeFS.writeFileSync(authorityStatePath, "not a directory");
      const authority = yield* NativeStoreAuthority.make().pipe(
        Effect.provide(authorityLayer(authorityStatePath, "environment-unavailable")),
      );
      expect(authority.trustProvider.readTrustedEnvironments()).toEqual([]);
      expect(authority.trustProvider.isReady?.()).toBe(false);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  }),
);
