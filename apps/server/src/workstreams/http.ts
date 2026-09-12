import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
  type WorkstreamDeclarationPage,
  type WorkstreamDetail,
  type WorkstreamEdgePage,
  type WorkstreamHistoryPage,
  type WorkstreamMembershipPage,
  type WorkstreamReferenceDetail,
  type WorkstreamReferencePage,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  requireEnvironmentScope,
} from "../auth/http.ts";
import { makeControlPlaneWorkstreamTransport } from "./ControlPlaneWorkstreamTransport.ts";
import {
  WorkstreamGateway,
  make,
  type WorkstreamGatewayError,
  type T3PlacementTrustProvider,
} from "./WorkstreamGateway.ts";

export const WORKSTREAM_RESPONSE_HEADERS = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
} as const;

export const isWorkstreamHttpTarget = (originalUrl: string): boolean => {
  const path = originalUrl.split(/[?#]/, 1)[0];
  return path === "/api/workstreams" || path?.startsWith("/api/workstreams/") === true;
};

const appendWorkstreamResponseHeaders = HttpEffect.appendPreResponseHandler((_request, response) =>
  Effect.succeed(HttpServerResponse.setHeaders(response, WORKSTREAM_RESPONSE_HEADERS)),
);

export const workstreamResponseHeadersLayer = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (isWorkstreamHttpTarget(request.originalUrl)) yield* appendWorkstreamResponseHeaders;
      return yield* httpEffect;
    }),
  { global: true },
);

const configured = makeControlPlaneWorkstreamTransport();
export const makeWorkstreamGatewayLayerLive = (placementTrustProvider?: T3PlacementTrustProvider) =>
  Layer.effect(
    WorkstreamGateway,
    make(configured.transport, {
      binding: configured.binding,
      ...(placementTrustProvider ? { placementTrustProvider } : {}),
    }),
  );
export const workstreamGatewayLayerLive = makeWorkstreamGatewayLayerLive();

const internal = <A>(operation: string, effect: Effect.Effect<A, WorkstreamGatewayError>) =>
  effect.pipe(
    Effect.catch((error) =>
      failEnvironmentInternal("internal_error", { operation, reason: error.reason }),
    ),
  );

const pageInput = (payload: {
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}): { readonly limit?: number; readonly cursor?: string } => {
  const input: { limit?: number; cursor?: string } = {};
  if (payload.limit !== undefined) input.limit = payload.limit;
  if (payload.cursor !== undefined) input.cursor = payload.cursor;
  return input;
};

export const workstreamHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "workstreams",
  Effect.fnUntraced(function* (handlers) {
    const gateway = yield* WorkstreamGateway;
    const read = (name: string) =>
      Effect.gen(function* () {
        yield* annotateEnvironmentRequest(name);
        yield* requireEnvironmentScope(AuthOrchestrationReadScope);
      });
    return handlers
      .handle("threadPlacements", (args) =>
        read(args.endpoint.name).pipe(
          Effect.andThen(
            internal("threadPlacements", gateway.readThreadPlacements(pageInput(args.payload))),
          ),
        ),
      )
      .handle("list", (args) =>
        read(args.endpoint.name).pipe(
          Effect.andThen(internal("list", gateway.readMetadata(pageInput(args.payload)))),
        ),
      )
      .handle("detail", (args) =>
        read(args.endpoint.name).pipe(
          Effect.andThen(
            internal("detail", gateway.readDetail(args.params.workstreamId)).pipe(
              Effect.map((value) => value as WorkstreamDetail),
            ),
          ),
        ),
      )
      .handle("references", (args) =>
        read(args.endpoint.name).pipe(
          Effect.andThen(
            internal("references", gateway.readReferences(pageInput(args.payload))).pipe(
              Effect.map((value) => value as WorkstreamReferencePage),
            ),
          ),
        ),
      )
      .handle("reference", (args) =>
        read(args.endpoint.name).pipe(
          Effect.andThen(
            internal("reference", gateway.readReference(args.params.nativeReferenceId)).pipe(
              Effect.map((value) => value as WorkstreamReferenceDetail),
            ),
          ),
        ),
      )
      .handle("memberships", (args) =>
        read(args.endpoint.name).pipe(
          Effect.andThen(
            internal(
              "memberships",
              gateway.readMemberships(args.params.workstreamId, pageInput(args.payload)),
            ).pipe(Effect.map((value) => value as WorkstreamMembershipPage)),
          ),
        ),
      )
      .handle("declarations", (args) =>
        read(args.endpoint.name).pipe(
          Effect.andThen(
            internal(
              "declarations",
              gateway.readDeclarations(args.params.workstreamId, pageInput(args.payload)),
            ).pipe(Effect.map((value) => value as WorkstreamDeclarationPage)),
          ),
        ),
      )
      .handle("edges", (args) =>
        read(args.endpoint.name).pipe(
          Effect.andThen(
            internal(
              "edges",
              gateway.readEdges(args.params.workstreamId, pageInput(args.payload)),
            ).pipe(Effect.map((value) => value as WorkstreamEdgePage)),
          ),
        ),
      )
      .handle("history", (args) =>
        read(args.endpoint.name).pipe(
          Effect.andThen(
            internal(
              "history",
              gateway.readHistory(args.params.workstreamId, pageInput(args.payload)),
            ).pipe(Effect.map((value) => value as WorkstreamHistoryPage)),
          ),
        ),
      )
      .handle("command", (args) =>
        read(args.endpoint.name).pipe(
          Effect.andThen(internal("command", gateway.pollCommand(args.params.commandId))),
        ),
      )
      .handle("submit", (args) =>
        Effect.gen(function* () {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* internal("submit", gateway.submit(args.payload.command));
        }),
      );
  }),
);
