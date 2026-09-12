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

export const nativeWorkstreamThreadKey = (environmentId: string, threadId: string) =>
  JSON.stringify([environmentId, threadId]);

// This is the sole T3 activation convention. Other provider/resource identities remain unassigned.
export interface TrustedT3EnvironmentAttestation {
  readonly authorityNamespace: string;
  readonly storeGeneration: number;
}

function nativeThreadKey(
  reference: NativeReference,
  trustedNowMs: number,
  trustedEnvironments: ReadonlyMap<string, TrustedT3EnvironmentAttestation>,
): string | null {
  const identity = reference.identity;
  const registration = reference.registration;
  const evidence = registration.evidence;
  const trustedEnvironment = trustedEnvironments.get(identity.source_instance_id);
  if (
    identity.provider !== "t3" ||
    identity.resource_kind !== "thread" ||
    identity.id_kind !== "internal" ||
    identity.account_provenance.kind !== "not_account_scoped" ||
    registration.state !== "attested" ||
    registration.expires_at === null ||
    Date.parse(registration.expires_at) <= trustedNowMs ||
    evidence === null ||
    trustedEnvironment === undefined ||
    evidence.provider !== identity.provider ||
    evidence.source_instance_id !== identity.source_instance_id ||
    evidence.authority_namespace !== trustedEnvironment.authorityNamespace ||
    evidence.native_id !== identity.native_id ||
    evidence.store_generation !== trustedEnvironment.storeGeneration
  )
    return null;
  return nativeWorkstreamThreadKey(identity.source_instance_id, identity.native_id);
}

export function groupNativeThreadsByWorkstream<Thread extends WorkstreamThreadLike>(input: {
  readonly workstreams: readonly T3WorkstreamMetadata[];
  readonly memberships: readonly MembershipEpisode[];
  readonly references: readonly NativeReference[];
  readonly threads: readonly Thread[];
  readonly trustedNow: string;
  readonly trustedEnvironments: ReadonlyMap<string, TrustedT3EnvironmentAttestation>;
}): NativeWorkstreamThreadGrouping<Thread> {
  const trustedNowMs = Date.parse(input.trustedNow);
  const referenceKeys = new Map<string, string>();
  for (const reference of input.references) {
    const key = Number.isFinite(trustedNowMs)
      ? nativeThreadKey(reference, trustedNowMs, input.trustedEnvironments)
      : null;
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
    const key = nativeWorkstreamThreadKey(thread.environmentId, thread.id);
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
