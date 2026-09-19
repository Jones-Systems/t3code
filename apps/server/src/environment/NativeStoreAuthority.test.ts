// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import {
  LEGACY_SERVICE_LAUNCHER_PROTOCOL,
  SERVICE_LAUNCHER_PROTOCOL,
} from "../cloud/serviceProtocol.ts";
import * as ServerEnvironment from "./ServerEnvironment.ts";
import {
  fenceNativeStoreAuthority,
  initializeNativeStoreAuthority,
} from "./nativeStoreAuthorityPersistence.ts";
import * as NativeStoreAuthority from "./NativeStoreAuthority.ts";
import { nativeStoreAuthorityBaseDirFingerprint } from "./nativeStoreAuthorityPath.ts";

const authorityLayer = (baseDir: string, authorityStateDir: string, environmentId: string) =>
  Layer.mergeAll(
    Layer.succeed(ServerConfig.ServerConfig, {
      baseDir,
      authorityStateDir,
      authorityWitnessPath: NodePath.join(
        baseDir,
        "userdata",
        "native-store-authority-witness-v1.json",
      ),
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
      const witnessPath = NodePath.join(root, "userdata", "native-store-authority-witness-v1.json");
      const environmentId = "environment-layer-test";
      NodeFS.mkdirSync(NodePath.dirname(witnessPath), { recursive: true, mode: 0o700 });
      NodeFS.mkdirSync(NodePath.join(root, "runtime"), { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(root, "runtime", "service-state.json"),
        // @effect-diagnostics-next-line preferSchemaOverJson:off - launcher-owned test fixture.
        JSON.stringify({ protocol: SERVICE_LAUNCHER_PROTOCOL, activeVersion: "1.0.0" }),
        { mode: 0o600 },
      );
      const initial = initializeNativeStoreAuthority(
        authorityStateDir,
        witnessPath,
        environmentId,
        nativeStoreAuthorityBaseDirFingerprint(root),
      );

      const authority = yield* NativeStoreAuthority.make().pipe(
        Effect.provide(authorityLayer(root, authorityStateDir, environmentId)),
      );
      expect(yield* authority.readCurrent).toEqual({
        environmentId,
        authorityNamespace: initial.authority_namespace,
        storeGeneration: initial.store_generation,
      });
      expect(authority.trustProvider.readTrustSnapshot()).toEqual({
        trustedEnvironments: [
          {
            environmentId,
            authorityNamespace: initial.authority_namespace,
            storeGeneration: initial.store_generation,
          },
        ],
        readiness: "ready",
      });

      NodeFS.rmSync(witnessPath);
      expect(authority.trustProvider.readTrustSnapshot()).toEqual({
        trustedEnvironments: [],
        readiness: "trust-provider-required",
      });
      initializeNativeStoreAuthority(
        authorityStateDir,
        witnessPath,
        environmentId,
        nativeStoreAuthorityBaseDirFingerprint(root),
      );
      expect(authority.trustProvider.readTrustSnapshot().readiness).toBe("ready");

      NodeFS.writeFileSync(
        NodePath.join(root, "runtime", "service-state.json"),
        // @effect-diagnostics-next-line preferSchemaOverJson:off - launcher-owned test fixture.
        JSON.stringify({ protocol: LEGACY_SERVICE_LAUNCHER_PROTOCOL, activeVersion: "1.0.0" }),
        { mode: 0o600 },
      );
      expect(authority.trustProvider.readTrustSnapshot()).toEqual({
        trustedEnvironments: [],
        readiness: "trust-provider-required",
      });
      NodeFS.writeFileSync(
        NodePath.join(root, "runtime", "service-state.json"),
        // @effect-diagnostics-next-line preferSchemaOverJson:off - launcher-owned test fixture.
        JSON.stringify({ protocol: SERVICE_LAUNCHER_PROTOCOL, activeVersion: "1.0.0" }),
        { mode: 0o600 },
      );

      fenceNativeStoreAuthority(
        authorityStateDir,
        witnessPath,
        environmentId,
        nativeStoreAuthorityBaseDirFingerprint(root),
      );
      expect((yield* Effect.result(authority.readCurrent))._tag).toBe("Failure");
      expect(authority.trustProvider.readTrustSnapshot()).toEqual({
        trustedEnvironments: [],
        readiness: "trust-provider-required",
      });
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
          authorityLayer(root, NodePath.join(root, "missing-authority"), "environment-missing"),
        ),
      );
      expect(missingAuthority.trustProvider.readTrustSnapshot()).toEqual({
        trustedEnvironments: [],
        readiness: "trust-provider-required",
      });

      const authorityStatePath = NodePath.join(root, "authority-state");
      NodeFS.writeFileSync(authorityStatePath, "not a directory");
      const authority = yield* NativeStoreAuthority.make().pipe(
        Effect.provide(authorityLayer(root, authorityStatePath, "environment-unavailable")),
      );
      expect(authority.trustProvider.readTrustSnapshot()).toEqual({
        trustedEnvironments: [],
        readiness: "trust-provider-required",
      });
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  }),
);
