import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { Command, GlobalFlag } from "effect/unstable/cli";

import { initializeNativeStoreAuthorityForBaseDir } from "../environment/nativeStoreAuthorityPersistence.ts";
import { projectLocationFlags, resolveCliAuthConfig } from "./config.ts";

const authorityEnrollCommand = Command.make("enroll", projectLocationFlags).pipe(
  Command.withDescription(
    "Enroll this T3 environment for trusted workstream placement using its persisted native identity.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const config = yield* resolveCliAuthConfig(flags, yield* GlobalFlag.LogLevel);
      const state = yield* Effect.try(() =>
        initializeNativeStoreAuthorityForBaseDir(config.baseDir),
      );
      yield* Console.log(
        `Enrolled native workstream placement authority at generation ${state.store_generation}.`,
      );
    }),
  ),
);

const authorityCommand = Command.make("authority").pipe(
  Command.withDescription("Manage T3-owned workstream placement authority."),
  Command.withSubcommands([authorityEnrollCommand]),
);

export const workstreamCommand = Command.make("workstream").pipe(
  Command.withDescription("Manage cross-system workstream integration."),
  Command.withSubcommands([authorityCommand]),
);
