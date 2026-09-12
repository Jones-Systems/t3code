import { createHash } from "node:crypto";

import {
  WORKSTREAM_CONTRACT_FAMILY,
  WORKSTREAM_CONTRACT_HEADER_VERSION,
  WORKSTREAM_CONTRACT_MANIFEST_SHA256,
  WORKSTREAM_CONTRACT_VERSION,
  WORKSTREAM_MAX_PAGE_ITEMS,
  type T3WorkstreamBinding,
  type T3WorkstreamListResult,
  type Workstream,
  type WorkstreamCapabilities,
  type WorkstreamCommand,
  type WorkstreamPage,
  type WorkstreamReceipt,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export {
  WORKSTREAM_CONTRACT_FAMILY,
  WORKSTREAM_CONTRACT_HEADER_VERSION,
  WORKSTREAM_CONTRACT_MANIFEST_SHA256,
  WORKSTREAM_CONTRACT_VERSION,
};
export type {
  Workstream as WorkstreamMetadata,
  WorkstreamCapabilities,
  WorkstreamCommand,
  WorkstreamPage,
  WorkstreamReceipt,
};

export class WorkstreamTransportError extends Schema.TaggedErrorClass<WorkstreamTransportError>()(
  "WorkstreamTransportError",
  {
    operation: Schema.String,
    effect: Schema.Literals(["no-effect", "unknown-effect"]),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class WorkstreamGatewayError extends Schema.TaggedErrorClass<WorkstreamGatewayError>()(
  "WorkstreamGatewayError",
  {
    reason: Schema.Literals([
      "offline",
      "stale",
      "contract-mismatch",
      "permission-denied",
      "version-conflict",
      "idempotency-conflict",
      "invalid-response",
      "unknown-effect",
    ]),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

interface PageInput {
  readonly limit: number;
  readonly cursor?: string;
}

interface ContractInput {
  readonly contractVersion: typeof WORKSTREAM_CONTRACT_HEADER_VERSION;
  readonly contractManifest: typeof WORKSTREAM_CONTRACT_MANIFEST_SHA256;
}

export interface WorkstreamTransport {
  readonly getCapabilities: (
    input: ContractInput,
  ) => Effect.Effect<WorkstreamCapabilities, WorkstreamTransportError>;
  readonly listWorkstreams: (
    input: PageInput & ContractInput,
  ) => Effect.Effect<WorkstreamPage, WorkstreamTransportError>;
  readonly getWorkstream: (
    input: { readonly workstreamId: string } & ContractInput,
  ) => Effect.Effect<unknown, WorkstreamTransportError>;
  readonly listReferences: (
    input: PageInput & ContractInput,
  ) => Effect.Effect<unknown, WorkstreamTransportError>;
  readonly getReference: (
    input: { readonly nativeReferenceId: string } & ContractInput,
  ) => Effect.Effect<unknown, WorkstreamTransportError>;
  readonly listMemberships: (
    input: { readonly workstreamId: string } & PageInput & ContractInput,
  ) => Effect.Effect<unknown, WorkstreamTransportError>;
  readonly listDeclarations: (
    input: { readonly workstreamId: string } & PageInput & ContractInput,
  ) => Effect.Effect<unknown, WorkstreamTransportError>;
  readonly listEdges: (
    input: { readonly workstreamId: string } & PageInput & ContractInput,
  ) => Effect.Effect<unknown, WorkstreamTransportError>;
  readonly listHistory: (
    input: { readonly workstreamId?: string } & PageInput & ContractInput,
  ) => Effect.Effect<unknown, WorkstreamTransportError>;
  readonly getCommand: (
    input: { readonly commandId: string } & ContractInput,
  ) => Effect.Effect<WorkstreamReceipt, WorkstreamTransportError>;
  readonly submitCommand: (
    input: {
      readonly body: string;
      readonly command: WorkstreamCommand;
      readonly idempotencyKey: string;
    } & ContractInput,
  ) => Effect.Effect<WorkstreamReceipt, WorkstreamTransportError>;
}

export interface WorkstreamGatewayOptions {
  readonly binding: Pick<
    T3WorkstreamBinding,
    "registryId" | "ownerId" | "principalId" | "authorizationRevision"
  >;
  readonly cacheCapacity?: number;
  readonly cacheMaxAgeMs?: number;
  readonly now?: () => number;
}

export class WorkstreamGateway extends Context.Service<
  WorkstreamGateway,
  {
    readonly readSession: () => Effect.Effect<T3WorkstreamBinding, WorkstreamGatewayError>;
    readonly readMetadata: (input?: {
      readonly limit?: number;
      readonly cursor?: string;
    }) => Effect.Effect<T3WorkstreamListResult, WorkstreamGatewayError>;
    readonly readDetail: (workstreamId: string) => Effect.Effect<unknown, WorkstreamGatewayError>;
    readonly readReferences: (input?: {
      readonly limit?: number;
      readonly cursor?: string;
    }) => Effect.Effect<unknown, WorkstreamGatewayError>;
    readonly readReference: (
      nativeReferenceId: string,
    ) => Effect.Effect<unknown, WorkstreamGatewayError>;
    readonly readMemberships: (
      workstreamId: string,
      input?: { readonly limit?: number; readonly cursor?: string },
    ) => Effect.Effect<unknown, WorkstreamGatewayError>;
    readonly readDeclarations: (
      workstreamId: string,
      input?: { readonly limit?: number; readonly cursor?: string },
    ) => Effect.Effect<unknown, WorkstreamGatewayError>;
    readonly readEdges: (
      workstreamId: string,
      input?: { readonly limit?: number; readonly cursor?: string },
    ) => Effect.Effect<unknown, WorkstreamGatewayError>;
    readonly readHistory: (
      workstreamId: string | undefined,
      input?: { readonly limit?: number; readonly cursor?: string },
    ) => Effect.Effect<unknown, WorkstreamGatewayError>;
    readonly pollCommand: (
      commandId: string,
    ) => Effect.Effect<WorkstreamReceipt, WorkstreamGatewayError>;
    readonly submit: (
      command: WorkstreamCommand,
    ) => Effect.Effect<WorkstreamReceipt, WorkstreamGatewayError>;
    readonly purgeAuthorization: () => void;
  }
>()("t3/workstreams/WorkstreamGateway") {}

const contractInput: ContractInput = {
  contractVersion: WORKSTREAM_CONTRACT_HEADER_VERSION,
  contractManifest: WORKSTREAM_CONTRACT_MANIFEST_SHA256,
};

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .toSorted(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
};

const transportFailure = (error: WorkstreamTransportError) =>
  new WorkstreamGatewayError({
    reason: error.effect === "unknown-effect" ? "unknown-effect" : "offline",
    detail: error.detail,
    cause: error,
  });

function pageInput(input: { readonly limit?: number; readonly cursor?: string } = {}): PageInput {
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > WORKSTREAM_MAX_PAGE_ITEMS) {
    throw new WorkstreamGatewayError({
      reason: "invalid-response",
      detail: "Workstream reads require a limit from 1 through 100.",
    });
  }
  return { limit, ...(input.cursor === undefined ? {} : { cursor: input.cursor }) };
}

export const make = (transport: WorkstreamTransport, options: WorkstreamGatewayOptions) =>
  Effect.sync(() => {
    const cacheCapacity = Math.max(1, options.cacheCapacity ?? 32);
    const cacheMaxAgeMs = Math.max(0, options.cacheMaxAgeMs ?? 30_000);
    const now = options.now ?? Date.now;
    const pageCache = new Map<
      string,
      { readonly result: T3WorkstreamListResult; readonly at: number }
    >();
    const terminalReceipts = new Map<string, WorkstreamReceipt>();
    const commandDigests = new Map<string, string>();
    let lastBindingKey: string | null = null;

    const purgeAuthorization = () => {
      pageCache.clear();
      terminalReceipts.clear();
      commandDigests.clear();
      lastBindingKey = null;
    };
    const remember = <V>(map: Map<string, V>, key: string, value: V) => {
      map.delete(key);
      map.set(key, value);
      while (map.size > cacheCapacity) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    };

    const authorize = (permission: "workstreams:read" | "workstreams:write") =>
      transport.getCapabilities(contractInput).pipe(
        Effect.mapError(transportFailure),
        Effect.flatMap((capabilities) => {
          if (
            capabilities.contract_family !== WORKSTREAM_CONTRACT_FAMILY ||
            capabilities.contract_version !== WORKSTREAM_CONTRACT_VERSION ||
            capabilities.manifest_sha256 !== WORKSTREAM_CONTRACT_MANIFEST_SHA256
          )
            return Effect.fail(
              new WorkstreamGatewayError({
                reason: "contract-mismatch",
                detail: "Control-plane contract identity does not match the accepted binding.",
              }),
            );
          if (capabilities.context.owner_id !== options.binding.ownerId)
            return Effect.fail(
              new WorkstreamGatewayError({
                reason: "permission-denied",
                detail: "Control-plane owner binding does not match this activation.",
              }),
            );
          if (!capabilities.permissions.includes(permission))
            return Effect.fail(
              new WorkstreamGatewayError({
                reason: "permission-denied",
                detail: `Current binding does not grant ${permission}.`,
              }),
            );
          if (
            !Number.isSafeInteger(capabilities.max_page_items) ||
            capabilities.max_page_items < 1 ||
            capabilities.max_page_items > WORKSTREAM_MAX_PAGE_ITEMS
          )
            return Effect.fail(
              new WorkstreamGatewayError({
                reason: "invalid-response",
                detail: "Control-plane page bound is invalid.",
              }),
            );
          const binding: T3WorkstreamBinding = {
            registryId: options.binding.registryId,
            ownerId: options.binding.ownerId,
            principalId: options.binding.principalId,
            authorizationRevision: options.binding.authorizationRevision,
            serverGeneration: capabilities.context.server_generation,
            registryVersion: capabilities.context.registry_version,
            permissions: capabilities.permissions,
            contractVersion: WORKSTREAM_CONTRACT_HEADER_VERSION,
            contractManifest: WORKSTREAM_CONTRACT_MANIFEST_SHA256,
          };
          const key = [
            binding.registryId,
            binding.ownerId,
            binding.principalId,
            binding.authorizationRevision,
            binding.serverGeneration,
            binding.registryVersion,
            [...binding.permissions].sort().join(","),
            binding.contractVersion,
            binding.contractManifest,
          ].join("\u0000");
          if (lastBindingKey !== null && lastBindingKey !== key) purgeAuthorization();
          lastBindingKey = key;
          return Effect.succeed({ capabilities, binding, key });
        }),
      );

    const validateContext = (
      value: unknown,
      binding: T3WorkstreamBinding,
    ): Effect.Effect<unknown, WorkstreamGatewayError> => {
      if (!value || typeof value !== "object" || !("context" in value))
        return Effect.fail(
          new WorkstreamGatewayError({
            reason: "invalid-response",
            detail: "Workstream response omitted its read context.",
          }),
        );
      const context = (value as { context?: unknown }).context;
      if (!context || typeof context !== "object")
        return Effect.fail(
          new WorkstreamGatewayError({
            reason: "invalid-response",
            detail: "Workstream response context is invalid.",
          }),
        );
      const candidate = context as Record<string, unknown>;
      if (
        candidate.owner_id !== binding.ownerId ||
        candidate.server_generation !== binding.serverGeneration ||
        candidate.registry_version !== binding.registryVersion
      )
        return Effect.fail(
          new WorkstreamGatewayError({
            reason: "stale",
            detail:
              "Workstream response does not match the current owner, generation, and registry revision.",
          }),
        );
      const ownerMatches = (item: unknown): boolean => {
        if (Array.isArray(item)) return item.every(ownerMatches);
        if (!item || typeof item !== "object") return true;
        const record = item as Record<string, unknown>;
        if (typeof record.owner_id === "string" && record.owner_id !== binding.ownerId) {
          return false;
        }
        return Object.values(record).every(ownerMatches);
      };
      if (!ownerMatches(value)) {
        return Effect.fail(
          new WorkstreamGatewayError({
            reason: "invalid-response",
            detail: "Workstream response contains an item from another owner.",
          }),
        );
      }
      return Effect.succeed(value);
    };

    const readSession = () =>
      authorize("workstreams:read").pipe(Effect.map(({ binding }) => binding));
    const readMetadata: WorkstreamGateway["Service"]["readMetadata"] = (input = {}) =>
      Effect.gen(function* () {
        const authorized = yield* authorize("workstreams:read");
        const request = yield* Effect.try({
          try: () => pageInput(input),
          catch: (cause) => cause as WorkstreamGatewayError,
        });
        if (request.limit > authorized.capabilities.max_page_items)
          return yield* new WorkstreamGatewayError({
            reason: "invalid-response",
            detail: "Requested page exceeds the advertised bound.",
          });
        const cacheKey = `${authorized.key}\u0000${request.limit}\u0000${request.cursor ?? ""}`;
        const live = yield* Effect.result(
          transport
            .listWorkstreams({ ...request, ...contractInput })
            .pipe(Effect.mapError(transportFailure)),
        );
        if (live._tag === "Failure") {
          const cached = pageCache.get(cacheKey);
          if (live.failure.reason !== "offline" || cached === undefined) return yield* live.failure;
          return {
            ...cached.result,
            source: "cache",
            stale: now() - cached.at > cacheMaxAgeMs,
          };
        }
        yield* validateContext(live.success, authorized.binding);
        if (
          live.success.items.length > request.limit ||
          live.success.items.some((item) => item.owner_id !== authorized.binding.ownerId)
        )
          return yield* new WorkstreamGatewayError({
            reason: "invalid-response",
            detail: "Control-plane returned an over-bound or cross-owner Workstream page.",
          });
        const result: T3WorkstreamListResult = {
          binding: authorized.binding,
          items: live.success.items.map((item: Workstream) => ({
            workstreamId: item.workstream_id,
            name: item.name,
            lifecycle: item.lifecycle,
            progress: item.progress,
            delivery: item.delivery,
            freshness: item.freshness,
            sortOrder: item.sort_order,
            version: item.version,
            updatedAt: item.updated_at,
          })),
          nextCursor: live.success.next_cursor,
          source: "live",
          stale: false,
        };
        remember(pageCache, cacheKey, { result, at: now() });
        return result;
      });

    const boundRead = (
      run: (request: PageInput & ContractInput) => Effect.Effect<unknown, WorkstreamTransportError>,
      input?: { readonly limit?: number; readonly cursor?: string },
    ) =>
      Effect.gen(function* () {
        const authorized = yield* authorize("workstreams:read");
        const page = yield* Effect.try({
          try: () => pageInput(input),
          catch: (cause) => cause as WorkstreamGatewayError,
        });
        const value = yield* run({ ...page, ...contractInput }).pipe(
          Effect.mapError(transportFailure),
        );
        return yield* validateContext(value, authorized.binding);
      });
    const boundDetail = (run: () => Effect.Effect<unknown, WorkstreamTransportError>) =>
      Effect.gen(function* () {
        const authorized = yield* authorize("workstreams:read");
        const value = yield* run().pipe(Effect.mapError(transportFailure));
        return yield* validateContext(value, authorized.binding);
      });
    const validateReceipt = (
      receipt: WorkstreamReceipt,
      commandId: string,
      operation?: string,
      bodySha256?: string,
      binding?: T3WorkstreamBinding,
    ) => {
      if (
        receipt.command_id !== commandId ||
        (operation !== undefined && receipt.operation !== operation) ||
        (bodySha256 !== undefined && receipt.request_sha256 !== bodySha256) ||
        (binding !== undefined &&
          (receipt.owner_id !== binding.ownerId ||
            receipt.actor.principal_id !== binding.principalId ||
            receipt.server_generation !== binding.serverGeneration))
      )
        return Effect.fail(
          new WorkstreamGatewayError({
            reason: "invalid-response",
            detail:
              "Receipt is not bound to the current owner, principal, generation, command, and request.",
          }),
        );
      return Effect.succeed(receipt);
    };
    const pollCommand = (commandId: string) =>
      Effect.gen(function* () {
        const authorized = yield* authorize("workstreams:read");
        const receipt = yield* transport
          .getCommand({ commandId, ...contractInput })
          .pipe(Effect.mapError(transportFailure));
        return yield* validateReceipt(receipt, commandId, undefined, undefined, authorized.binding);
      });
    const submit = (command: WorkstreamCommand) =>
      Effect.gen(function* () {
        const authorized = yield* authorize("workstreams:write");
        if (
          command.expected_server_generation !== authorized.binding.serverGeneration ||
          command.expected_registry_version !== authorized.binding.registryVersion
        )
          return yield* new WorkstreamGatewayError({
            reason: "version-conflict",
            detail: "Command generation or registry revision is not current.",
          });
        const body = canonicalJson(command);
        const bodySha256 = createHash("sha256").update(body).digest("hex");
        const commandKey = [authorized.key, command.command_id].join("\u0000");
        const seenDigest = commandDigests.get(commandKey);
        if (seenDigest !== undefined && seenDigest !== bodySha256)
          return yield* new WorkstreamGatewayError({
            reason: "idempotency-conflict",
            detail: "This command ID was already used with different business bytes.",
          });
        commandDigests.set(commandKey, bodySha256);
        const replayKey = [authorized.key, command.command_id, bodySha256].join("\u0000");
        const prior = terminalReceipts.get(replayKey);
        if (prior) return prior;
        const receipt = yield* transport
          .submitCommand({ body, command, idempotencyKey: command.command_id, ...contractInput })
          .pipe(Effect.mapError(transportFailure));
        yield* validateReceipt(
          receipt,
          command.command_id,
          command.action.operation,
          bodySha256,
          authorized.binding,
        );
        if (receipt.state === "committed" || receipt.state === "rejected")
          remember(terminalReceipts, replayKey, receipt);
        pageCache.clear();
        return receipt;
      });

    return WorkstreamGateway.of({
      readSession,
      readMetadata,
      readDetail: (id) =>
        boundDetail(() => transport.getWorkstream({ workstreamId: id, ...contractInput })),
      readReferences: (input) => boundRead((request) => transport.listReferences(request), input),
      readReference: (id) =>
        boundDetail(() => transport.getReference({ nativeReferenceId: id, ...contractInput })),
      readMemberships: (id, input) =>
        boundRead((request) => transport.listMemberships({ workstreamId: id, ...request }), input),
      readDeclarations: (id, input) =>
        boundRead((request) => transport.listDeclarations({ workstreamId: id, ...request }), input),
      readEdges: (id, input) =>
        boundRead((request) => transport.listEdges({ workstreamId: id, ...request }), input),
      readHistory: (id, input) =>
        boundRead(
          (request) =>
            transport.listHistory({
              ...(id === undefined ? {} : { workstreamId: id }),
              ...request,
            }),
          input,
        ),
      pollCommand,
      submit,
      purgeAuthorization,
    });
  });
