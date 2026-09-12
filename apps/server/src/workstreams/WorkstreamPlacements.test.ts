import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  T3_PLACEMENT_CONTRACT,
  T3_PLACEMENT_MANIFEST_SHA256,
  T3_PLACEMENT_ROUTE,
  type T3PlacementPage,
} from "@t3tools/contracts";
import {
  makeControlPlaneWorkstreamTransport,
  signWorkstreamRequest,
} from "./ControlPlaneWorkstreamTransport.ts";
import { make } from "./WorkstreamGateway.ts";
import { makeSyntheticWorkstreamTransport } from "./SyntheticWorkstreamTransport.ts";

const now = Date.parse("2026-09-12T12:00:00Z");
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const page: T3PlacementPage = {
  context: {
    owner_id: "owner-fixture",
    principal_id: "principal-fixture",
    authorization_revision: 3,
    server_generation: 7,
    registry_version: 11,
  },
  items: [],
  next_cursor: null,
};
const binding = {
  registryId: "registry",
  ownerId: "owner-fixture",
  principalId: "principal-fixture",
  authorizationRevision: 3,
};
const activation = {
  state: "enabled",
  value: {
    baseUrl: new URL("https://control.example.test"),
    ...binding,
    keyId: "key-fixture",
    signingSecret: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  },
} as const;
const headers = {
  "x-control-contract-version": T3_PLACEMENT_CONTRACT,
  "x-control-contract-manifest": T3_PLACEMENT_MANIFEST_SHA256,
};

it.effect("signs the distinct placement contract and validates the response identity", () =>
  Effect.gen(function* () {
    const transport = makeControlPlaneWorkstreamTransport(activation, async (url, init) => {
      expect(String(url)).toBe(`https://control.example.test${T3_PLACEMENT_ROUTE}?limit=100`);
      const sent = new Headers(init?.headers);
      expect(sent.get("x-control-contract-version")).toBe(T3_PLACEMENT_CONTRACT);
      expect(sent.get("x-control-contract-manifest")).toBe(T3_PLACEMENT_MANIFEST_SHA256);
      expect(sent.get("x-control-signature")).toBe(
        signWorkstreamRequest({
          contractVersion: T3_PLACEMENT_CONTRACT,
          requestId: sent.get("x-control-request-id")!,
          sentAt: sent.get("x-control-timestamp")!,
          nonce: sent.get("x-control-nonce")!,
          principalId: binding.principalId,
          keyId: "key-fixture",
          method: "GET",
          target: `${T3_PLACEMENT_ROUTE}?limit=100`,
          contentSha256: sent.get("x-control-content-sha256")!,
          signingSecret: activation.value.signingSecret,
        }),
      );
      return new Response(json(page), { headers });
    }).transport;
    expect(yield* transport.listThreadPlacements!({ limit: 100 })).toEqual(page);
  }),
);

it.effect(
  "rejects wrong contract, overbound streamed bodies and unrecognized placement fields",
  () =>
    Effect.gen(function* () {
      const responses = [
        new Response(json(page)),
        new Response(json({ ...page, content: "private" }), { headers }),
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(600_000));
              controller.enqueue(new Uint8Array(600_000));
              controller.close();
            },
          }),
          { headers },
        ),
      ];
      for (const response of responses) {
        const transport = makeControlPlaneWorkstreamTransport(
          activation,
          async () => response,
        ).transport;
        const result = yield* Effect.result(transport.listThreadPlacements!({ limit: 100 }));
        expect(result._tag).toBe("Failure");
      }
    }),
);

it.effect("defaults to empty native trust and permits independent server injection", () =>
  Effect.gen(function* () {
    const transport = {
      ...makeSyntheticWorkstreamTransport(),
      listThreadPlacements: () => Effect.succeed(page),
    };
    const gateway = yield* make(transport, { binding, now: () => now });
    expect(yield* gateway.readThreadPlacements()).toEqual({
      page,
      trustedEnvironments: [],
      readiness: "trust-provider-required",
    });
    const trustedEnvironments = [
      { environmentId: "environment:1", authorityNamespace: "t3:store", storeGeneration: 9 },
    ];
    const injected = yield* make(transport, {
      binding,
      now: () => now,
      placementTrustProvider: { readTrustedEnvironments: () => trustedEnvironments },
    });
    expect((yield* injected.readThreadPlacements()).trustedEnvironments).toEqual(
      trustedEnvironments,
    );
  }),
);

it.effect("fences actual principal/grant and generation/revision values", () =>
  Effect.gen(function* () {
    for (const context of [
      { ...page.context, authorization_revision: 4 },
      { ...page.context, principal_id: "other" },
      { ...page.context, owner_id: "other" },
      { ...page.context, server_generation: 8 },
      { ...page.context, registry_version: 12 },
    ]) {
      const transport = {
        ...makeSyntheticWorkstreamTransport(),
        listThreadPlacements: () => Effect.succeed({ ...page, context }),
      };
      const gateway = yield* make(transport, { binding, now: () => now });
      expect((yield* Effect.result(gateway.readThreadPlacements()))._tag).toBe("Failure");
    }
  }),
);
