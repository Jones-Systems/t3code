import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";

export const T3_PLACEMENT_ROUTE = "/workstreams/internal/v1/t3-thread-placements";
export const T3_PLACEMENT_CONTRACT = "workstreams-t3-placement/1.0.0";
export const T3_PLACEMENT_MANIFEST_SHA256 =
  "dde160d40e17ee0ad206f242a4eeac4b714fd801236f45fdc2ee824256ab89ca";
const Id = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/));
const NativeId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(512),
  Schema.isPattern(/^[^\u0000-\u001f\u007f]+$/),
);
const Positive = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const Timestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/),
  Schema.makeFilter(
    (value) =>
      Number.isFinite(Date.parse(value)) &&
      DateTime.formatIso(DateTime.makeUnsafe(value)).slice(0, 19) === value.slice(0, 19),
  ),
);
const Cursor = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,2048}$/));

export const T3PlacementContext = Schema.Struct({
  owner_id: Id,
  principal_id: Id,
  authorization_revision: Positive,
  server_generation: Positive,
  registry_version: Schema.Number.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  ),
});
export type T3PlacementContext = typeof T3PlacementContext.Type;
export const T3ThreadPlacement = Schema.Struct({
  membership_id: Id,
  workstream_id: Id,
  native_reference_id: Id,
  kind: Schema.Literals(["primary", "secondary"]),
  source_instance_id: Id,
  native_thread_id: NativeId,
  attestation_version: Positive,
  attested_at: Timestamp,
  expires_at: Timestamp,
  evidence_sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  source_binding_version: Positive,
  authority_namespace: NativeId,
  store_generation: Positive,
});
export type T3ThreadPlacement = typeof T3ThreadPlacement.Type;
export const T3PlacementPage = Schema.Struct({
  context: T3PlacementContext,
  items: Schema.Array(T3ThreadPlacement).check(Schema.isMaxLength(100)),
  next_cursor: Schema.NullOr(Cursor),
});
export type T3PlacementPage = typeof T3PlacementPage.Type;
export const TrustedT3PlacementEnvironment = Schema.Struct({
  environmentId: Id,
  authorityNamespace: NativeId,
  storeGeneration: Positive,
});
export type TrustedT3PlacementEnvironment = typeof TrustedT3PlacementEnvironment.Type;
export const T3PlacementResult = Schema.Struct({
  page: T3PlacementPage,
  trustedEnvironments: Schema.Array(TrustedT3PlacementEnvironment).check(Schema.isMaxLength(100)),
  readiness: Schema.Literals(["ready", "trust-provider-required"]),
});
export type T3PlacementResult = typeof T3PlacementResult.Type;
export const T3PlacementQuery = {
  limit: Schema.optional(
    Schema.FiniteFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 })),
  ),
  cursor: Schema.optional(Cursor),
};
