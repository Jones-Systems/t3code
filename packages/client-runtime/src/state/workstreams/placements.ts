import {
  T3PlacementResult,
  type T3ThreadPlacement,
  type T3WorkstreamListResult,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export interface LiveT3Placements {
  readonly context: T3PlacementResult["page"]["context"];
  readonly items: readonly T3ThreadPlacement[];
  readonly trustedEnvironments: T3PlacementResult["trustedEnvironments"];
  readonly readiness: T3PlacementResult["readiness"];
}

export const currentT3Placement = (item: T3ThreadPlacement, now: number): boolean =>
  Number.isFinite(now) &&
  Number.isFinite(Date.parse(item.attested_at)) &&
  Date.parse(item.attested_at) <= now &&
  Date.parse(item.expires_at) > now &&
  Date.parse(item.expires_at) > Date.parse(item.attested_at);

export async function loadLiveT3Placements(
  metadata: T3WorkstreamListResult,
  load: (cursor?: string) => Promise<T3PlacementResult>,
  now: () => number = Date.now,
): Promise<LiveT3Placements> {
  if (metadata.source !== "live" || metadata.stale || metadata.nextCursor !== null)
    throw new Error("Placement metadata is not current.");
  const items: T3ThreadPlacement[] = [];
  const cursors = new Set<string>();
  const memberships = new Set<string>();
  const referenceRouting = new Map<string, string>();
  let snapshot: LiveT3Placements | undefined;
  let cursor: string | undefined;
  let previous: readonly [string, string] | undefined;
  for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
    const result = Schema.decodeUnknownSync(T3PlacementResult)(await load(cursor), {
      onExcessProperty: "error",
    });
    const { page } = result;
    const { binding } = metadata;
    if (
      page.context.owner_id !== binding.ownerId ||
      page.context.principal_id !== binding.principalId ||
      page.context.authorization_revision !== binding.authorizationRevision ||
      page.context.server_generation !== binding.serverGeneration ||
      page.context.registry_version !== binding.registryVersion
    )
      throw new Error("Placement revision changed.");
    const environmentIds = new Set(result.trustedEnvironments.map((value) => value.environmentId));
    if (
      environmentIds.size !== result.trustedEnvironments.length ||
      (result.readiness === "trust-provider-required" && result.trustedEnvironments.length !== 0)
    )
      throw new Error("Invalid placement trust snapshot.");
    if (
      snapshot &&
      (snapshot.readiness !== result.readiness ||
        JSON.stringify(snapshot.trustedEnvironments) !== JSON.stringify(result.trustedEnvironments))
    )
      throw new Error("Placement trust changed.");
    snapshot ??= {
      context: page.context,
      items,
      trustedEnvironments: result.trustedEnvironments,
      readiness: result.readiness,
    };
    for (const item of page.items) {
      if (!currentT3Placement(item, now()) || memberships.has(item.membership_id))
        throw new Error("Stale or repeated placement.");
      const tuple = [item.native_reference_id, item.membership_id] as const;
      if (
        previous &&
        (tuple[0] < previous[0] || (tuple[0] === previous[0] && tuple[1] <= previous[1]))
      )
        throw new Error("Placement order changed.");
      previous = tuple;
      const {
        membership_id: _membership,
        workstream_id: _workstream,
        kind: _kind,
        ...routing
      } = item;
      const serialized = JSON.stringify(routing);
      const priorRouting = referenceRouting.get(item.native_reference_id);
      if (priorRouting !== undefined && priorRouting !== serialized)
        throw new Error("Placement reference changed.");
      referenceRouting.set(item.native_reference_id, serialized);
      memberships.add(item.membership_id);
      items.push(item);
    }
    if (page.next_cursor === null) {
      if (items.some((item) => !currentT3Placement(item, now())))
        throw new Error("Placement expired while loading.");
      return snapshot;
    }
    if (cursors.has(page.next_cursor)) throw new Error("Placement cursor repeated.");
    cursor = page.next_cursor;
    cursors.add(cursor);
  }
  throw new Error("Placement page workload exceeded.");
}
