import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  WORKSTREAM_CONTRACT_FAMILY,
  WORKSTREAM_CONTRACT_MANIFEST_SHA256,
  WORKSTREAM_CONTRACT_VERSION,
} from "@t3tools/contracts";
import { makeControlPlaneWorkstreamTransport } from "./ControlPlaneWorkstreamTransport.ts";

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
    const original = globalThis.fetch;
    let observed: { readonly url: string; readonly headers: Headers } | null = null;
    globalThis.fetch = async (input, init) => {
      observed = { url: String(input), headers: new Headers(init?.headers) };
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
    try {
      const configured = makeControlPlaneWorkstreamTransport(activation);
      const capabilities = yield* configured.transport.getCapabilities({
        contractVersion: "workstreams/1.0.0",
        contractManifest: WORKSTREAM_CONTRACT_MANIFEST_SHA256,
      });
      expect(capabilities.context.owner_id).toBe("owner-fixture");
      expect(observed?.url).toBe("https://control-plane.example/workstreams/v1/capabilities");
      expect(observed?.headers.get("x-control-signature")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(observed?.headers.get("x-control-content-sha256")).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      globalThis.fetch = original;
    }
  }),
);

it.effect("rejects malformed and over-bound control-plane responses", () =>
  Effect.gen(function* () {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response(JSON.stringify({ owner_id: "wrong-shape" }));
      const configured = makeControlPlaneWorkstreamTransport(activation);
      const malformed = yield* configured.transport
        .getCapabilities({
          contractVersion: "workstreams/1.0.0",
          contractManifest: WORKSTREAM_CONTRACT_MANIFEST_SHA256,
        })
        .pipe(Effect.flip);
      expect(malformed.effect).toBe("no-effect");

      globalThis.fetch = async () =>
        new Response("x".repeat(1_048_577), {
          headers: { "content-length": "1048577" },
        });
      const overBound = yield* configured.transport
        .getCapabilities({
          contractVersion: "workstreams/1.0.0",
          contractManifest: WORKSTREAM_CONTRACT_MANIFEST_SHA256,
        })
        .pipe(Effect.flip);
      expect(overBound.detail).toBe("response_too_large");
    } finally {
      globalThis.fetch = original;
    }
  }),
);
