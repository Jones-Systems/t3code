import type { TrustedT3PlacementEnvironment } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import { SERVICE_LAUNCHER_PROTOCOL } from "../cloud/serviceProtocol.ts";
import * as ServerEnvironment from "./ServerEnvironment.ts";
import type { T3PlacementTrustProvider } from "../workstreams/WorkstreamGateway.ts";
import { nativeStoreAuthorityBaseDirFingerprint } from "./nativeStoreAuthorityPath.ts";
import {
  advanceNativeStoreAuthority,
  decodeNativeStoreAuthorityState,
  fenceNativeStoreAuthority,
  initializeNativeStoreAuthority,
  readNativeStoreAuthorityState,
  readVerifiedNativeStoreAuthority,
  requireNativeStoreAuthorityLauncherProtocolForBaseDir,
  NativeStoreAuthorityPersistenceError,
  type NativeStoreAuthorityState,
} from "./nativeStoreAuthorityPersistence.ts";

export type NativeStoreAuthorityTuple = TrustedT3PlacementEnvironment;

export class NativeStoreAuthority extends Context.Service<
  NativeStoreAuthority,
  {
    readonly readCurrent: Effect.Effect<
      NativeStoreAuthorityTuple,
      NativeStoreAuthorityPersistenceError
    >;
    readonly trustProvider: T3PlacementTrustProvider;
  }
>()("t3/environment/NativeStoreAuthority") {}

const asPersistenceError = (cause: unknown): NativeStoreAuthorityPersistenceError => {
  return cause instanceof NativeStoreAuthorityPersistenceError
    ? cause
    : new NativeStoreAuthorityPersistenceError(
        "source_unavailable",
        "Native store authority is unavailable.",
        cause,
      );
};

const tupleFromState = (
  state: NativeStoreAuthorityState,
  environmentId: string,
): NativeStoreAuthorityTuple => {
  if (state.environment_id !== environmentId) {
    throw new NativeStoreAuthorityPersistenceError(
      "environment_mismatch",
      "Native authority environment changed.",
    );
  }
  if (state.state !== "active") {
    throw new NativeStoreAuthorityPersistenceError("fenced", "Native authority is fenced.");
  }
  return {
    environmentId,
    authorityNamespace: state.authority_namespace,
    storeGeneration: state.store_generation,
  };
};

export const make = Effect.fn("NativeStoreAuthority.make")(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const identity = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const environmentId = yield* identity.getEnvironmentId;
  const authorityStateDir = config.authorityStateDir;
  const authorityWitnessPath = config.authorityWitnessPath;
  const baseDirFingerprint = nativeStoreAuthorityBaseDirFingerprint(config.baseDir);
  const requireSafeLauncher = () =>
    requireNativeStoreAuthorityLauncherProtocolForBaseDir(
      config.baseDir,
      SERVICE_LAUNCHER_PROTOCOL,
    );

  // Enrollment is explicit: a missing or rolled-back authority record is not
  // regenerated here, because doing so could reset the generation high-water
  // mark and accidentally trust a replaced native store.
  const readCurrent: NativeStoreAuthority["Service"]["readCurrent"] = Effect.try({
    try: () => {
      requireSafeLauncher();
      return tupleFromState(
        readVerifiedNativeStoreAuthority(
          authorityStateDir,
          authorityWitnessPath,
          environmentId,
          baseDirFingerprint,
        ),
        environmentId,
      );
    },
    catch: asPersistenceError,
  });

  const readTrustSnapshot: T3PlacementTrustProvider["readTrustSnapshot"] = () => {
    try {
      requireSafeLauncher();
      return {
        trustedEnvironments: [
          tupleFromState(
            readVerifiedNativeStoreAuthority(
              authorityStateDir,
              authorityWitnessPath,
              environmentId,
              baseDirFingerprint,
            ),
            environmentId,
          ),
        ],
        readiness: "ready",
      };
    } catch {
      return { trustedEnvironments: [], readiness: "trust-provider-required" };
    }
  };

  return NativeStoreAuthority.of({
    readCurrent,
    trustProvider: {
      readTrustSnapshot,
    },
  });
});

export const layer = Layer.effect(NativeStoreAuthority, make());

export {
  advanceNativeStoreAuthority,
  decodeNativeStoreAuthorityState,
  fenceNativeStoreAuthority,
  initializeNativeStoreAuthority,
  readNativeStoreAuthorityState,
};
