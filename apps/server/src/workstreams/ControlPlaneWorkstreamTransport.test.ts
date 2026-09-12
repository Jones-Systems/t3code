import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  WORKSTREAM_CONTRACT_FAMILY,
  WORKSTREAM_CONTRACT_MANIFEST_SHA256,
  WORKSTREAM_CONTRACT_VERSION,
} from "@t3tools/contracts";
import {
  makeControlPlaneWorkstreamTransport,
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
