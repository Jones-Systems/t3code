import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  WORKSTREAM_CONTRACT_FAMILY,
  WORKSTREAM_CONTRACT_MANIFEST_SHA256,
  WORKSTREAM_CONTRACT_VERSION,
} from "@t3tools/contracts";
import {
  makeControlPlaneWorkstreamTransport,
  signWorkstreamRequest,
  type WorkstreamFetch,
} from "./ControlPlaneWorkstreamTransport.ts";

const activation = {
  state: "enabled",
  value: {
    baseUrl: new URL("https://control-plane.example/"),
    ownerId: "owner-fixture",
    principalId: "principal-fixture",
    authorizationRevision: 2,
    keyId: "key-fixture",
    signingSecret: "test-secret-not-production",
  },
} as const;

it("matches the accepted workstreams/1.0.0 HMAC vector", () => {
  expect(
    signWorkstreamRequest({
      requestId: "request-0001",
      idempotencyKey: "command-0001",
      sentAt: "2026-09-12T12:34:56.000Z",
      nonce: "nonce-0001",
      principalId: "principal-0001",
      keyId: "key-0001",
      method: "POST",
      target: "/workstreams/v1/commands",
      contentSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      signingSecret: "vector-secret",
    }),
  ).toBe("qt-9bXKflLjem1fKDvUj3b2fBUTToy9veOoC9oODFm4");
});

it.effect("sends bounded signed HTTPS requests and runtime-decodes responses", () =>
  Effect.gen(function* () {
    const observed: Array<{ readonly url: string; readonly headers: Headers }> = [];
    const fetchPort: WorkstreamFetch = async (input, init) => {
      observed.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response(
        JSON.stringify({
          contract_family: WORKSTREAM_CONTRACT_FAMILY,
          contract_version: WORKSTREAM_CONTRACT_VERSION,
          manifest_sha256: WORKSTREAM_CONTRACT_MANIFEST_SHA256,
          context: { owner_id: "owner-fixture", server_generation: 7, registry_version: 11 },
          permissions: ["workstreams:read"],
          max_page_items: 100,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const configured = makeControlPlaneWorkstreamTransport(activation, fetchPort);
    const capabilities = yield* configured.transport.getCapabilities({
      contractVersion: "workstreams/1.0.0",
      contractManifest: WORKSTREAM_CONTRACT_MANIFEST_SHA256,
    });
    expect(capabilities.context.owner_id).toBe("owner-fixture");
    const captured = observed[0];
    expect(captured).toBeDefined();
    expect(captured?.url).toBe("https://control-plane.example/workstreams/v1/capabilities");
    expect(captured?.headers.get("x-control-signature")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(captured?.headers.get("x-control-content-sha256")).toMatch(/^[0-9a-f]{64}$/);
  }),
);

it.effect("rejects malformed and over-bound control-plane responses", () =>
  Effect.gen(function* () {
    const malformedFetch: WorkstreamFetch = async () =>
      new Response(JSON.stringify({ owner_id: "wrong-shape" }));
    const malformedConfigured = makeControlPlaneWorkstreamTransport(activation, malformedFetch);
    const malformed = yield* malformedConfigured.transport
      .getCapabilities({
        contractVersion: "workstreams/1.0.0",
        contractManifest: WORKSTREAM_CONTRACT_MANIFEST_SHA256,
      })
      .pipe(Effect.flip);
    expect(malformed.effect).toBe("no-effect");

    const overBoundFetch: WorkstreamFetch = async () =>
      new Response("x".repeat(1_048_577), {
        headers: { "content-length": "1048577" },
      });
    const overBoundConfigured = makeControlPlaneWorkstreamTransport(activation, overBoundFetch);
    const overBound = yield* overBoundConfigured.transport
      .getCapabilities({
        contractVersion: "workstreams/1.0.0",
        contractManifest: WORKSTREAM_CONTRACT_MANIFEST_SHA256,
      })
      .pipe(Effect.flip);
    expect(overBound.detail).toBe("response_too_large");
  }),
);

it.effect("disables non-HTTPS and header-unsafe activation before transport", () =>
  Effect.gen(function* () {
    let requests = 0;
    const fetchPort: WorkstreamFetch = async () => {
      requests += 1;
      return new Response("{}");
    };
    const unsafeActivation = {
      ...activation,
      value: {
        ...activation.value,
        baseUrl: new URL("http://control-plane.example/"),
        principalId: "principal-fixture\r\ninjected: value",
      },
    } as const;
    const configured = makeControlPlaneWorkstreamTransport(unsafeActivation, fetchPort);
    const unavailable = yield* configured.transport
      .getCapabilities({
        contractVersion: "workstreams/1.0.0",
        contractManifest: WORKSTREAM_CONTRACT_MANIFEST_SHA256,
      })
      .pipe(Effect.flip);

    expect(unavailable.effect).toBe("no-effect");
    expect(configured.binding.authorizationRevision).toBe(0);
    expect(requests).toBe(0);
  }),
);

it.effect("cancels a chunked response as soon as it crosses the byte bound", () =>
  Effect.gen(function* () {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(700_000));
        controller.enqueue(new Uint8Array(400_000));
      },
      cancel() {
        cancelled = true;
      },
    });
    const configured = makeControlPlaneWorkstreamTransport(
      activation,
      async () => new Response(stream, { headers: { "content-type": "application/json" } }),
    );
    const failure = yield* configured.transport
      .getCapabilities({
        contractVersion: "workstreams/1.0.0",
        contractManifest: WORKSTREAM_CONTRACT_MANIFEST_SHA256,
      })
      .pipe(Effect.flip);

    expect(failure.detail).toBe("response_too_large");
    expect(cancelled).toBe(true);
  }),
);

it.effect("does not expose transport or decoder causes", () =>
  Effect.gen(function* () {
    const privateMarker = "PRIVATE-MARKER-MUST-NOT-ESCAPE";
    const network = makeControlPlaneWorkstreamTransport(activation, async () => {
      throw new Error(privateMarker);
    });
    const networkFailure = yield* network.transport
      .getCapabilities({
        contractVersion: "workstreams/1.0.0",
        contractManifest: WORKSTREAM_CONTRACT_MANIFEST_SHA256,
      })
      .pipe(Effect.flip);
    expect(networkFailure.detail).toBe("transport_unavailable");
    expect(networkFailure.cause).toBeUndefined();

    const decoder = makeControlPlaneWorkstreamTransport(
      activation,
      async () => new Response(`{"private":"${privateMarker}"}`),
    );
    const decoderFailure = yield* decoder.transport
      .getCapabilities({
        contractVersion: "workstreams/1.0.0",
        contractManifest: WORKSTREAM_CONTRACT_MANIFEST_SHA256,
      })
      .pipe(Effect.flip);
    expect(decoderFailure.detail).toBe(
      "Control-plane returned invalid JSON for the accepted contract.",
    );
    expect(decoderFailure.cause).toBeUndefined();
  }),
);
