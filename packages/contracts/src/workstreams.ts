import * as Schema from "effect/Schema";

export const WORKSTREAM_CONTRACT_FAMILY = "workstreams" as const;
export const WORKSTREAM_CONTRACT_VERSION = "1.0.0" as const;
export const WORKSTREAM_CONTRACT_HEADER_VERSION = "workstreams/1.0.0" as const;
export const WORKSTREAM_CONTRACT_MANIFEST_SHA256 =
  "a03e34613ea1293b579316a21f98d4edd69a19221f9907cf0449e3b4933420dd" as const;
export const WORKSTREAM_MAX_PAGE_ITEMS = 100;
export const WORKSTREAM_MAX_RESPONSE_BYTES = 1_048_576;

export const WorkstreamLifecycle = Schema.Literals([
  "planned",
  "active",
  "paused",
  "completed",
  "deferred",
  "abandoned",
]);
export type WorkstreamLifecycle = typeof WorkstreamLifecycle.Type;

export const WorkstreamProgress = Schema.Union([
  Schema.Struct({ state: Schema.Literals(["progressing", "unknown", "stale"]) }),
  Schema.Struct({ state: Schema.Literal("waiting"), condition: Schema.String }),
  Schema.Struct({ state: Schema.Literal("blocked"), impediment: Schema.String }),
]);
export type WorkstreamProgress = typeof WorkstreamProgress.Type;

export const WorkstreamDelivery = Schema.Literals([
  "none-observed",
  "branch-open",
  "pr-open",
  "merged",
  "released",
  "deployed",
  "deployment-verified",
  "failed",
  "unknown",
  "stale",
]);
export type WorkstreamDelivery = typeof WorkstreamDelivery.Type;

export const WorkstreamFreshness = Schema.Literals([
  "current",
  "stale",
  "inaccessible",
  "partial-coverage",
  "conflicting",
  "unknown",
]);
export type WorkstreamFreshness = typeof WorkstreamFreshness.Type;

export const WorkstreamActor = Schema.Struct({ principal_id: Schema.String });
export type WorkstreamActor = typeof WorkstreamActor.Type;

export const WorkstreamReadContext = Schema.Struct({
  owner_id: Schema.String,
  server_generation: Schema.Number,
  registry_version: Schema.Number,
});
export type WorkstreamReadContext = typeof WorkstreamReadContext.Type;

export const Workstream = Schema.Struct({
  workstream_id: Schema.String,
  owner_id: Schema.String,
  name: Schema.String,
  lifecycle: WorkstreamLifecycle,
  progress: WorkstreamProgress,
  delivery: WorkstreamDelivery,
  freshness: WorkstreamFreshness,
  sort_order: Schema.Number,
  version: Schema.Number,
  created_at: Schema.String,
  updated_at: Schema.String,
  created_by: WorkstreamActor,
  updated_by: WorkstreamActor,
});
export type Workstream = typeof Workstream.Type;

export const AccountProvenance = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("account"),
    account_id: Schema.String,
    account_namespace: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("not_account_scoped") }),
]);

export const WorkstreamPrLocator = Schema.Struct({
  host: Schema.Literal("github.com"),
  repository_owner: Schema.String,
  repository_name: Schema.String,
  number: Schema.Number,
});
export type WorkstreamPrLocator = typeof WorkstreamPrLocator.Type;

export function canonicalGitHubPullRequestUrl(locator: WorkstreamPrLocator): string {
  if (
    !/^[A-Za-z0-9_.-]+$/.test(locator.repository_owner) ||
    !/^[A-Za-z0-9_.-]+$/.test(locator.repository_name) ||
    locator.repository_owner === "." ||
    locator.repository_owner === ".." ||
    locator.repository_name === "." ||
    locator.repository_name === ".." ||
    locator.repository_owner.length > 100 ||
    locator.repository_name.length > 100 ||
    !Number.isSafeInteger(locator.number) ||
    locator.number < 1
  ) {
    throw new Error("Invalid GitHub pull-request locator");
  }
  return `https://github.com/${locator.repository_owner}/${locator.repository_name}/pull/${locator.number}`;
}

export const NativeReference = Schema.Struct({
  native_reference_id: Schema.String,
  owner_id: Schema.String,
  identity: Schema.Struct({
    provider: Schema.String,
    source_instance_id: Schema.String,
    resource_kind: Schema.String,
    id_kind: Schema.Literals(["internal", "external"]),
    native_id: Schema.String,
    account_provenance: AccountProvenance,
  }),
  pr_locator: Schema.NullOr(WorkstreamPrLocator),
  registration: Schema.Struct({
    state: Schema.Literals([
      "quarantined",
      "verification-pending",
      "attested",
      "verification-failed",
      "expired",
      "re-attestation-required",
    ]),
    attestation_version: Schema.Number,
    attested_at: Schema.NullOr(Schema.String),
    expires_at: Schema.NullOr(Schema.String),
    evidence: Schema.NullOr(Schema.Unknown),
  }),
  created_at: Schema.String,
  created_by: WorkstreamActor,
  created_registry_version: Schema.Number,
});
export type NativeReference = typeof NativeReference.Type;

const EpisodeBoundary = Schema.Struct({
  at: Schema.String,
  actor: WorkstreamActor,
  command_id: Schema.String,
  registry_version: Schema.Number,
});
export const MembershipEpisode = Schema.Struct({
  membership_id: Schema.String,
  workstream_id: Schema.String,
  native_reference_id: Schema.String,
  kind: Schema.Literals(["primary", "secondary"]),
  opened: EpisodeBoundary,
  closed: Schema.NullOr(
    Schema.Struct({
      ...EpisodeBoundary.fields,
      reason: Schema.Literals([
        "removed",
        "completed",
        "completed-and-delivery-verified",
        "superseded",
        "continued-elsewhere",
        "deferred",
        "abandoned",
        "other",
      ]),
      other_reason: Schema.NullOr(Schema.String),
    }),
  ),
});
export type MembershipEpisode = typeof MembershipEpisode.Type;

export const DeclarationRevision = Schema.Struct({
  declaration_id: Schema.String,
  workstream_id: Schema.String,
  revision: Schema.Number,
  text: Schema.String,
  state: Schema.Literals(["active", "withdrawn"]),
  recorded_at: Schema.String,
  actor: WorkstreamActor,
  command_id: Schema.String,
  registry_version: Schema.Number,
});
export type DeclarationRevision = typeof DeclarationRevision.Type;

export const WorkstreamEdge = Schema.Struct({
  edge_id: Schema.String,
  from_workstream_id: Schema.String,
  to_workstream_id: Schema.String,
  relation: Schema.Literals(["continues_as", "superseded_by"]),
  opened: EpisodeBoundary,
  closed: Schema.NullOr(EpisodeBoundary),
});
export type WorkstreamEdge = typeof WorkstreamEdge.Type;

export const WorkstreamLifecycleDeclaration = Schema.Struct({
  lifecycle_declaration_id: Schema.String,
  workstream_id: Schema.String,
  revision: Schema.Number,
  prior_lifecycle: Schema.NullOr(WorkstreamLifecycle),
  new_lifecycle: WorkstreamLifecycle,
  recorded_at: Schema.String,
  actor: WorkstreamActor,
  command_id: Schema.String,
  supersedes_lifecycle_declaration_id: Schema.NullOr(Schema.String),
  registry_version: Schema.Number,
});

export const WorkstreamOperation = Schema.Literals([
  "create_workstream",
  "update_workstream",
  "register_reference",
  "verify_reference",
  "attach_primary",
  "reattach_primary",
  "link_secondary",
  "remove_membership",
  "move_primary",
  "set_coordination_disposition",
  "request_native_t3_settlement",
  "set_declaration",
  "withdraw_declaration",
  "add_edge",
  "remove_edge",
  "refresh_linked_pr",
]);
export type WorkstreamOperation = typeof WorkstreamOperation.Type;

const CreateWorkstreamAction = Schema.Struct({
  operation: Schema.Literal("create_workstream"),
  name: Schema.String,
  lifecycle: WorkstreamLifecycle,
  progress: WorkstreamProgress,
  sort_order: Schema.Number,
});
const UpdateWorkstreamAction = Schema.Struct({
  operation: Schema.Literal("update_workstream"),
  workstream_id: Schema.String,
  expected_version: Schema.Number,
  name: Schema.String,
  lifecycle: WorkstreamLifecycle,
  progress: WorkstreamProgress,
  sort_order: Schema.Number,
});
const RegisterReferenceAction = Schema.Struct({
  operation: Schema.Literal("register_reference"),
  identity: NativeReference.fields.identity,
  pr_locator: Schema.NullOr(WorkstreamPrLocator),
});
const VerifyReferenceAction = Schema.Struct({
  operation: Schema.Literal("verify_reference"),
  native_reference_id: Schema.String,
  expected_attestation_version: Schema.Number,
});
const AttachPrimaryAction = Schema.Struct({
  operation: Schema.Literals(["attach_primary", "reattach_primary"]),
  workstream_id: Schema.String,
  expected_version: Schema.Number,
  native_reference_id: Schema.String,
});
const LinkSecondaryAction = Schema.Struct({
  operation: Schema.Literal("link_secondary"),
  workstream_id: Schema.String,
  expected_version: Schema.Number,
  native_reference_id: Schema.String,
});
const RemoveMembershipAction = Schema.Struct({
  operation: Schema.Literal("remove_membership"),
  workstream_id: Schema.String,
  expected_version: Schema.Number,
  membership_id: Schema.String,
});
const MovePrimaryAction = Schema.Struct({
  operation: Schema.Literal("move_primary"),
  source_workstream_id: Schema.String,
  expected_source_version: Schema.Number,
  source_membership_id: Schema.String,
  destination_workstream_id: Schema.String,
  expected_destination_version: Schema.Number,
});
const SetDispositionAction = Schema.Struct({
  operation: Schema.Literal("set_coordination_disposition"),
  workstream_id: Schema.String,
  expected_version: Schema.Number,
  membership_id: Schema.String,
  disposition: Schema.Literals([
    "completed",
    "completed-and-delivery-verified",
    "superseded",
    "continued-elsewhere",
    "deferred",
    "abandoned",
    "other",
  ]),
  other_disposition: Schema.NullOr(Schema.String),
});
const NativeSettlementAction = Schema.Struct({
  operation: Schema.Literal("request_native_t3_settlement"),
  native_reference_id: Schema.String,
  expected_attestation_version: Schema.Number,
  native_action: Schema.Literals(["settle", "unsettle"]),
});
const SetDeclarationAction = Schema.Struct({
  operation: Schema.Literal("set_declaration"),
  workstream_id: Schema.String,
  expected_version: Schema.Number,
  declaration_id: Schema.NullOr(Schema.String),
  expected_revision: Schema.Number,
  text: Schema.String,
});
const WithdrawDeclarationAction = Schema.Struct({
  operation: Schema.Literal("withdraw_declaration"),
  workstream_id: Schema.String,
  expected_version: Schema.Number,
  declaration_id: Schema.String,
  expected_revision: Schema.Number,
});
const AddEdgeAction = Schema.Struct({
  operation: Schema.Literal("add_edge"),
  from_workstream_id: Schema.String,
  expected_from_version: Schema.Number,
  to_workstream_id: Schema.String,
  expected_to_version: Schema.Number,
  relation: Schema.Literals(["continues_as", "superseded_by"]),
});
const RemoveEdgeAction = Schema.Struct({
  operation: Schema.Literal("remove_edge"),
  edge_id: Schema.String,
  from_workstream_id: Schema.String,
  expected_from_version: Schema.Number,
  to_workstream_id: Schema.String,
  expected_to_version: Schema.Number,
});
const RefreshLinkedPrAction = Schema.Struct({
  operation: Schema.Literal("refresh_linked_pr"),
  workstream_id: Schema.String,
  expected_version: Schema.Number,
  membership_id: Schema.String,
  expected_observation_version: Schema.Number,
});
export const WorkstreamAction = Schema.Union([
  CreateWorkstreamAction,
  UpdateWorkstreamAction,
  RegisterReferenceAction,
  VerifyReferenceAction,
  AttachPrimaryAction,
  LinkSecondaryAction,
  RemoveMembershipAction,
  MovePrimaryAction,
  SetDispositionAction,
  NativeSettlementAction,
  SetDeclarationAction,
  WithdrawDeclarationAction,
  AddEdgeAction,
  RemoveEdgeAction,
  RefreshLinkedPrAction,
]);
export const WorkstreamCommand = Schema.Struct({
  command_id: Schema.String,
  expected_server_generation: Schema.Number,
  expected_registry_version: Schema.Number,
  action: WorkstreamAction,
});
export type WorkstreamCommand = typeof WorkstreamCommand.Type;

const ReceiptBase = {
  command_id: Schema.String,
  owner_id: Schema.String,
  actor: WorkstreamActor,
  operation: WorkstreamOperation,
  request_sha256: Schema.String,
  server_generation: Schema.Number,
  accepted_at: Schema.String,
};
const WorkstreamReceiptEffects = Schema.Struct({
  workstream_versions: Schema.Array(
    Schema.Struct({ workstream_id: Schema.String, version: Schema.Number }),
  ),
  native_reference_id: Schema.NullOr(Schema.String),
  membership_ids: Schema.Array(Schema.String),
  declaration_id: Schema.NullOr(Schema.String),
  declaration_revision: Schema.NullOr(Schema.Number),
  edge_id: Schema.NullOr(Schema.String),
  observation: Schema.NullOr(Schema.Unknown),
  registration: Schema.NullOr(Schema.Unknown),
  lifecycle_declaration: Schema.NullOr(WorkstreamLifecycleDeclaration),
  coordination_disposition: Schema.NullOr(
    Schema.Struct({ membership_id: Schema.String, disposition: Schema.String }),
  ),
  native_settlement: Schema.NullOr(
    Schema.Struct({
      native_reference_id: Schema.String,
      native_action: Schema.Literals(["settle", "unsettle"]),
      outcome: Schema.Literals(["committed", "denied", "unsupported", "failed", "unresolved"]),
    }),
  ),
});
export const WorkstreamReceipt = Schema.Union([
  Schema.Struct({
    ...ReceiptBase,
    state: Schema.Literal("committed"),
    completed_at: Schema.String,
    registry_version: Schema.Number,
    changed: Schema.Boolean,
    effects: WorkstreamReceiptEffects,
  }),
  Schema.Struct({
    ...ReceiptBase,
    state: Schema.Literals(["pending", "unresolved"]),
    retry_after_seconds: Schema.Number,
  }),
  Schema.Struct({
    ...ReceiptBase,
    state: Schema.Literal("rejected"),
    completed_at: Schema.String,
    error: Schema.Struct({ code: Schema.String }),
  }),
]);
export type WorkstreamReceipt = typeof WorkstreamReceipt.Type;

export const WorkstreamCapabilities = Schema.Struct({
  contract_family: Schema.Literal(WORKSTREAM_CONTRACT_FAMILY),
  contract_version: Schema.Literal(WORKSTREAM_CONTRACT_VERSION),
  manifest_sha256: Schema.String,
  context: WorkstreamReadContext,
  permissions: Schema.Array(Schema.Literals(["workstreams:read", "workstreams:write"])),
  max_request_bytes: Schema.optional(Schema.Number),
  max_response_bytes: Schema.optional(Schema.Number),
  max_json_depth: Schema.optional(Schema.Number),
  max_page_items: Schema.Number,
  max_pr_response_bytes: Schema.optional(Schema.Number),
  max_pr_request_seconds: Schema.optional(Schema.Number),
  cursor_ttl_seconds: Schema.optional(Schema.Number),
});
export type WorkstreamCapabilities = typeof WorkstreamCapabilities.Type;

const page = <Item extends Schema.Top>(item: Item) =>
  Schema.Struct({
    context: WorkstreamReadContext,
    items: Schema.Array(item),
    next_cursor: Schema.NullOr(Schema.String),
  });
export const WorkstreamPage = page(Workstream);
export const WorkstreamReferencePage = page(NativeReference);
export const WorkstreamMembershipPage = page(MembershipEpisode);
export const WorkstreamDeclarationPage = page(DeclarationRevision);
export const WorkstreamEdgePage = page(WorkstreamEdge);
export const WorkstreamHistoryPage = page(
  Schema.Struct({
    event_id: Schema.String,
    command_id: Schema.String,
    actor: WorkstreamActor,
    operation: WorkstreamOperation,
    occurred_at: Schema.String,
    registry_version: Schema.Number,
    changed: Schema.Boolean,
    workstream_versions: Schema.Array(
      Schema.Struct({ workstream_id: Schema.String, version: Schema.Number }),
    ),
    native_reference_id: Schema.NullOr(Schema.String),
    membership_ids: Schema.Array(Schema.String),
    declaration_id: Schema.NullOr(Schema.String),
    declaration_revision: Schema.NullOr(Schema.Number),
    edge_id: Schema.NullOr(Schema.String),
    lifecycle_declaration: Schema.NullOr(WorkstreamLifecycleDeclaration),
  }),
);
export type WorkstreamPage = typeof WorkstreamPage.Type;
export type WorkstreamReferencePage = typeof WorkstreamReferencePage.Type;
export type WorkstreamMembershipPage = typeof WorkstreamMembershipPage.Type;
export type WorkstreamDeclarationPage = typeof WorkstreamDeclarationPage.Type;
export type WorkstreamEdgePage = typeof WorkstreamEdgePage.Type;
export type WorkstreamHistoryPage = typeof WorkstreamHistoryPage.Type;

export const WorkstreamDetail = Schema.Struct({
  context: WorkstreamReadContext,
  workstream: Workstream,
});
export type WorkstreamDetail = typeof WorkstreamDetail.Type;
export const WorkstreamReferenceDetail = Schema.Struct({
  context: WorkstreamReadContext,
  reference: NativeReference,
  latest_observation: Schema.NullOr(Schema.Unknown),
});

export const WorkstreamSession = Schema.Struct({
  context: WorkstreamReadContext,
  permissions: Schema.Array(Schema.Literals(["workstreams:read", "workstreams:write"])),
  csrf_token: Schema.String,
  csrf_ttl_seconds: Schema.Number,
});

export const T3WorkstreamBinding = Schema.Struct({
  registryId: Schema.String,
  ownerId: Schema.String,
  principalId: Schema.String,
  authorizationRevision: Schema.Number,
  serverGeneration: Schema.Number,
  registryVersion: Schema.Number,
  permissions: Schema.Array(Schema.Literals(["workstreams:read", "workstreams:write"])),
  contractVersion: Schema.Literal(WORKSTREAM_CONTRACT_HEADER_VERSION),
  contractManifest: Schema.Literal(WORKSTREAM_CONTRACT_MANIFEST_SHA256),
});
export type T3WorkstreamBinding = typeof T3WorkstreamBinding.Type;

export const T3WorkstreamMetadata = Schema.Struct({
  workstreamId: Schema.String,
  name: Schema.String,
  lifecycle: WorkstreamLifecycle,
  progress: WorkstreamProgress,
  delivery: WorkstreamDelivery,
  freshness: WorkstreamFreshness,
  sortOrder: Schema.Number,
  version: Schema.Number,
  updatedAt: Schema.String,
});
export type T3WorkstreamMetadata = typeof T3WorkstreamMetadata.Type;

export const T3WorkstreamListResult = Schema.Struct({
  binding: T3WorkstreamBinding,
  items: Schema.Array(T3WorkstreamMetadata),
  nextCursor: Schema.NullOr(Schema.String),
  source: Schema.Literals(["live", "cache"]),
  stale: Schema.Boolean,
});
export type T3WorkstreamListResult = typeof T3WorkstreamListResult.Type;

export const T3WorkstreamListQuery = {
  limit: Schema.optional(
    Schema.FiniteFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 })),
  ),
  cursor: Schema.optional(Schema.String),
};

export const T3WorkstreamCommandRequest = Schema.Struct({ command: WorkstreamCommand });
export const T3WorkstreamCommandPollParams = Schema.Struct({ commandId: Schema.String });
export const T3WorkstreamDetailParams = Schema.Struct({ workstreamId: Schema.String });
export const T3WorkstreamPageQuery = T3WorkstreamListQuery;
