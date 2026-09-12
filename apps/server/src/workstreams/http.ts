import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
  WorkstreamDeclarationPage,
  WorkstreamDetail,
  WorkstreamEdgePage,
  WorkstreamHistoryPage,
  WorkstreamMembershipPage,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  requireEnvironmentScope,
} from "../auth/http.ts";
import { makeControlPlaneWorkstreamTransport } from "./ControlPlaneWorkstreamTransport.ts";
import { WorkstreamGateway, make } from "./WorkstreamGateway.ts";

const configured = makeControlPlaneWorkstreamTransport();
export const workstreamGatewayLayerLive = Layer.effect(
  WorkstreamGateway,
  make(configured.transport, { binding: configured.binding }),
);

const internal = <A>(operation: string, effect: Effect.Effect<A, unknown>) =>
  effect.pipe(
    Effect.catch((cause) => failEnvironmentInternal("internal_error", { operation, cause })),
  );

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
      .handle("list", (args) =>
        read(args.endpoint.name).pipe(
          Effect.andThen(internal("list", gateway.readMetadata(args.payload))),
        ),
      )
      .handle("detail", (args) =>
        read(args.endpoint.name).pipe(
          Effect.andThen(
            internal("detail", gateway.readDetail(args.params.workstreamId)).pipe(
              Effect.map((value) => value as typeof WorkstreamDetail.Type),
            ),
          ),
        ),
      )
      .handle("memberships", (args) =>
        read(args.endpoint.name).pipe(
          Effect.andThen(
            internal(
              "memberships",
              gateway.readMemberships(args.params.workstreamId, args.payload),
            ).pipe(Effect.map((value) => value as typeof WorkstreamMembershipPage.Type)),
          ),
        ),
      )
      .handle("declarations", (args) =>
        read(args.endpoint.name).pipe(
          Effect.andThen(
            internal(
              "declarations",
              gateway.readDeclarations(args.params.workstreamId, args.payload),
            ).pipe(Effect.map((value) => value as typeof WorkstreamDeclarationPage.Type)),
          ),
        ),
      )
      .handle("edges", (args) =>
        read(args.endpoint.name).pipe(
          Effect.andThen(
            internal("edges", gateway.readEdges(args.params.workstreamId, args.payload)).pipe(
              Effect.map((value) => value as typeof WorkstreamEdgePage.Type),
            ),
          ),
        ),
      )
      .handle("history", (args) =>
        read(args.endpoint.name).pipe(
          Effect.andThen(
            internal("history", gateway.readHistory(args.params.workstreamId, args.payload)).pipe(
              Effect.map((value) => value as typeof WorkstreamHistoryPage.Type),
            ),
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
