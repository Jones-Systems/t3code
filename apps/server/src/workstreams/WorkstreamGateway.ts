import { createHash } from "node:crypto";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const WORKSTREAM_CONTRACT_FAMILY = "workstreams" as const;
export const WORKSTREAM_CONTRACT_VERSION = "1.0.0" as const;
export const WORKSTREAM_CONTRACT_HEADER_VERSION = "workstreams/1.0.0" as const;
export const WORKSTREAM_CONTRACT_MANIFEST_SHA256 =
  "a03e34613ea1293b579316a21f98d4edd69a19221f9907cf0449e3b4933420dd" as const;

const MAX_PAGE_ITEMS = 100;
const DEFAULT_CACHE_CAPACITY = 32;
const DEFAULT_CACHE_MAX_AGE_MS = 30_000;

export type WorkstreamLifecycle =
  | "planned"
  | "active"
  | "paused"
  | "completed"
  | "deferred"
  | "abandoned";

export type WorkstreamProgress =
  | { readonly state: "progressing" | "unknown" | "stale" }
  | { readonly state: "waiting"; readonly condition: string }
  | { readonly state: "blocked"; readonly impediment: string };

export interface WorkstreamMetadata {
  readonly workstream_id: string;
  readonly owner_id: string;
  readonly name: string;
  readonly lifecycle: WorkstreamLifecycle;
  readonly progress: WorkstreamProgress;
  readonly delivery:
    | "none-observed"
    | "branch-open"
    | "pr-open"
    | "merged"
    | "released"
    | "deployed"
    | "deployment-verified"
    | "failed"
    | "unknown"
    | "stale";
  readonly freshness:
    | "current"
    | "stale"
    | "inaccessible"
    | "partial-coverage"
    | "conflicting"
    | "unknown";
  readonly sort_order: number;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly created_by: { readonly principal_id: string };
  readonly updated_by: { readonly principal_id: string };
}

export interface WorkstreamReadContext {
  readonly owner_id: string;
  readonly server_generation: number;
  readonly registry_version: number;
}

export interface WorkstreamCapabilities {
  readonly contract_family: typeof WORKSTREAM_CONTRACT_FAMILY;
  readonly contract_version: typeof WORKSTREAM_CONTRACT_VERSION;
  readonly manifest_sha256: string;
  readonly context: WorkstreamReadContext;
  readonly permissions: ReadonlyArray<"workstreams:read" | "workstreams:write">;
  readonly max_page_items: number;
}

export interface WorkstreamPage {
  readonly context: WorkstreamReadContext;
  readonly items: ReadonlyArray<WorkstreamMetadata>;
  readonly next_cursor: string | null;
}

export type WorkstreamOperation =
  | "create_workstream"
  | "update_workstream"
  | "register_reference"
  | "verify_reference"
  | "attach_primary"
  | "reattach_primary"
  | "link_secondary"
  | "remove_membership"
  | "move_primary"
  | "set_coordination_disposition"
  | "request_native_t3_settlement"
  | "set_declaration"
  | "withdraw_declaration"
  | "add_edge"
  | "remove_edge"
  | "refresh_linked_pr";

export interface WorkstreamCommand {
  readonly command_id: string;
  readonly expected_server_generation: number;
  readonly expected_registry_version: number;
  readonly action: Readonly<Record<string, unknown>> & { readonly operation: WorkstreamOperation };
}

export interface CoordinationDispositionEffect {
  readonly membership_id: string;
  readonly disposition:
    | "completed"
    | "completed-and-delivery-verified"
    | "superseded"
    | "continued-elsewhere"
    | "deferred"
    | "abandoned"
    | "other";
}

export interface NativeSettlementEffect {
  readonly native_reference_id: string;
  readonly native_action: "settle" | "unsettle";
  readonly outcome: "committed" | "denied" | "unsupported" | "failed" | "unresolved";
}

export interface WorkstreamReceiptEffects {
  readonly workstream_versions: ReadonlyArray<{
    readonly resource_id: string;
    readonly version: number;
  }>;
  readonly native_reference_id: string | null;
  readonly membership_ids: ReadonlyArray<string>;
  readonly declaration_id: string | null;
  readonly declaration_revision: number | null;
  readonly edge_id: string | null;
  readonly observation: unknown | null;
  readonly registration: unknown | null;
  readonly lifecycle_declaration: unknown | null;
  readonly coordination_disposition: CoordinationDispositionEffect | null;
  readonly native_settlement: NativeSettlementEffect | null;
}

interface ReceiptBase {
  readonly command_id: string;
  readonly owner_id: string;
  readonly actor: { readonly principal_id: string };
  readonly operation: WorkstreamOperation;
  readonly request_sha256: string;
  readonly server_generation: number;
  readonly accepted_at: string;
}

export interface CommittedWorkstreamReceipt extends ReceiptBase {
  readonly state: "committed";
  readonly completed_at: string;
  readonly registry_version: number;
  readonly changed: boolean;
  readonly effects: WorkstreamReceiptEffects;
}

export interface PendingWorkstreamReceipt extends ReceiptBase {
  readonly state: "pending" | "unresolved";
  readonly retry_after_seconds: number;
}

export interface RejectedWorkstreamReceipt extends ReceiptBase {
  readonly state: "rejected";
  readonly completed_at: string;
  readonly error: Readonly<Record<string, unknown>> & { readonly code: string };
}

export type WorkstreamReceipt =
  | CommittedWorkstreamReceipt
  | PendingWorkstreamReceipt
  | RejectedWorkstreamReceipt;

export class WorkstreamTransportError extends Schema.TaggedErrorClass<WorkstreamTransportError>()(
  "WorkstreamTransportError",
  {
    operation: Schema.Literals(["capabilities", "list", "command"]),
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

export interface WorkstreamTransport {
  readonly getCapabilities: (input: {
    readonly contractVersion: typeof WORKSTREAM_CONTRACT_HEADER_VERSION;
    readonly contractManifest: typeof WORKSTREAM_CONTRACT_MANIFEST_SHA256;
  }) => Effect.Effect<WorkstreamCapabilities, WorkstreamTransportError>;
  readonly listWorkstreams: (input: {
    readonly limit: number;
    readonly cursor?: string;
    readonly contractVersion: typeof WORKSTREAM_CONTRACT_HEADER_VERSION;
    readonly contractManifest: typeof WORKSTREAM_CONTRACT_MANIFEST_SHA256;
  }) => Effect.Effect<WorkstreamPage, WorkstreamTransportError>;
  readonly submitCommand: (input: {
    readonly body: string;
    readonly command: WorkstreamCommand;
    readonly idempotencyKey: string;
    readonly contractVersion: typeof WORKSTREAM_CONTRACT_HEADER_VERSION;
    readonly contractManifest: typeof WORKSTREAM_CONTRACT_MANIFEST_SHA256;
  }) => Effect.Effect<WorkstreamReceipt, WorkstreamTransportError>;
}

export interface WorkstreamMetadataResult {
  readonly page: WorkstreamPage;
  readonly source: "live" | "cache";
  readonly stale: boolean;
  readonly cached_at_ms: number;
}

export interface WorkstreamGatewayOptions {
  readonly cacheCapacity?: number;
  readonly cacheMaxAgeMs?: number;
  readonly now?: () => number;
}

export class WorkstreamGateway extends Context.Service<
  WorkstreamGateway,
  {
    readonly readMetadata: (input?: {
      readonly limit?: number;
      readonly cursor?: string;
    }) => Effect.Effect<WorkstreamMetadataResult, WorkstreamGatewayError>;
    readonly submit: (
      command: WorkstreamCommand,
    ) => Effect.Effect<WorkstreamReceipt, WorkstreamGatewayError>;
  }
>()("t3/workstreams/WorkstreamGateway") {}

interface CacheEntry {
  readonly page: WorkstreamPage;
  readonly cachedAtMs: number;
}

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .toSorted(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
};

const transportFailure = (error: WorkstreamTransportError): WorkstreamGatewayError =>
  new WorkstreamGatewayError({
    reason: error.effect === "unknown-effect" ? "unknown-effect" : "offline",
    detail: error.detail,
    cause: error,
  });

const assertCapabilities = (
  capabilities: WorkstreamCapabilities,
): Effect.Effect<WorkstreamCapabilities, WorkstreamGatewayError> => {
  if (
    capabilities.contract_family !== WORKSTREAM_CONTRACT_FAMILY ||
    capabilities.contract_version !== WORKSTREAM_CONTRACT_VERSION ||
    capabilities.manifest_sha256 !== WORKSTREAM_CONTRACT_MANIFEST_SHA256
  ) {
    return Effect.fail(
      new WorkstreamGatewayError({
        reason: "contract-mismatch",
        detail: "Control-plane Workstream contract identity does not match the accepted binding.",
      }),
    );
  }
  if (capabilities.max_page_items < 1 || capabilities.max_page_items > MAX_PAGE_ITEMS) {
    return Effect.fail(
      new WorkstreamGatewayError({
        reason: "invalid-response",
        detail: "Control-plane Workstream page bound is invalid.",
      }),
    );
  }
  return Effect.succeed(capabilities);
};

export const make = (transport: WorkstreamTransport, options: WorkstreamGatewayOptions = {}) =>
  Effect.sync(() => {
    const cacheCapacity = Math.max(1, options.cacheCapacity ?? DEFAULT_CACHE_CAPACITY);
    const cacheMaxAgeMs = Math.max(0, options.cacheMaxAgeMs ?? DEFAULT_CACHE_MAX_AGE_MS);
    const now = options.now ?? Date.now;
    const pageCache = new Map<string, CacheEntry>();
    const submitted = new Map<
      string,
      { readonly body: string; readonly receipt: WorkstreamReceipt }
    >();

    const remember = <Value>(map: Map<string, Value>, key: string, value: Value) => {
      map.delete(key);
      map.set(key, value);
      while (map.size > cacheCapacity) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    };

    const readMetadata: WorkstreamGateway["Service"]["readMetadata"] = Effect.fn(
      "WorkstreamGateway.readMetadata",
    )(function* (input = {}) {
      const limit = input.limit ?? 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_ITEMS) {
        return yield* new WorkstreamGatewayError({
          reason: "invalid-response",
          detail: "Workstream metadata reads require a limit from 1 through 100.",
        });
      }
      const key = `${limit}:${input.cursor ?? ""}`;
      const live = yield* Effect.result(
        transport
          .getCapabilities({
            contractVersion: WORKSTREAM_CONTRACT_HEADER_VERSION,
            contractManifest: WORKSTREAM_CONTRACT_MANIFEST_SHA256,
          })
          .pipe(
            Effect.mapError(transportFailure),
            Effect.flatMap(assertCapabilities),
            Effect.flatMap((capabilities) => {
              if (!capabilities.permissions.includes("workstreams:read")) {
                return Effect.fail(
                  new WorkstreamGatewayError({
                    reason: "permission-denied",
                    detail: "The current owner binding does not grant Workstream reads.",
                  }),
                );
              }
              if (limit > capabilities.max_page_items) {
                return Effect.fail(
                  new WorkstreamGatewayError({
                    reason: "invalid-response",
                    detail: "Workstream metadata read exceeds the server-advertised page bound.",
                  }),
                );
              }
              return transport
                .listWorkstreams({
                  limit,
                  ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
                  contractVersion: WORKSTREAM_CONTRACT_HEADER_VERSION,
                  contractManifest: WORKSTREAM_CONTRACT_MANIFEST_SHA256,
                })
                .pipe(
                  Effect.map((page) => ({ capabilities, page })),
                  Effect.mapError(transportFailure),
                );
            }),
          ),
      );

      if (live._tag === "Success") {
        const { capabilities, page } = live.success;
        if (
          page.items.length > limit ||
          page.items.length > MAX_PAGE_ITEMS ||
          page.context.owner_id !== capabilities.context.owner_id ||
          page.context.server_generation !== capabilities.context.server_generation ||
          page.context.registry_version !== capabilities.context.registry_version
        ) {
          return yield* new WorkstreamGatewayError({
            reason: "invalid-response",
            detail: "Control-plane returned an over-bound or context-mismatched Workstream page.",
          });
        }
        const cachedAtMs = now();
        remember(pageCache, key, { page, cachedAtMs });
        return {
          page,
          source: "live" as const,
          stale: false,
          cached_at_ms: cachedAtMs,
        };
      }

      const cached = pageCache.get(key);
      if (cached === undefined || live.failure.reason !== "offline") {
        return yield* live.failure;
      }
      const stale = now() - cached.cachedAtMs > cacheMaxAgeMs;
      return {
        page: cached.page,
        source: "cache" as const,
        stale,
        cached_at_ms: cached.cachedAtMs,
      };
    });

    const submit: WorkstreamGateway["Service"]["submit"] = Effect.fn("WorkstreamGateway.submit")(
      function* (command) {
        const body = canonicalJson(command);
        const prior = submitted.get(command.command_id);
        if (prior !== undefined) {
          if (prior.body !== body) {
            return yield* new WorkstreamGatewayError({
              reason: "idempotency-conflict",
              detail: "This command ID was already used with different business bytes.",
            });
          }
          return prior.receipt;
        }

        const capabilities = yield* transport
          .getCapabilities({
            contractVersion: WORKSTREAM_CONTRACT_HEADER_VERSION,
            contractManifest: WORKSTREAM_CONTRACT_MANIFEST_SHA256,
          })
          .pipe(Effect.mapError(transportFailure), Effect.flatMap(assertCapabilities));
        if (!capabilities.permissions.includes("workstreams:write")) {
          return yield* new WorkstreamGatewayError({
            reason: "permission-denied",
            detail: "The current owner binding does not grant Workstream mutation.",
          });
        }
        if (
          command.expected_server_generation !== capabilities.context.server_generation ||
          command.expected_registry_version !== capabilities.context.registry_version
        ) {
          return yield* new WorkstreamGatewayError({
            reason: "version-conflict",
            detail: "Command generation or registry revision is not current.",
          });
        }

        const receipt = yield* transport
          .submitCommand({
            body,
            command,
            idempotencyKey: command.command_id,
            contractVersion: WORKSTREAM_CONTRACT_HEADER_VERSION,
            contractManifest: WORKSTREAM_CONTRACT_MANIFEST_SHA256,
          })
          .pipe(Effect.mapError(transportFailure));
        const digest = createHash("sha256").update(body).digest("hex");
        if (
          receipt.command_id !== command.command_id ||
          receipt.request_sha256 !== digest ||
          receipt.operation !== command.action.operation ||
          receipt.server_generation !== command.expected_server_generation
        ) {
          return yield* new WorkstreamGatewayError({
            reason: "invalid-response",
            detail: "Control-plane receipt does not match the submitted command.",
          });
        }
        remember(submitted, command.command_id, { body, receipt });
        return receipt;
      },
    );

    return WorkstreamGateway.of({ readMetadata, submit });
  });
