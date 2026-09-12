import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  WORKSTREAM_CONTRACT_HEADER_VERSION,
  WORKSTREAM_CONTRACT_MANIFEST_SHA256,
  type WorkstreamCommand,
  type WorkstreamTransport,
  WorkstreamTransportError,
  make,
} from "./WorkstreamGateway.ts";
import { makeSyntheticWorkstreamTransport } from "./SyntheticWorkstreamTransport.ts";

const updateCommand = (overrides: Partial<WorkstreamCommand> = {}): WorkstreamCommand => ({
  command_id: "command-fixture-0001",
  expected_server_generation: 7,
  expected_registry_version: 11,
  action: {
    operation: "update_workstream",
    workstream_id: "ws-core-v1",
    expected_version: 3,
    name: "Cross-system Workstreams",
    progress: { state: "progressing" },
    sort_order: 10,
  },
  ...overrides,
});

it.effect("bounds metadata reads and falls back only to its metadata cache", () =>
  Effect.gen(function* () {
    const fixture = makeSyntheticWorkstreamTransport();
    let offline = false;
    let now = 1_000;
    const transport: WorkstreamTransport = {
      ...fixture,
      listWorkstreams: (input) =>
        offline
          ? Effect.fail(
              new WorkstreamTransportError({
                operation: "list",
                effect: "no-effect",
                detail: "offline",
              }),
            )
          : fixture.listWorkstreams(input),
    };
    const gateway = yield* make(transport, { now: () => now, cacheMaxAgeMs: 50 });

    const live = yield* gateway.readMetadata({ limit: 1 });
    expect(live.source).toBe("live");
    expect(live.stale).toBe(false);
    expect(live.page.items).toHaveLength(1);
    expect(Object.keys(live.page.items[0] ?? {})).not.toContain("declarations");

    offline = true;
    now = 1_020;
    const freshCache = yield* gateway.readMetadata({ limit: 1 });
    expect(freshCache.source).toBe("cache");
    expect(freshCache.stale).toBe(false);

    now = 1_051;
    const staleCache = yield* gateway.readMetadata({ limit: 1 });
    expect(staleCache.source).toBe("cache");
    expect(staleCache.stale).toBe(true);

    const invalid = yield* gateway.readMetadata({ limit: 101 }).pipe(Effect.flip);
    expect(invalid.reason).toBe("invalid-response");
  }),
);

it.effect("refuses mutations while offline or against stale generation and revision", () =>
  Effect.gen(function* () {
    const offlineGateway = yield* make(makeSyntheticWorkstreamTransport({ offline: true }));
    const offline = yield* offlineGateway.submit(updateCommand()).pipe(Effect.flip);
    expect(offline.reason).toBe("offline");

    const gateway = yield* make(makeSyntheticWorkstreamTransport());
    const stale = yield* gateway
      .submit(updateCommand({ expected_registry_version: 10 }))
      .pipe(Effect.flip);
    expect(stale.reason).toBe("version-conflict");
  }),
);

it.effect("binds the accepted contract and exact idempotency bytes", () =>
  Effect.gen(function* () {
    const fixture = makeSyntheticWorkstreamTransport();
    const submissions: Array<Parameters<WorkstreamTransport["submitCommand"]>[0]> = [];
    const transport: WorkstreamTransport = {
      ...fixture,
      submitCommand: (input) => {
        submissions.push(input);
        return fixture.submitCommand(input);
      },
    };
    const gateway = yield* make(transport);
    const command = updateCommand();

    const first = yield* gateway.submit(command);
    const replay = yield* gateway.submit(command);
    expect(replay).toEqual(first);
    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.idempotencyKey).toBe(command.command_id);
    expect(submissions[0]?.contractVersion).toBe(WORKSTREAM_CONTRACT_HEADER_VERSION);
    expect(submissions[0]?.contractManifest).toBe(WORKSTREAM_CONTRACT_MANIFEST_SHA256);

    const conflict = yield* gateway
      .submit(
        updateCommand({
          action: { ...command.action, name: "Different bytes" },
        }),
      )
      .pipe(Effect.flip);
    expect(conflict.reason).toBe("idempotency-conflict");
    expect(submissions).toHaveLength(1);

    const mismatchGateway = yield* make(
      makeSyntheticWorkstreamTransport({ manifestSha256: "0".repeat(64) }),
    );
    const mismatch = yield* mismatchGateway.submit(command).pipe(Effect.flip);
    expect(mismatch.reason).toBe("contract-mismatch");
  }),
);

it.effect("keeps coordination disposition and native T3 settlement as distinct receipts", () =>
  Effect.gen(function* () {
    const gateway = yield* make(makeSyntheticWorkstreamTransport());
    const coordination = yield* gateway.submit({
      command_id: "command-coordinate-0001",
      expected_server_generation: 7,
      expected_registry_version: 11,
      action: {
        operation: "set_coordination_disposition",
        workstream_id: "ws-core-v1",
        expected_version: 3,
        membership_id: "membership-1",
        disposition: "completed",
        other_reason: null,
      },
    });
    const settlement = yield* gateway.submit({
      command_id: "command-settlement-0001",
      expected_server_generation: 7,
      expected_registry_version: 11,
      action: {
        operation: "request_native_t3_settlement",
        workstream_id: "ws-core-v1",
        expected_version: 3,
        native_reference_id: "reference-t3-1",
        native_action: "settle",
      },
    });

    expect(coordination.state).toBe("committed");
    expect(settlement.state).toBe("committed");
    if (coordination.state !== "committed" || settlement.state !== "committed") return;
    expect(coordination.effects.coordination_disposition).toEqual({
      membership_id: "membership-1",
      disposition: "completed",
    });
    expect(coordination.effects.native_settlement).toBeNull();
    expect(settlement.effects.coordination_disposition).toBeNull();
    expect(settlement.effects.native_settlement).toEqual({
      native_reference_id: "reference-t3-1",
      native_action: "settle",
      outcome: "committed",
    });
  }),
);
