import {
  USAGE_CONTRACT_VERSION,
  type EnvironmentId,
  type UsageBucket,
  type UsageDay,
  type UsageProviderKind,
  type UsageSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mergeUsage, type EnvironmentUsage } from "./usageMerge.ts";

function bucket(overrides: Partial<UsageBucket> = {}): UsageBucket {
  return {
    day: "2026-08-07" as UsageDay,
    provider: "claude",
    model: "claude-fable-5",
    totals: {
      uncachedInputTokens: 100,
      cachedInputTokens: 1000,
      cacheCreationTokens: 10,
      outputTokens: 50,
      reasoningTokens: 0,
    },
    costUsd: 10,
    cacheSavingsUsd: 2,
    costSource: "modelPriced",
    records: 5,
    unpricedRecords: 0,
    sessions: 1,
    ...overrides,
  };
}

function summary(
  buckets: readonly UsageBucket[],
  sources: readonly {
    provider: UsageProviderKind;
    hostId: string;
    homePath: string;
    volumeId?: string;
    distinctSessions?: number;
  }[],
  contractVersion: number = USAGE_CONTRACT_VERSION,
): UsageSummary {
  return {
    contractVersion,
    readAt: "2026-08-07T00:00:00.000Z",
    timeZone: "UTC",
    sinceDay: "2026-08-01" as UsageDay,
    untilDay: "2026-08-31" as UsageDay,
    buckets,
    sources: sources.map((source) => ({
      fingerprint: {
        hostId: source.hostId,
        provider: source.provider,
        resolvedHomePath: source.homePath,
        volumeId: source.volumeId ?? `vol-${source.hostId}`,
      },
      status: "ok" as const,
      scannedFiles: 1,
      skippedFiles: 0,
      malformedRecords: 0,
      distinctSessions: source.distinctSessions ?? 1,
      message: null,
    })),
    pricing: { status: "fresh", source: "litellm", fetchedAt: null, knownModels: 10 },
    scanDurationMs: 1,
  };
}

function environment(id: string, usageSummary: UsageSummary): EnvironmentUsage {
  return { environmentId: id as EnvironmentId, label: id, summary: usageSummary };
}

describe("mergeUsage", () => {
  it("sums environments that read different transcript directories", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary([bucket()], [{ provider: "claude", hostId: "mac", homePath: "/a/.claude" }]),
        ),
        environment(
          "env-b",
          summary([bucket()], [{ provider: "claude", hostId: "linux", homePath: "/b/.claude" }]),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(20);
    expect(merged.records).toBe(10);
    expect(merged.duplicateSources).toHaveLength(0);
  });

  it("counts a shared transcript directory once", () => {
    // Two worktree servers on one machine resolve the same provider home.
    const shared = { provider: "claude" as const, hostId: "mac", homePath: "/home/theo/.claude" };
    const merged = mergeUsage(
      [
        environment("env-a", summary([bucket()], [shared])),
        environment("env-b", summary([bucket()], [shared])),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(10);
    expect(merged.records).toBe(5);
    expect(merged.sessions).toBe(1);
    expect(merged.duplicateSources).toHaveLength(1);
    expect(merged.contributingEnvironments).toEqual(["env-a"]);
  });

  it("drops only the duplicated provider, keeping the environment's other one", () => {
    const sharedClaude = {
      provider: "claude" as const,
      hostId: "mac",
      homePath: "/home/theo/.claude",
    };
    const merged = mergeUsage(
      [
        environment("env-a", summary([bucket()], [sharedClaude])),
        environment(
          "env-b",
          summary(
            [bucket(), bucket({ provider: "codex", model: "gpt-5.6-sol", costUsd: 4 })],
            [sharedClaude, { provider: "codex", hostId: "mac", homePath: "/home/theo/.codex" }],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    // env-b's claude bucket is dropped, its codex bucket survives.
    expect(merged.costUsd).toBe(14);
    expect(merged.providers.map((provider) => provider.provider).sort()).toEqual([
      "claude",
      "codex",
    ]);
    expect(merged.sessions).toBe(2);
    expect(
      Object.fromEntries(
        merged.providers.map((provider) => [provider.provider, provider.sessions]),
      ),
    ).toEqual({ claude: 1, codex: 1 });
  });

  it("excludes an environment reporting an older contract version", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary([bucket()], [{ provider: "claude", hostId: "mac", homePath: "/a" }]),
        ),
        environment(
          "env-b",
          summary(
            [bucket()],
            [{ provider: "claude", hostId: "linux", homePath: "/b" }],
            USAGE_CONTRACT_VERSION - 2,
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(10);
    expect(merged.staleEnvironments).toEqual(["env-b"]);
  });

  it("keeps the previous compatible contract version so additive provider expansions still merge", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [bucket({ costUsd: 10 })],
            [{ provider: "claude", hostId: "mac", homePath: "/a" }],
          ),
        ),
        environment(
          "env-b",
          summary(
            [bucket({ costUsd: 4, provider: "codex", model: "gpt-5.6-sol" })],
            [{ provider: "codex", hostId: "linux", homePath: "/b" }],
            USAGE_CONTRACT_VERSION - 1,
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(14);
    expect(merged.staleEnvironments).toEqual([]);
  });

  it("derives provider shares and cost quality", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [
              bucket({ costUsd: 75 }),
              bucket({ provider: "codex", model: "gpt-5.6-sol", costUsd: 25, unpricedRecords: 5 }),
            ],
            [
              { provider: "claude", hostId: "mac", homePath: "/a/.claude" },
              { provider: "codex", hostId: "mac", homePath: "/a/.codex" },
            ],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.providers[0]?.provider).toBe("claude");
    expect(merged.providers[0]?.costShare).toBeCloseTo(0.75, 5);
    expect(merged.costQuality.unpricedShare).toBeCloseTo(0.5, 5);
    expect(merged.costQuality.cacheSavingsUsd).toBe(4);
  });

  it("keeps two machines apart when hostname and home path collide", () => {
    // Every Mac resolves /Users/theo/.claude, so a hostname clash used to make
    // one machine's usage vanish. Filesystem identity separates them.
    const shape = { provider: "claude" as const, hostId: "mac", homePath: "/Users/theo/.claude" };
    const merged = mergeUsage(
      [
        environment("env-a", summary([bucket()], [{ ...shape, volumeId: "16777220:1234" }])),
        environment("env-b", summary([bucket()], [{ ...shape, volumeId: "16777221:9999" }])),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(20);
    expect(merged.duplicateSources).toHaveLength(0);
  });

  it("still collapses two servers reading the same directory", () => {
    const same = {
      provider: "claude" as const,
      hostId: "mac",
      homePath: "/Users/theo/.claude",
      volumeId: "16777220:1234",
    };
    const merged = mergeUsage(
      [
        environment("env-a", summary([bucket()], [same])),
        environment("env-b", summary([bucket()], [same])),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(10);
    expect(merged.duplicateSources).toHaveLength(1);
  });

  it("totals sessions from per-directory distinct counts, not per-bucket sums", () => {
    // One session that spans two days appears in two buckets. Summing bucket
    // sessions would say 2; the source's distinct count says 1.
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [bucket({ day: "2026-08-06" as UsageDay }), bucket({ day: "2026-08-07" as UsageDay })],
            [
              {
                provider: "claude",
                hostId: "mac",
                homePath: "/a/.claude",
                distinctSessions: 1,
              },
            ],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.sessions).toBe(1);
    expect(merged.providers[0]?.sessions).toBe(1);
  });

  it("returns empty totals with no environments", () => {
    const merged = mergeUsage([], USAGE_CONTRACT_VERSION);
    expect(merged.costUsd).toBe(0);
    expect(merged.daily).toHaveLength(0);
    expect(merged.hourly).toHaveLength(0);
  });

  it("omits providers with no sessions or usage", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [],
            [
              {
                provider: "claude",
                hostId: "mac",
                homePath: "/a/.claude",
                distinctSessions: 0,
              },
            ],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.providers).toEqual([]);
  });

  it("derives hourly totals without losing the daily rollup", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [
              bucket({ hourStart: "2026-08-07T09:37:00.000Z", costUsd: 3 }),
              bucket({ hourStart: "2026-08-07T10:37:00.000Z", costUsd: 7 }),
            ],
            [{ provider: "claude", hostId: "mac", homePath: "/a/.claude" }],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.hourly.map((hour) => [hour.hourStart, hour.costUsd])).toEqual([
      ["2026-08-07T09:37:00.000Z", 3],
      ["2026-08-07T10:37:00.000Z", 7],
    ]);
    expect(merged.daily).toHaveLength(1);
    expect(merged.daily[0]?.costUsd).toBe(10);
  });

  it("preserves token categories and weights provider and model shares by their totals", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [
              bucket({
                totals: {
                  uncachedInputTokens: 10,
                  cachedInputTokens: 20,
                  cacheCreationTokens: 5,
                  outputTokens: 35,
                  reasoningTokens: 15,
                },
                costUsd: 20,
                cacheSavingsUsd: 1.25,
                records: 2,
              }),
              bucket({
                model: "claude-opus-5",
                totals: {
                  uncachedInputTokens: 1,
                  cachedInputTokens: 2,
                  cacheCreationTokens: 0,
                  outputTokens: 7,
                  reasoningTokens: 3,
                },
                costUsd: 10,
                cacheSavingsUsd: 0.75,
                records: 1,
              }),
              bucket({
                provider: "codex",
                model: "gpt-5.6-sol",
                totals: {
                  uncachedInputTokens: 100,
                  cachedInputTokens: 50,
                  cacheCreationTokens: 25,
                  outputTokens: 125,
                  reasoningTokens: 75,
                },
                costUsd: 70,
                cacheSavingsUsd: 3,
                records: 7,
                unpricedRecords: 2,
              }),
            ],
            [
              { provider: "claude", hostId: "mac", homePath: "/a/.claude" },
              { provider: "codex", hostId: "mac", homePath: "/a/.codex" },
            ],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    const claude = merged.providers.find((provider) => provider.provider === "claude");
    const codex = merged.providers.find((provider) => provider.provider === "codex");
    const claudeFable = merged.models.find((model) => model.model === "claude-fable-5");
    const claudeOpus = merged.models.find((model) => model.model === "claude-opus-5");
    const codexGpt = merged.models.find((model) => model.model === "gpt-5.6-sol");

    expect(merged.totalTokens).toBe(380);
    expect(merged.reasoningTokens).toBe(93);
    expect(claude).toMatchObject({
      costUsd: 30,
      cacheSavingsUsd: 2,
      totals: {
        uncachedInputTokens: 11,
        cachedInputTokens: 22,
        cacheCreationTokens: 5,
        outputTokens: 42,
        reasoningTokens: 18,
      },
      totalTokens: 80,
      records: 3,
      unpricedRecords: 0,
      costShare: 0.3,
    });
    expect(claude?.tokenShare).toBeCloseTo(80 / 380, 5);
    expect(codex).toMatchObject({
      totalTokens: 300,
      unpricedRecords: 2,
      costShare: 0.7,
    });
    expect(codex?.tokenShare).toBeCloseTo(300 / 380, 5);
    expect(claudeFable).toMatchObject({
      costUsd: 20,
      cacheSavingsUsd: 1.25,
      totalTokens: 70,
      costShare: 0.2,
      totals: {
        uncachedInputTokens: 10,
        cachedInputTokens: 20,
        cacheCreationTokens: 5,
        outputTokens: 35,
        reasoningTokens: 15,
      },
    });
    expect(claudeOpus).toMatchObject({ costUsd: 10, totalTokens: 10, costShare: 0.1 });
    expect(codexGpt).toMatchObject({
      cacheSavingsUsd: 3,
      totalTokens: 300,
      unpricedRecords: 2,
      totals: {
        uncachedInputTokens: 100,
        cachedInputTokens: 50,
        cacheCreationTokens: 25,
        outputTokens: 125,
        reasoningTokens: 75,
      },
    });
  });

  it("filters every projection and recomputes shares from the selected provider", () => {
    const environments = [
      environment(
        "env-a",
        summary(
          [
            bucket({
              day: "2026-08-07" as UsageDay,
              hourStart: "2026-08-07T09:00:00.000Z",
              totals: {
                uncachedInputTokens: 10,
                cachedInputTokens: 5,
                cacheCreationTokens: 1,
                outputTokens: 4,
                reasoningTokens: 2,
              },
              costUsd: 6,
              cacheSavingsUsd: 1,
              records: 2,
              unpricedRecords: 0,
              costSource: "modelPriced",
            }),
            bucket({
              day: "2026-08-08" as UsageDay,
              hourStart: "2026-08-08T10:00:00.000Z",
              model: "claude-opus-5",
              totals: {
                uncachedInputTokens: 1,
                cachedInputTokens: 2,
                cacheCreationTokens: 3,
                outputTokens: 4,
                reasoningTokens: 3,
              },
              costUsd: 4,
              cacheSavingsUsd: 2,
              records: 2,
              unpricedRecords: 1,
              costSource: "modelPriced",
            }),
            bucket({
              day: "2026-08-09" as UsageDay,
              hourStart: "2026-08-09T11:00:00.000Z",
              provider: "codex",
              model: "gpt-5.6-sol",
              totals: {
                uncachedInputTokens: 5,
                cachedInputTokens: 6,
                cacheCreationTokens: 7,
                outputTokens: 8,
                reasoningTokens: 4,
              },
              costUsd: 30,
              cacheSavingsUsd: 9,
              records: 3,
              unpricedRecords: 0,
              costSource: "providerReported",
            }),
          ],
          [
            { provider: "claude", hostId: "mac", homePath: "/a/.claude", distinctSessions: 2 },
            { provider: "codex", hostId: "mac", homePath: "/a/.codex", distinctSessions: 4 },
          ],
        ),
      ),
      environment(
        "env-stale",
        summary(
          [bucket({ provider: "grok", model: "grok-4" })],
          [{ provider: "grok", hostId: "old", homePath: "/old/.grok" }],
          USAGE_CONTRACT_VERSION - 2,
        ),
      ),
    ];
    const merged = mergeUsage(environments, USAGE_CONTRACT_VERSION, "claude");

    expect(merged).toMatchObject({
      costUsd: 10,
      uncachedInputTokens: 11,
      cachedInputTokens: 7,
      cacheCreationTokens: 4,
      outputTokens: 8,
      reasoningTokens: 5,
      totalTokens: 30,
      records: 4,
      sessions: 2,
      staleEnvironments: ["env-stale"],
    });
    expect(merged.providers).toHaveLength(1);
    expect(merged.providers[0]).toMatchObject({
      provider: "claude",
      costUsd: 10,
      cacheSavingsUsd: 3,
      totalTokens: 30,
      records: 4,
      unpricedRecords: 1,
      sessions: 2,
      costShare: 1,
      tokenShare: 1,
    });
    expect(merged.models.map((model) => model.model)).toEqual(["claude-fable-5", "claude-opus-5"]);
    expect(merged.models.map((model) => model.costShare)).toEqual([0.6, 0.4]);
    expect(
      merged.daily.map(({ day, costUsd, totalTokens }) => [day, costUsd, totalTokens]),
    ).toEqual([
      ["2026-08-07", 6, 20],
      ["2026-08-08", 4, 10],
    ]);
    expect(merged.daily[0]?.byProvider.get("claude")).toEqual({ costUsd: 6, totalTokens: 20 });
    expect(
      merged.hourly.map(({ hourStart, costUsd, totalTokens }) => [hourStart, costUsd, totalTokens]),
    ).toEqual([
      ["2026-08-07T09:00:00.000Z", 6, 20],
      ["2026-08-08T10:00:00.000Z", 4, 10],
    ]);
    expect(merged.hourly[0]?.byProvider.get("claude")).toEqual({ costUsd: 6, totalTokens: 20 });
    expect(merged.costQuality).toEqual({
      providerReportedShare: 0,
      modelPricedShare: 0.75,
      unpricedShare: 0.25,
      cacheSavingsUsd: 3,
    });
  });

  it("projects a provider selection after deduplication and excludes other providers", () => {
    const sharedClaude = {
      provider: "claude" as const,
      hostId: "mac",
      homePath: "/a/.claude",
    };
    const environments = [
      environment(
        "env-b",
        summary(
          [
            bucket({
              day: "2026-08-10" as UsageDay,
              hourStart: "2026-08-10T12:00:00.000Z",
              costUsd: 100,
              records: 99,
            }),
          ],
          [{ ...sharedClaude, distinctSessions: 99 }],
        ),
      ),
      environment(
        "env-a",
        summary(
          [
            bucket({
              day: "2026-08-07" as UsageDay,
              hourStart: "2026-08-07T09:00:00.000Z",
              totals: {
                uncachedInputTokens: 10,
                cachedInputTokens: 5,
                cacheCreationTokens: 0,
                outputTokens: 5,
                reasoningTokens: 2,
              },
              costUsd: 10,
              cacheSavingsUsd: 1,
              records: 2,
              costSource: "modelPriced",
            }),
            bucket({
              day: "2026-08-08" as UsageDay,
              hourStart: "2026-08-08T10:00:00.000Z",
              provider: "codex",
              model: "gpt-5.6-sol",
              totals: {
                uncachedInputTokens: 5,
                cachedInputTokens: 5,
                cacheCreationTokens: 10,
                outputTokens: 10,
                reasoningTokens: 4,
              },
              costUsd: 20,
              cacheSavingsUsd: 2,
              records: 3,
              unpricedRecords: 1,
              costSource: "modelPriced",
            }),
            bucket({
              day: "2026-08-09" as UsageDay,
              hourStart: "2026-08-09T11:00:00.000Z",
              provider: "grok",
              model: "grok-4",
              totals: {
                uncachedInputTokens: 10,
                cachedInputTokens: 10,
                cacheCreationTokens: 10,
                outputTokens: 10,
                reasoningTokens: 8,
              },
              costUsd: 100,
              cacheSavingsUsd: 30,
              records: 5,
              costSource: "providerReported",
            }),
          ],
          [
            { provider: "claude", hostId: "mac", homePath: "/a/.claude", distinctSessions: 2 },
            { provider: "codex", hostId: "mac", homePath: "/a/.codex", distinctSessions: 3 },
            { provider: "grok", hostId: "mac", homePath: "/a/.grok", distinctSessions: 5 },
          ],
        ),
      ),
    ];
    const merged = mergeUsage(environments, USAGE_CONTRACT_VERSION, ["claude", "codex"]);

    expect(merged).toMatchObject({
      costUsd: 30,
      uncachedInputTokens: 15,
      cachedInputTokens: 10,
      cacheCreationTokens: 10,
      outputTokens: 15,
      reasoningTokens: 6,
      totalTokens: 50,
      records: 5,
      sessions: 5,
      duplicateSources: ["env-b: /a/.claude"],
      contributingEnvironments: ["env-a"],
    });
    expect(merged.providers.map((provider) => provider.provider)).toEqual(["codex", "claude"]);
    expect(merged.providers[0]).toMatchObject({
      costUsd: 20,
      totalTokens: 30,
      records: 3,
      unpricedRecords: 1,
      sessions: 3,
      costShare: 2 / 3,
      tokenShare: 0.6,
    });
    expect(merged.providers[1]).toMatchObject({
      costUsd: 10,
      totalTokens: 20,
      records: 2,
      sessions: 2,
      costShare: 1 / 3,
      tokenShare: 0.4,
    });
    expect(merged.models.map((model) => model.model)).toEqual(["gpt-5.6-sol", "claude-fable-5"]);
    expect(merged.models.map((model) => model.costShare)).toEqual([2 / 3, 1 / 3]);
    expect(
      merged.daily.map(({ day, costUsd, totalTokens }) => [day, costUsd, totalTokens]),
    ).toEqual([
      ["2026-08-07", 10, 20],
      ["2026-08-08", 20, 30],
    ]);
    expect(merged.daily[1]?.byProvider.get("codex")).toEqual({ costUsd: 20, totalTokens: 30 });
    expect(
      merged.hourly.map(({ hourStart, costUsd, totalTokens }) => [hourStart, costUsd, totalTokens]),
    ).toEqual([
      ["2026-08-07T09:00:00.000Z", 10, 20],
      ["2026-08-08T10:00:00.000Z", 20, 30],
    ]);
    expect(merged.hourly[1]?.byProvider.get("codex")).toEqual({ costUsd: 20, totalTokens: 30 });
    expect(merged.costQuality).toEqual({
      providerReportedShare: 0,
      modelPricedShare: 4 / 5,
      unpricedShare: 1 / 5,
      cacheSavingsUsd: 3,
    });
  });

  it("keeps duplicate ownership and diagnostics stable when filtering providers", () => {
    const sharedClaude = {
      provider: "claude" as const,
      hostId: "mac",
      homePath: "/home/theo/.claude",
    };
    const environments = [
      environment(
        "env-b",
        summary(
          [bucket({ costUsd: 90 }), bucket({ provider: "codex", costUsd: 4 })],
          [sharedClaude, { provider: "codex", hostId: "mac", homePath: "/home/theo/.codex" }],
        ),
      ),
      environment("env-a", summary([bucket({ costUsd: 10 })], [sharedClaude])),
    ];
    const merged = mergeUsage(environments, USAGE_CONTRACT_VERSION, "codex");
    const reordered = mergeUsage(environments.toReversed(), USAGE_CONTRACT_VERSION, "codex");

    expect(merged.costUsd).toBe(4);
    expect(merged.providers.map((provider) => provider.provider)).toEqual(["codex"]);
    expect(merged.contributingEnvironments).toEqual(["env-b"]);
    expect(merged.duplicateSources).toEqual(["env-b: /home/theo/.claude"]);
    expect(reordered.duplicateSources).toEqual(merged.duplicateSources);
    expect(reordered.costUsd).toBe(merged.costUsd);
    expect(reordered.contributingEnvironments).toEqual(merged.contributingEnvironments);
  });

  it("returns empty selected totals when no source reports that provider", () => {
    const environments = [
      environment(
        "env-a",
        summary([bucket()], [{ provider: "claude", hostId: "mac", homePath: "/a/.claude" }]),
      ),
    ];
    const merged = mergeUsage(environments, USAGE_CONTRACT_VERSION, "grok");
    const emptySelection = mergeUsage(environments, USAGE_CONTRACT_VERSION, []);

    for (const emptyUsage of [merged, emptySelection]) {
      expect(emptyUsage.costUsd).toBe(0);
      expect(emptyUsage.totalTokens).toBe(0);
      expect(emptyUsage.records).toBe(0);
      expect(emptyUsage.sessions).toBe(0);
      expect(emptyUsage.providers).toEqual([]);
      expect(emptyUsage.models).toEqual([]);
      expect(emptyUsage.daily).toEqual([]);
      expect(emptyUsage.hourly).toEqual([]);
      expect(emptyUsage.costQuality).toEqual({
        providerReportedShare: 0,
        modelPricedShare: 0,
        unpricedShare: 0,
        cacheSavingsUsd: 0,
      });
    }
  });
});
