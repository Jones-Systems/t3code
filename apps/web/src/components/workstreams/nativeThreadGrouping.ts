import type { MembershipEpisode, NativeReference, T3WorkstreamMetadata } from "@t3tools/contracts";

export interface WorkstreamThreadLike {
  readonly environmentId: string;
  readonly id: string;
}

export interface NativeWorkstreamThreadGroup<Thread extends WorkstreamThreadLike> {
  readonly workstream: T3WorkstreamMetadata;
  readonly threads: readonly Thread[];
}

export interface NativeWorkstreamThreadGrouping<Thread extends WorkstreamThreadLike> {
  readonly groups: readonly NativeWorkstreamThreadGroup<Thread>[];
  readonly ungrouped: readonly Thread[];
  readonly ordered: readonly Thread[];
  readonly groupedKeys: ReadonlySet<string>;
  readonly secondaryWorkstreamIdsByKey: ReadonlyMap<string, readonly string[]>;
  readonly conflictingKeys: ReadonlySet<string>;
}

const keyOf = (environmentId: string, threadId: string) => `${environmentId}:${threadId}`;

// This is the sole T3 activation convention. Other provider/resource identities remain unassigned.
function nativeThreadKey(reference: NativeReference): string | null {
  const identity = reference.identity;
  return identity.provider === "t3" && identity.resource_kind === "thread"
    ? keyOf(identity.source_instance_id, identity.native_id)
    : null;
}

export function groupNativeThreadsByWorkstream<Thread extends WorkstreamThreadLike>(input: {
  readonly workstreams: readonly T3WorkstreamMetadata[];
  readonly memberships: readonly MembershipEpisode[];
  readonly references: readonly NativeReference[];
  readonly threads: readonly Thread[];
}): NativeWorkstreamThreadGrouping<Thread> {
  const referenceKeys = new Map<string, string>();
  for (const reference of input.references) {
    const key = nativeThreadKey(reference);
    if (key !== null) referenceKeys.set(reference.native_reference_id, key);
  }

  const primaryByKey = new Map<string, string>();
  const secondaryByKey = new Map<string, string[]>();
  const conflictingKeys = new Set<string>();
  for (const membership of input.memberships) {
    if (membership.closed !== null) continue;
    const key = referenceKeys.get(membership.native_reference_id);
    if (key === undefined) continue;
    if (membership.kind === "secondary") {
      const current = secondaryByKey.get(key) ?? [];
      if (!current.includes(membership.workstream_id)) current.push(membership.workstream_id);
      secondaryByKey.set(key, current);
      continue;
    }
    const existing = primaryByKey.get(key);
    if (existing !== undefined && existing !== membership.workstream_id) {
      conflictingKeys.add(key);
      primaryByKey.delete(key);
    } else if (!conflictingKeys.has(key)) {
      primaryByKey.set(key, membership.workstream_id);
    }
  }

  const threadsByWorkstream = new Map<string, Thread[]>();
  const groupedKeys = new Set<string>();
  const ungrouped: Thread[] = [];
  for (const thread of input.threads) {
    const key = keyOf(thread.environmentId, thread.id);
    const workstreamId = primaryByKey.get(key);
    if (workstreamId === undefined || conflictingKeys.has(key)) {
      ungrouped.push(thread);
      continue;
    }
    const bucket = threadsByWorkstream.get(workstreamId);
    if (bucket === undefined) threadsByWorkstream.set(workstreamId, [thread]);
    else bucket.push(thread);
    groupedKeys.add(key);
  }

  const groups = input.workstreams.flatMap((workstream) => {
    const threads = threadsByWorkstream.get(workstream.workstreamId);
    return threads === undefined || threads.length === 0 ? [] : [{ workstream, threads }];
  });
  return {
    groups,
    ungrouped,
    ordered: [...groups.flatMap((group) => group.threads), ...ungrouped],
    groupedKeys,
    secondaryWorkstreamIdsByKey: secondaryByKey,
    conflictingKeys,
  };
}
