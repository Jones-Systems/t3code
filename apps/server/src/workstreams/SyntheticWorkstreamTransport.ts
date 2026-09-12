import { createHash } from "node:crypto";

import * as Effect from "effect/Effect";

import {
  WORKSTREAM_CONTRACT_FAMILY,
  WORKSTREAM_CONTRACT_MANIFEST_SHA256,
  WORKSTREAM_CONTRACT_VERSION,
  type CommittedWorkstreamReceipt,
  type WorkstreamCapabilities,
  type WorkstreamCommand,
  type WorkstreamMetadata,
  type WorkstreamPage,
  type WorkstreamTransport,
  WorkstreamTransportError,
} from "./WorkstreamGateway.ts";

export const SYNTHETIC_WORKSTREAMS: ReadonlyArray<WorkstreamMetadata> = [
  {
    workstream_id: "ws-core-v1",
    owner_id: "owner-fixture",
    name: "Cross-system Workstreams",
    lifecycle: "active",
    progress: { state: "progressing" },
    delivery: "branch-open",
    freshness: "current",
    sort_order: 10,
    version: 3,
    created_at: "2026-09-12T12:00:00Z",
    updated_at: "2026-09-12T12:05:00Z",
    created_by: { principal_id: "principal-fixture" },
    updated_by: { principal_id: "principal-fixture" },
  },
  {
    workstream_id: "ws-follow-on",
    owner_id: "owner-fixture",
    name: "Summary follow-on",
    lifecycle: "planned",
    progress: { state: "waiting", condition: "Core v1 acceptance" },
    delivery: "none-observed",
    freshness: "unknown",
    sort_order: 20,
    version: 1,
    created_at: "2026-09-12T12:01:00Z",
    updated_at: "2026-09-12T12:01:00Z",
    created_by: { principal_id: "principal-fixture" },
    updated_by: { principal_id: "principal-fixture" },
  },
];

export interface SyntheticWorkstreamTransportOptions {
  readonly offline?: boolean;
  readonly manifestSha256?: string;
  readonly permissions?: ReadonlyArray<"workstreams:read" | "workstreams:write">;
}

export const makeSyntheticWorkstreamTransport = (
  options: SyntheticWorkstreamTransportOptions = {},
): WorkstreamTransport => {
  const context = {
    owner_id: "owner-fixture",
    server_generation: 7,
    registry_version: 11,
  } as const;
  const unavailable = (operation: "capabilities" | "list" | "command") =>
    Effect.fail(
      new WorkstreamTransportError({
        operation,
        effect: "no-effect",
        detail: "Synthetic transport is offline.",
      }),
    );

  return {
    getCapabilities: () => {
      if (options.offline === true) return unavailable("capabilities");
      return Effect.succeed({
        contract_family: WORKSTREAM_CONTRACT_FAMILY,
        contract_version: WORKSTREAM_CONTRACT_VERSION,
        manifest_sha256: options.manifestSha256 ?? WORKSTREAM_CONTRACT_MANIFEST_SHA256,
        context,
        permissions: options.permissions ?? ["workstreams:read", "workstreams:write"],
        max_page_items: 100,
      } satisfies WorkstreamCapabilities);
    },
    listWorkstreams: ({ limit, cursor }) => {
      if (options.offline === true) return unavailable("list");
      const offset = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
      const items = SYNTHETIC_WORKSTREAMS.slice(offset, offset + limit);
      const nextOffset = offset + items.length;
      return Effect.succeed({
        context,
        items,
        next_cursor: nextOffset < SYNTHETIC_WORKSTREAMS.length ? String(nextOffset) : null,
      } satisfies WorkstreamPage);
    },
    submitCommand: ({ body, command }) => {
      if (options.offline === true) return unavailable("command");
      return Effect.succeed(makeSyntheticReceipt(command, body));
    },
  };
};

const makeSyntheticReceipt = (
  command: WorkstreamCommand,
  body: string,
): CommittedWorkstreamReceipt => {
  const coordination =
    command.action.operation === "set_coordination_disposition"
      ? {
          membership_id: String(command.action.membership_id),
          disposition: "completed" as const,
        }
      : null;
  const nativeSettlement =
    command.action.operation === "request_native_t3_settlement"
      ? {
          native_reference_id: String(command.action.native_reference_id),
          native_action: "settle" as const,
          outcome: "committed" as const,
        }
      : null;

  return {
    command_id: command.command_id,
    owner_id: "owner-fixture",
    actor: { principal_id: "principal-fixture" },
    operation: command.action.operation,
    request_sha256: createHash("sha256").update(body).digest("hex"),
    server_generation: 7,
    accepted_at: "2026-09-12T12:10:00Z",
    state: "committed",
    completed_at: "2026-09-12T12:10:00Z",
    registry_version: 12,
    changed: true,
    effects: {
      workstream_versions: [],
      native_reference_id: null,
      membership_ids: [],
      declaration_id: null,
      declaration_revision: null,
      edge_id: null,
      observation: null,
      registration: null,
      lifecycle_declaration: null,
      coordination_disposition: coordination,
      native_settlement: nativeSettlement,
    },
  };
};
