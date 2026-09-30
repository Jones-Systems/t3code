/**
 * Merges per-environment usage summaries into the single view the page renders.
 *
 * Pure, so the de-duplication and derivation rules can be tested without a
 * connected environment.
 *
 * @module usageMerge
 */
import {
  USAGE_MERGE_COMPATIBLE_SINCE,
  type EnvironmentId,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type UsageBucket,
  type UsageProviderKind,
  type UsageSourceFingerprint,
  type UsageSummary,
  type UsageTokenTotals,
} from "@t3tools/contracts";

export type UsageProviderFilter = UsageProviderKind | readonly UsageProviderKind[];

export interface UsageInstanceSelection {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
}

export type UsageInstanceFilter = readonly UsageInstanceSelection[];

export interface UsageInstanceOption {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly coverage: "supported" | "unsupported" | "unavailable";
  readonly message: string | null;
  readonly sharedWith: readonly string[];
}

export interface EnvironmentUsage {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly summary: UsageSummary;
}

export interface ProviderTotals {
  readonly provider: UsageProviderKind;
  readonly costUsd: number;
  readonly cacheSavingsUsd: number;
  readonly totals: UsageTokenTotals;
  readonly totalTokens: number;
  readonly records: number;
  readonly unpricedRecords: number;
  readonly sessions: number;
  readonly costShare: number;
  readonly tokenShare: number;
}

export interface ModelTotals {
  readonly model: string;
  readonly provider: UsageProviderKind;
  readonly costUsd: number;
  readonly cacheSavingsUsd: number;
  readonly totals: UsageTokenTotals;
  readonly totalTokens: number;
  readonly records: number;
  readonly unpricedRecords: number;
  readonly costShare: number;
}

export interface DailyTotals {
  readonly day: string;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly byProvider: ReadonlyMap<UsageProviderKind, { costUsd: number; totalTokens: number }>;
}

export interface HourlyTotals {
  readonly day: string;
  readonly hourStart: string;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly byProvider: ReadonlyMap<UsageProviderKind, { costUsd: number; totalTokens: number }>;
}

export interface CostQuality {
  readonly providerReportedShare: number;
  readonly modelPricedShare: number;
  readonly unpricedShare: number;
  readonly cacheSavingsUsd: number;
}

export interface MergedUsage {
  readonly costUsd: number;
  readonly uncachedInputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly records: number;
  readonly sessions: number;
  readonly providers: readonly ProviderTotals[];
  readonly models: readonly ModelTotals[];
  readonly daily: readonly DailyTotals[];
  readonly hourly: readonly HourlyTotals[];
  readonly costQuality: CostQuality;
  /** Environments whose data was dropped as a duplicate of another's. */
  readonly duplicateSources: readonly string[];
  readonly contributingEnvironments: readonly EnvironmentId[];
  readonly staleEnvironments: readonly EnvironmentId[];
  readonly instanceOptions: readonly UsageInstanceOption[];
  readonly instanceNotices: readonly string[];
}

type UsageSourceRecord = UsageSummary["sources"][number];
type ProviderInstanceDescriptor = NonNullable<UsageSummary["providerInstances"]>[number];

interface PreparedEnvironmentUsage {
  readonly environment: EnvironmentUsage;
  readonly isModern: boolean;
  readonly sourcesById: ReadonlyMap<string, UsageSourceRecord>;
  readonly instancesById: ReadonlyMap<ProviderInstanceId, ProviderInstanceDescriptor>;
  readonly eligibleSourceIds: ReadonlySet<string>;
  readonly eligibleLegacyProviders: ReadonlySet<UsageProviderKind>;
}

interface SourceOwner {
  readonly environmentId: EnvironmentId;
  readonly isModern: boolean;
  readonly sourceId?: string;
}

type SourceCandidate = {
  readonly prepared: PreparedEnvironmentUsage;
  readonly source: UsageSourceRecord;
  readonly sourceId?: string;
};

function fingerprintKey(fingerprint: UsageSourceFingerprint): string {
  return JSON.stringify([
    fingerprint.hostId,
    fingerprint.provider,
    fingerprint.resolvedHomePath,
    fingerprint.volumeId,
  ]);
}

function instanceSelectionKey(
  environmentId: EnvironmentId,
  instanceId: ProviderInstanceId,
): string {
  return JSON.stringify([environmentId, instanceId]);
}

function hasUsageData(environment: EnvironmentUsage): boolean {
  return (
    environment.summary.buckets.length > 0 ||
    environment.summary.sources.some(
      (source) => source.status !== "missing" && source.distinctSessions > 0,
    )
  );
}

function addInstanceNotice(notices: Set<string>, notice: string): void {
  notices.add(notice);
}

function prepareEnvironments(
  environments: readonly EnvironmentUsage[],
  instanceFilter: UsageInstanceFilter | undefined,
  notices: Set<string>,
): PreparedEnvironmentUsage[] {
  const selectedInstanceKeys =
    instanceFilter === undefined
      ? undefined
      : new Set(
          instanceFilter.map(({ environmentId, instanceId }) =>
            instanceSelectionKey(environmentId, instanceId),
          ),
        );

  return environments.map((environment) => {
    const summary = environment.summary;
    const providerInstances = summary.providerInstances;
    const isModern = providerInstances !== undefined;
    const instancesById = new Map<ProviderInstanceId, ProviderInstanceDescriptor>();
    const ambiguousInstanceIds = new Set<ProviderInstanceId>();
    const instanceCounts = new Map<ProviderInstanceId, number>();

    if (providerInstances !== undefined) {
      for (const instance of providerInstances) {
        instanceCounts.set(instance.instanceId, (instanceCounts.get(instance.instanceId) ?? 0) + 1);
      }
      for (const instance of providerInstances) {
        if (instanceCounts.get(instance.instanceId) === 1) {
          instancesById.set(instance.instanceId, instance);
        } else {
          ambiguousInstanceIds.add(instance.instanceId);
        }
      }
      if (ambiguousInstanceIds.size > 0) {
        addInstanceNotice(
          notices,
          "Some provider-instance options have ambiguous identifiers and were omitted.",
        );
      }
    }

    const sourceCounts = new Map<string, number>();
    let hasSourceWithoutId = false;
    if (isModern) {
      for (const source of summary.sources) {
        if (source.sourceId === undefined || source.sourceId.length === 0) {
          hasSourceWithoutId = true;
        } else {
          sourceCounts.set(source.sourceId, (sourceCounts.get(source.sourceId) ?? 0) + 1);
        }
      }
    }

    const sourcesById = new Map<string, UsageSourceRecord>();
    if (isModern) {
      for (const source of summary.sources) {
        const sourceId = source.sourceId;
        if (sourceId !== undefined && sourceId.length > 0 && sourceCounts.get(sourceId) === 1) {
          sourcesById.set(sourceId, source);
        }
      }
      if (hasSourceWithoutId || [...sourceCounts.values()].some((count) => count > 1)) {
        addInstanceNotice(
          notices,
          "Some transcript sources had missing or ambiguous identifiers and were omitted.",
        );
      }
    } else if (hasUsageData(environment)) {
      addInstanceNotice(
        notices,
        instanceFilter === undefined
          ? "Some legacy usage has no provider-instance attribution and cannot be filtered by instance."
          : "Legacy usage has no provider-instance attribution and was omitted from this selection.",
      );
    }

    const eligibleSourceIds = new Set<string>();
    const eligibleLegacyProviders = new Set<UsageProviderKind>();
    if (isModern) {
      let hasUnattributedUsage = false;
      let hasUnknownInstanceReference = false;
      let hasInvalidBucketReference = false;
      const bucketSourceIds = new Set(
        summary.buckets.flatMap((bucket) =>
          bucket.sourceId === undefined ? [] : [bucket.sourceId],
        ),
      );
      for (const [sourceId, source] of sourcesById) {
        if (source.status === "missing") continue;
        const sourceInstanceIds = source.instanceIds ?? [];
        if (
          sourceInstanceIds.length === 0 &&
          (source.distinctSessions > 0 || bucketSourceIds.has(sourceId))
        ) {
          hasUnattributedUsage = true;
        } else if (sourceInstanceIds.some((instanceId) => !instancesById.has(instanceId))) {
          hasUnknownInstanceReference = true;
        }

        if (
          selectedInstanceKeys === undefined ||
          sourceInstanceIds.some(
            (instanceId) =>
              instancesById.has(instanceId) &&
              selectedInstanceKeys.has(instanceSelectionKey(environment.environmentId, instanceId)),
          )
        ) {
          eligibleSourceIds.add(sourceId);
        }
      }

      for (const bucket of summary.buckets) {
        const sourceId = bucket.sourceId;
        const source = sourceId === undefined ? undefined : sourcesById.get(sourceId);
        if (
          sourceId === undefined ||
          source === undefined ||
          source.status === "missing" ||
          source.fingerprint.provider !== bucket.provider
        ) {
          hasInvalidBucketReference = true;
        }
      }

      if (hasUnattributedUsage) {
        addInstanceNotice(
          notices,
          instanceFilter === undefined
            ? "Some usage is not attributed to a provider instance and remains included under All."
            : "Some usage is not attributed to a provider instance and was omitted from this selection.",
        );
      }
      if (hasUnknownInstanceReference) {
        addInstanceNotice(
          notices,
          "Some transcript sources reference provider instances without a unique roster entry.",
        );
      }
      if (hasInvalidBucketReference) {
        addInstanceNotice(
          notices,
          "Some usage buckets could not be linked to one valid source and were omitted.",
        );
      }
    } else if (instanceFilter === undefined) {
      const sourceCountsByProvider = new Map<UsageProviderKind, number>();
      for (const source of summary.sources) {
        sourceCountsByProvider.set(
          source.fingerprint.provider,
          (sourceCountsByProvider.get(source.fingerprint.provider) ?? 0) + 1,
        );
      }
      for (const [provider, count] of sourceCountsByProvider) {
        if (count === 1) eligibleLegacyProviders.add(provider);
      }
      if ([...sourceCountsByProvider.values()].some((count) => count > 1)) {
        addInstanceNotice(
          notices,
          "Some legacy provider families have multiple transcript roots and were omitted because their buckets cannot be attributed to one source.",
        );
      }
    }

    return {
      environment,
      isModern,
      sourcesById,
      instancesById,
      eligibleSourceIds,
      eligibleLegacyProviders,
    };
  });
}

function claimSources(
  preparedEnvironments: readonly PreparedEnvironmentUsage[],
  instanceFilter: UsageInstanceFilter | undefined,
): {
  readonly ownerByFingerprint: ReadonlyMap<string, SourceOwner>;
  readonly duplicates: readonly string[];
} {
  const candidates: SourceCandidate[] = [];
  for (const prepared of preparedEnvironments) {
    const { environment } = prepared;
    if (prepared.isModern) {
      for (const sourceId of prepared.eligibleSourceIds) {
        const source = prepared.sourcesById.get(sourceId);
        if (source !== undefined && source.status !== "missing") {
          candidates.push({ prepared, source, sourceId });
        }
      }
    } else if (instanceFilter === undefined) {
      for (const source of environment.summary.sources) {
        if (
          source.status !== "missing" &&
          prepared.eligibleLegacyProviders.has(source.fingerprint.provider)
        ) {
          candidates.push({ prepared, source });
        }
      }
    }
  }

  candidates.sort(
    (a, b) =>
      a.prepared.environment.environmentId.localeCompare(b.prepared.environment.environmentId) ||
      fingerprintKey(a.source.fingerprint).localeCompare(fingerprintKey(b.source.fingerprint)) ||
      (a.sourceId ?? "").localeCompare(b.sourceId ?? ""),
  );

  const ownerByFingerprint = new Map<string, SourceOwner>();
  const duplicates: string[] = [];
  for (const candidate of candidates) {
    const fingerprint = fingerprintKey(candidate.source.fingerprint);
    if (ownerByFingerprint.has(fingerprint)) {
      duplicates.push(
        `${candidate.prepared.environment.label}: ${candidate.source.fingerprint.resolvedHomePath}`,
      );
      continue;
    }
    ownerByFingerprint.set(fingerprint, {
      environmentId: candidate.prepared.environment.environmentId,
      isModern: candidate.prepared.isModern,
      ...(candidate.sourceId === undefined ? {} : { sourceId: candidate.sourceId }),
    });
  }

  return { ownerByFingerprint, duplicates };
}

function providerIsSelected(
  provider: UsageProviderKind,
  providerFilter: UsageProviderFilter | undefined,
): boolean {
  if (providerFilter === undefined) return true;
  return typeof providerFilter === "string"
    ? providerFilter === provider
    : providerFilter.includes(provider);
}

function ownedContribution(
  prepared: PreparedEnvironmentUsage,
  ownerByFingerprint: ReadonlyMap<string, SourceOwner>,
  providerFilter: UsageProviderFilter | undefined,
): {
  readonly buckets: readonly UsageBucket[];
  readonly sessionsByProvider: ReadonlyMap<UsageProviderKind, number>;
} {
  const { environment } = prepared;
  const sessionsByProvider = new Map<UsageProviderKind, number>();

  // `distinctSessions` belongs to each source. A session spanning days or models
  // counts once here, even when several instances share that physical source.
  if (prepared.isModern) {
    const ownedSourceIds = new Set<string>();
    for (const [sourceId, source] of prepared.sourcesById) {
      if (source.status === "missing") continue;
      const owner = ownerByFingerprint.get(fingerprintKey(source.fingerprint));
      if (
        owner?.isModern !== true ||
        owner.environmentId !== environment.environmentId ||
        owner.sourceId !== sourceId ||
        !providerIsSelected(source.fingerprint.provider, providerFilter)
      ) {
        continue;
      }
      ownedSourceIds.add(sourceId);
      const provider = source.fingerprint.provider;
      sessionsByProvider.set(
        provider,
        (sessionsByProvider.get(provider) ?? 0) + source.distinctSessions,
      );
    }

    const buckets = environment.summary.buckets.filter((bucket) => {
      const sourceId = bucket.sourceId;
      const source = sourceId === undefined ? undefined : prepared.sourcesById.get(sourceId);
      return (
        sourceId !== undefined &&
        source !== undefined &&
        source.fingerprint.provider === bucket.provider &&
        ownedSourceIds.has(sourceId) &&
        providerIsSelected(bucket.provider, providerFilter)
      );
    });
    return { buckets, sessionsByProvider };
  }

  const ownedProviders = new Set<UsageProviderKind>();
  for (const source of environment.summary.sources) {
    if (source.status === "missing") continue;
    const owner = ownerByFingerprint.get(fingerprintKey(source.fingerprint));
    const provider = source.fingerprint.provider;
    if (
      owner?.isModern === false &&
      owner.environmentId === environment.environmentId &&
      prepared.eligibleLegacyProviders.has(provider) &&
      providerIsSelected(provider, providerFilter)
    ) {
      ownedProviders.add(provider);
      sessionsByProvider.set(
        provider,
        (sessionsByProvider.get(provider) ?? 0) + source.distinctSessions,
      );
    }
  }

  return {
    buckets: environment.summary.buckets.filter(
      (bucket) =>
        ownedProviders.has(bucket.provider) && providerIsSelected(bucket.provider, providerFilter),
    ),
    sessionsByProvider,
  };
}

function buildInstanceOptions(
  preparedEnvironments: readonly PreparedEnvironmentUsage[],
  instanceFilter: UsageInstanceFilter | undefined,
  notices: Set<string>,
): UsageInstanceOption[] {
  const optionSeeds = new Map<
    string,
    { readonly prepared: PreparedEnvironmentUsage; readonly instance: ProviderInstanceDescriptor }
  >();
  const associationsByFingerprint = new Map<string, Map<string, string>>();

  for (const prepared of preparedEnvironments) {
    if (!prepared.isModern) continue;
    const { environment } = prepared;

    for (const instance of prepared.instancesById.values()) {
      optionSeeds.set(instanceSelectionKey(environment.environmentId, instance.instanceId), {
        prepared,
        instance,
      });
    }

    for (const source of prepared.sourcesById.values()) {
      if (source.status === "missing") continue;
      const instanceIds = source.instanceIds ?? [];
      if (instanceIds.length === 0) continue;
      const fingerprint = fingerprintKey(source.fingerprint);
      const associatedInstances =
        associationsByFingerprint.get(fingerprint) ?? new Map<string, string>();
      for (const instanceId of instanceIds) {
        if (!prepared.instancesById.has(instanceId)) continue;
        const key = instanceSelectionKey(environment.environmentId, instanceId);
        const descriptor = prepared.instancesById.get(instanceId);
        const label = descriptor
          ? `${environment.label}: ${descriptor.displayName} (${instanceId})`
          : `${environment.label}: ${instanceId}`;
        associatedInstances.set(key, label);
      }
      associationsByFingerprint.set(fingerprint, associatedInstances);
    }
  }

  const sharedWithByInstance = new Map<string, Set<string>>();
  let hasSharedDirectory = false;
  for (const associatedInstances of associationsByFingerprint.values()) {
    if (associatedInstances.size < 2) continue;
    hasSharedDirectory = true;
    for (const instanceKey of associatedInstances.keys()) {
      const sharedWith = sharedWithByInstance.get(instanceKey) ?? new Set<string>();
      for (const [otherKey, otherLabel] of associatedInstances) {
        if (otherKey !== instanceKey) sharedWith.add(otherLabel);
      }
      sharedWithByInstance.set(instanceKey, sharedWith);
    }
  }

  if (hasSharedDirectory) {
    addInstanceNotice(
      notices,
      "Shared transcript history cannot be separated between these provider instances. Selecting either or both associated entries counts the shared usage once.",
    );
  }

  const options = [...optionSeeds.values()]
    .map(({ prepared, instance }) => {
      const { environment } = prepared;
      const key = instanceSelectionKey(environment.environmentId, instance.instanceId);
      return {
        key,
        environmentId: environment.environmentId,
        environmentLabel: environment.label,
        instanceId: instance.instanceId,
        driver: instance.driver,
        displayName: instance.displayName,
        enabled: instance.enabled,
        coverage: instance.coverage,
        message: instance.message,
        sharedWith: [...(sharedWithByInstance.get(key) ?? [])].sort((a, b) => a.localeCompare(b)),
      } satisfies UsageInstanceOption;
    })
    .sort(
      (a, b) =>
        a.environmentLabel.localeCompare(b.environmentLabel) ||
        a.displayName.localeCompare(b.displayName) ||
        String(a.instanceId).localeCompare(String(b.instanceId)) ||
        a.environmentId.localeCompare(b.environmentId),
    );

  const selectedKeys =
    instanceFilter === undefined
      ? undefined
      : new Set(
          instanceFilter.map(({ environmentId, instanceId }) =>
            instanceSelectionKey(environmentId, instanceId),
          ),
        );
  const displayNameCounts = new Map<string, number>();
  for (const option of options) {
    displayNameCounts.set(option.displayName, (displayNameCounts.get(option.displayName) ?? 0) + 1);
  }
  for (const option of options) {
    if (selectedKeys !== undefined && !selectedKeys.has(option.key)) continue;
    const duplicateName = (displayNameCounts.get(option.displayName) ?? 0) > 1;
    const instanceReference = duplicateName ? `, ${option.instanceId}` : "";
    const label = `${option.displayName} (${option.environmentLabel}${instanceReference})`;
    if (option.coverage === "unsupported") {
      addInstanceNotice(
        notices,
        `${label}: Usage not collected. ${option.message ?? "This provider does not report usage."}`,
      );
    } else if (option.coverage === "unavailable") {
      addInstanceNotice(
        notices,
        `${label}: Usage unavailable. ${option.message ?? "The usage source could not be read."}`,
      );
    }
  }

  return options;
}

type MutableUsageTokenTotals = {
  -readonly [Key in keyof UsageTokenTotals]: UsageTokenTotals[Key];
};

function emptyTokenTotals(): MutableUsageTokenTotals {
  return {
    uncachedInputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
}

function addTokenTotals(target: MutableUsageTokenTotals, totals: UsageTokenTotals): void {
  target.uncachedInputTokens += totals.uncachedInputTokens;
  target.cachedInputTokens += totals.cachedInputTokens;
  target.cacheCreationTokens += totals.cacheCreationTokens;
  target.outputTokens += totals.outputTokens;
  target.reasoningTokens += totals.reasoningTokens;
}

function bucketTokens(bucket: UsageBucket): number {
  // reasoningTokens is a subset of outputTokens and must not be added again.
  return (
    bucket.totals.uncachedInputTokens +
    bucket.totals.cachedInputTokens +
    bucket.totals.cacheCreationTokens +
    bucket.totals.outputTokens
  );
}

function isCompatibleContractVersion(version: number, expected: number): boolean {
  return version >= USAGE_MERGE_COMPATIBLE_SINCE && version <= expected;
}

const EMPTY_MERGED: MergedUsage = {
  costUsd: 0,
  uncachedInputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  records: 0,
  sessions: 0,
  providers: [],
  models: [],
  daily: [],
  hourly: [],
  costQuality: {
    providerReportedShare: 0,
    modelPricedShare: 0,
    unpricedShare: 0,
    cacheSavingsUsd: 0,
  },
  duplicateSources: [],
  contributingEnvironments: [],
  staleEnvironments: [],
  instanceOptions: [],
  instanceNotices: [],
};

/**
 * Merges connected summaries after physical-source de-duplication.
 *
 * `expectedContractVersion` guards against an environment running older server
 * code: rather than blocking the page, incompatible data is excluded and its
 * id is reported so the UI can say coverage is partial. Versions in
 * [{@link USAGE_MERGE_COMPATIBLE_SINCE}, expected] still merge, so an additive
 * provider expansion does not drop Claude/Codex totals from older servers.
 * `providerFilter` accepts one provider or a selection. Undefined includes all
 * providers, and an empty selection includes none. `instanceFilter` has the
 * same selection behavior for environment-specific provider instances.
 */
export function mergeUsage(
  environments: readonly EnvironmentUsage[],
  expectedContractVersion: number,
  providerFilter?: UsageProviderFilter,
  instanceFilter?: UsageInstanceFilter,
): MergedUsage {
  if (environments.length === 0) return EMPTY_MERGED;

  const current: EnvironmentUsage[] = [];
  const staleEnvironments: EnvironmentId[] = [];
  for (const environment of environments) {
    if (isCompatibleContractVersion(environment.summary.contractVersion, expectedContractVersion)) {
      current.push(environment);
    } else {
      staleEnvironments.push(environment.environmentId);
    }
  }

  const instanceNotices = new Set<string>();
  const preparedEnvironments = prepareEnvironments(current, instanceFilter, instanceNotices);
  const { ownerByFingerprint, duplicates } = claimSources(preparedEnvironments, instanceFilter);
  const instanceOptions = buildInstanceOptions(
    preparedEnvironments,
    instanceFilter,
    instanceNotices,
  );

  let costUsd = 0;
  let uncachedInputTokens = 0;
  let cachedInputTokens = 0;
  let cacheCreationTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let records = 0;
  let sessions = 0;
  let cacheSavingsUsd = 0;
  let providerReportedRecords = 0;
  let unpricedRecords = 0;

  const providerAccumulator = new Map<
    UsageProviderKind,
    {
      costUsd: number;
      cacheSavingsUsd: number;
      totals: MutableUsageTokenTotals;
      totalTokens: number;
      records: number;
      unpricedRecords: number;
      sessions: number;
    }
  >();
  const modelAccumulator = new Map<
    string,
    {
      provider: UsageProviderKind;
      costUsd: number;
      cacheSavingsUsd: number;
      totals: MutableUsageTokenTotals;
      totalTokens: number;
      records: number;
      unpricedRecords: number;
    }
  >();
  const dailyAccumulator = new Map<
    string,
    {
      costUsd: number;
      totalTokens: number;
      byProvider: Map<UsageProviderKind, { costUsd: number; totalTokens: number }>;
    }
  >();
  const hourlyAccumulator = new Map<
    string,
    {
      day: string;
      hourStart: string;
      costUsd: number;
      totalTokens: number;
      byProvider: Map<UsageProviderKind, { costUsd: number; totalTokens: number }>;
    }
  >();
  const contributingEnvironments: EnvironmentId[] = [];

  for (const prepared of preparedEnvironments) {
    const { environment } = prepared;
    const { buckets, sessionsByProvider } = ownedContribution(
      prepared,
      ownerByFingerprint,
      providerFilter,
    );
    if (buckets.length > 0) contributingEnvironments.push(environment.environmentId);

    for (const [providerKind, providerSessions] of sessionsByProvider) {
      sessions += providerSessions;
      if (providerSessions === 0) continue;
      const provider = providerAccumulator.get(providerKind) ?? {
        costUsd: 0,
        cacheSavingsUsd: 0,
        totals: emptyTokenTotals(),
        totalTokens: 0,
        records: 0,
        unpricedRecords: 0,
        sessions: 0,
      };
      provider.sessions += providerSessions;
      providerAccumulator.set(providerKind, provider);
    }

    for (const bucket of buckets) {
      const tokens = bucketTokens(bucket);

      costUsd += bucket.costUsd;
      cacheSavingsUsd += bucket.cacheSavingsUsd;
      uncachedInputTokens += bucket.totals.uncachedInputTokens;
      cachedInputTokens += bucket.totals.cachedInputTokens;
      cacheCreationTokens += bucket.totals.cacheCreationTokens;
      outputTokens += bucket.totals.outputTokens;
      reasoningTokens += bucket.totals.reasoningTokens;
      records += bucket.records;
      unpricedRecords += bucket.unpricedRecords;
      if (bucket.costSource === "providerReported") providerReportedRecords += bucket.records;

      const provider = providerAccumulator.get(bucket.provider) ?? {
        costUsd: 0,
        cacheSavingsUsd: 0,
        totals: emptyTokenTotals(),
        totalTokens: 0,
        records: 0,
        unpricedRecords: 0,
        sessions: 0,
      };
      provider.costUsd += bucket.costUsd;
      provider.cacheSavingsUsd += bucket.cacheSavingsUsd;
      addTokenTotals(provider.totals, bucket.totals);
      provider.totalTokens += tokens;
      provider.records += bucket.records;
      provider.unpricedRecords += bucket.unpricedRecords;
      providerAccumulator.set(bucket.provider, provider);

      const modelKey = `${bucket.provider} ${bucket.model}`;
      const model = modelAccumulator.get(modelKey) ?? {
        provider: bucket.provider,
        costUsd: 0,
        cacheSavingsUsd: 0,
        totals: emptyTokenTotals(),
        totalTokens: 0,
        records: 0,
        unpricedRecords: 0,
      };
      model.costUsd += bucket.costUsd;
      model.cacheSavingsUsd += bucket.cacheSavingsUsd;
      addTokenTotals(model.totals, bucket.totals);
      model.totalTokens += tokens;
      model.records += bucket.records;
      model.unpricedRecords += bucket.unpricedRecords;
      modelAccumulator.set(modelKey, model);

      const day = dailyAccumulator.get(bucket.day) ?? {
        costUsd: 0,
        totalTokens: 0,
        byProvider: new Map<UsageProviderKind, { costUsd: number; totalTokens: number }>(),
      };
      day.costUsd += bucket.costUsd;
      day.totalTokens += tokens;
      const dayProvider = day.byProvider.get(bucket.provider) ?? { costUsd: 0, totalTokens: 0 };
      dayProvider.costUsd += bucket.costUsd;
      dayProvider.totalTokens += tokens;
      day.byProvider.set(bucket.provider, dayProvider);
      dailyAccumulator.set(bucket.day, day);

      if (bucket.hourStart !== undefined) {
        const hour = hourlyAccumulator.get(bucket.hourStart) ?? {
          day: bucket.day,
          hourStart: bucket.hourStart,
          costUsd: 0,
          totalTokens: 0,
          byProvider: new Map<UsageProviderKind, { costUsd: number; totalTokens: number }>(),
        };
        hour.costUsd += bucket.costUsd;
        hour.totalTokens += tokens;
        const hourProvider = hour.byProvider.get(bucket.provider) ?? {
          costUsd: 0,
          totalTokens: 0,
        };
        hourProvider.costUsd += bucket.costUsd;
        hourProvider.totalTokens += tokens;
        hour.byProvider.set(bucket.provider, hourProvider);
        hourlyAccumulator.set(bucket.hourStart, hour);
      }
    }
  }

  const totalTokens = uncachedInputTokens + cachedInputTokens + cacheCreationTokens + outputTokens;

  const providers: ProviderTotals[] = [...providerAccumulator.entries()]
    .map(([provider, totals]) => ({
      provider,
      costUsd: totals.costUsd,
      cacheSavingsUsd: totals.cacheSavingsUsd,
      totals: totals.totals,
      totalTokens: totals.totalTokens,
      records: totals.records,
      unpricedRecords: totals.unpricedRecords,
      sessions: totals.sessions,
      costShare: costUsd === 0 ? 0 : totals.costUsd / costUsd,
      tokenShare: totalTokens === 0 ? 0 : totals.totalTokens / totalTokens,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);

  const models: ModelTotals[] = [...modelAccumulator.entries()]
    .map(([key, totals]) => ({
      model: key.slice(key.indexOf(" ") + 1),
      provider: totals.provider,
      costUsd: totals.costUsd,
      cacheSavingsUsd: totals.cacheSavingsUsd,
      totals: totals.totals,
      totalTokens: totals.totalTokens,
      records: totals.records,
      unpricedRecords: totals.unpricedRecords,
      costShare: costUsd === 0 ? 0 : totals.costUsd / costUsd,
    }))
    .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);

  const daily: DailyTotals[] = [...dailyAccumulator.entries()]
    .map(([day, totals]) => ({
      day,
      costUsd: totals.costUsd,
      totalTokens: totals.totalTokens,
      byProvider: totals.byProvider,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const hourly: HourlyTotals[] = [...hourlyAccumulator.values()].sort((a, b) =>
    a.hourStart.localeCompare(b.hourStart),
  );

  return {
    costUsd,
    uncachedInputTokens,
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    records,
    sessions,
    providers,
    models,
    daily,
    hourly,
    costQuality: {
      providerReportedShare: records === 0 ? 0 : providerReportedRecords / records,
      unpricedShare: records === 0 ? 0 : unpricedRecords / records,
      modelPricedShare:
        records === 0 ? 0 : (records - providerReportedRecords - unpricedRecords) / records,
      cacheSavingsUsd,
    },
    duplicateSources: duplicates,
    contributingEnvironments,
    staleEnvironments,
    instanceOptions,
    instanceNotices: [...instanceNotices].sort((a, b) => a.localeCompare(b)),
  };
}
