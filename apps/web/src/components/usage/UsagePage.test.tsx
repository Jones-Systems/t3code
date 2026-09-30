import { USAGE_CONTRACT_VERSION } from "@t3tools/contracts";
import { mergeUsage, type UsageInstanceOption } from "@t3tools/shared/usageMerge";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  useUsage: vi.fn(),
  metric: "cost" as "cost" | "tokens",
  breakdown: "time" as "model" | "time",
  expandedModels: new Set<string>(),
  instanceSelection: undefined as { environmentId: string; instanceId: string }[] | undefined,
  instanceOptions: [] as UsageInstanceOption[],
  instanceNotices: [] as string[],
  environments: [] as {
    environmentId: string;
    label: string;
    isPending: boolean;
    error: string | null;
    summary: { providerInstances?: readonly unknown[] } | null;
  }[],
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: vi.fn((initial: unknown) => {
      const value =
        typeof initial === "function"
          ? {
              days: 1,
              window: {
                sinceDay: "2026-08-10",
                untilDay: "2026-08-11",
                timeZone: "UTC",
                resolution: "hour",
                sinceTime: "2026-08-10T12:37:00.000Z",
                untilTime: "2026-08-11T12:37:00.000Z",
              },
            }
          : initial instanceof Set
            ? testState.expandedModels
            : initial === "cost"
              ? testState.metric
              : initial === "model"
                ? testState.breakdown
                : initial === undefined && testState.instanceSelection !== undefined
                  ? testState.instanceSelection
                  : initial;
      return [value, vi.fn()];
    }),
  };
});

vi.mock("../../env", () => ({ isElectron: false }));
vi.mock("../../state/usage", () => ({ useUsage: testState.useUsage }));
vi.mock("../ui/button", () => ({ Button: "button" }));
vi.mock("../ui/scroll-area", () => ({ ScrollArea: "div" }));
vi.mock("../ui/select", () => ({
  Select: "div",
  SelectItem: "div",
  SelectPopup: "div",
  SelectTrigger: "div",
  SelectValue: "div",
}));
vi.mock("../ui/sidebar", () => ({ SidebarInset: "div" }));
vi.mock("../ui/toggle-group", () => ({ Toggle: "button", ToggleGroup: "div" }));
vi.mock("../WorkspaceBreadcrumb", () => ({
  WorkspaceBreadcrumb: "div",
  WorkspaceBreadcrumbItem: "div",
  WorkspaceBreadcrumbSeparator: "span",
}));
vi.mock("../WorkspacePageContainer", () => ({ WorkspacePageContainer: "main" }));
vi.mock("../WorkspacePageHeader", () => ({ WorkspacePageHeader: "header" }));
vi.mock("./UsageProviderChart", () => ({ UsageProviderChart: "div" }));
vi.mock("./usageProviders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./usageProviders")>();
  return {
    ...actual,
    PROVIDER_PRESENTATION: {
      codex: { color: "white", label: "Codex", mark: "span" },
      claude: { color: "orange", label: "Claude Code", mark: "span" },
      grok: { color: "purple", label: "Grok Build", mark: "span" },
    },
  };
});

import { UsagePage } from "./UsagePage";

const providerTotals = (codex: number, claude: number) =>
  new Map([
    ["codex", { costUsd: codex, totalTokens: codex * 1_000 }],
    ["claude", { costUsd: claude, totalTokens: claude * 1_000 }],
  ] as const);

const tokenTotals = (
  uncachedInputTokens: number,
  cachedInputTokens: number,
  cacheCreationTokens: number,
  outputTokens: number,
  reasoningTokens: number,
) => ({
  uncachedInputTokens,
  cachedInputTokens,
  cacheCreationTokens,
  outputTokens,
  reasoningTokens,
});

function makeInstanceOption(
  environmentId: string,
  environmentLabel: string,
  instanceId: string,
  overrides: Partial<UsageInstanceOption> = {},
): UsageInstanceOption {
  return {
    key: JSON.stringify([environmentId, instanceId]),
    environmentId: environmentId as UsageInstanceOption["environmentId"],
    environmentLabel,
    instanceId: instanceId as UsageInstanceOption["instanceId"],
    driver: "codex" as UsageInstanceOption["driver"],
    displayName: "Work",
    enabled: true,
    coverage: "supported",
    message: null,
    sharedWith: [],
    ...overrides,
  };
}

const modelTotals = Object.freeze([
  {
    model: "expensive-model",
    provider: "claude" as const,
    costUsd: 10,
    totalTokens: 200,
    records: 1,
    costShare: 10 / 16,
    totals: tokenTotals(70, 20, 10, 100, 30),
    cacheSavingsUsd: 0.5,
    unpricedRecords: 1,
  },
  {
    model: "token-heavy-model",
    provider: "codex" as const,
    costUsd: 5,
    totalTokens: 1_000,
    records: 1,
    costShare: 5 / 16,
    totals: tokenTotals(600, 200, 100, 100, 50),
    cacheSavingsUsd: 0.25,
    unpricedRecords: 0,
  },
  {
    model: "token-heavy-cheaper-model",
    provider: "codex" as const,
    costUsd: 1,
    totalTokens: 1_000,
    records: 1,
    costShare: 1 / 16,
    totals: tokenTotals(600, 200, 100, 100, 50),
    cacheSavingsUsd: 0.15,
    unpricedRecords: 0,
  },
  {
    model: "no-input-model",
    provider: "codex" as const,
    costUsd: 0,
    totalTokens: 12,
    records: 1,
    costShare: 0,
    totals: tokenTotals(0, 0, 0, 12, 0),
    cacheSavingsUsd: 0,
    unpricedRecords: 0,
  },
]);

beforeEach(() => {
  testState.metric = "cost";
  testState.breakdown = "time";
  testState.expandedModels = new Set();
  testState.instanceSelection = undefined;
  testState.instanceOptions.length = 0;
  testState.instanceNotices.length = 0;
  testState.environments.length = 0;
  testState.useUsage.mockReturnValue({
    merged: {
      ...mergeUsage([], USAGE_CONTRACT_VERSION),
      instanceOptions: testState.instanceOptions,
      instanceNotices: testState.instanceNotices,
      uncachedInputTokens: 70,
      cachedInputTokens: 20,
      cacheCreationTokens: 10,
      outputTokens: 100,
      reasoningTokens: 30,
      totalTokens: 200,
      models: modelTotals,
      hourly: [
        {
          day: "2026-08-10",
          hourStart: "2026-08-10T13:37:00.000Z",
          costUsd: 13,
          totalTokens: 13_000,
          byProvider: providerTotals(7, 6),
        },
        {
          day: "2026-08-11",
          hourStart: "2026-08-11T11:37:00.000Z",
          costUsd: 11,
          totalTokens: 11_000,
          byProvider: providerTotals(6, 5),
        },
      ],
    },
    environments: testState.environments,
    isPending: false,
    isPartial: false,
    refresh: vi.fn(),
  });
});

describe("UsagePage hourly breakdown", () => {
  it("keeps recent activity visible first without empty hourly rows", () => {
    const markup = renderToStaticMarkup(<UsagePage />);
    const body = markup.match(/<tbody>(.*?)<\/tbody>/)?.[1] ?? "";

    expect(body.match(/<tr/g)).toHaveLength(2);
    expect(body).toContain("$11.00");
    expect(body).toContain("$13.00");
    expect(body.indexOf("$11.00")).toBeLessThan(body.indexOf("$13.00"));
  });

  it("keeps chronological ordering when the token metric is selected", () => {
    testState.metric = "tokens";

    const markup = renderToStaticMarkup(<UsagePage />);
    const body = markup.match(/<tbody>(.*?)<\/tbody>/)?.[1] ?? "";

    expect(body).toMatch(/\$11\.00.*\$13\.00/);
  });
});

describe("UsagePage model breakdown", () => {
  it("sorts models by cost when the cost metric is selected", () => {
    testState.breakdown = "model";

    const markup = renderToStaticMarkup(<UsagePage />);
    const body = markup.match(/<tbody>(.*?)<\/tbody>/)?.[1] ?? "";

    expect(body).toMatch(/expensive-model.*token-heavy-model.*token-heavy-cheaper-model/);
  });

  it("sorts models by token usage when the token metric is selected", () => {
    testState.metric = "tokens";
    testState.breakdown = "model";

    const markup = renderToStaticMarkup(<UsagePage />);
    const body = markup.match(/<tbody>(.*?)<\/tbody>/)?.[1] ?? "";

    expect(body).toMatch(/token-heavy-model.*token-heavy-cheaper-model.*expensive-model/);
    expect(modelTotals.map((model) => model.model)).toEqual([
      "expensive-model",
      "token-heavy-model",
      "token-heavy-cheaper-model",
      "no-input-model",
    ]);
  });

  it("shows token-weighted cache shares and marks zero-input shares unavailable", () => {
    testState.breakdown = "model";
    testState.expandedModels = new Set(["claude:expensive-model", "codex:no-input-model"]);

    const markup = renderToStaticMarkup(<UsagePage />);

    expect(markup).toContain("20.0% of input");
    expect(markup).toContain("10.0% of input");
    expect(markup).toMatch(/Cache percentage[\s\S]{0,180}20\.0%/);
    expect(markup).toContain("— of input");
    expect(markup).toContain("30");
    expect(markup).toContain("Subset of output");
    expect(markup).toContain("1 unpriced record");
    expect(markup).toContain("$0.50 cache savings");
    expect(markup).not.toContain("NaN");
  });
});

describe("UsagePage provider instances", () => {
  it("identifies configured entries and explains selected missing coverage", () => {
    testState.instanceOptions.push(
      makeInstanceOption("env-a", "Desktop", "codex_work", {
        enabled: false,
        coverage: "unsupported",
        message: "No usage collector is configured.",
      }),
      makeInstanceOption("env-b", "Workstation", "codex_work", {
        coverage: "unavailable",
        message: "The server could not read this instance's history.",
      }),
    );
    testState.instanceSelection = [
      { environmentId: "env-a", instanceId: "codex_work" },
      { environmentId: "env-b", instanceId: "codex_work" },
    ];
    testState.instanceNotices.push(
      "Work (Desktop) has unsupported usage coverage; a zero total does not prove no usage. No usage collector is configured.",
      "Work (Workstation) usage coverage is unavailable; a zero total does not prove no usage. The server could not read this instance's history.",
      "Some provider instances share a transcript directory; selecting any associated instance includes that usage once.",
    );

    const markup = renderToStaticMarkup(<UsagePage />);

    expect(markup).toContain("Work · ID codex_work · Desktop");
    expect(markup).toContain("Work · ID codex_work · Workstation");
    expect(markup).toContain("Usage not collected");
    expect(markup).toContain("Usage unavailable");
    expect(markup).toContain("Disabled");
    expect(markup).toContain("No usage collector is configured.");
    expect(markup).toContain("The server could not read this instance&#x27;s history.");
    expect(markup).toContain("usage coverage is unavailable; a zero total does not prove no usage");
    expect(markup).toContain("Some provider instances share a transcript directory");
  });

  it("explains when an older server cannot filter history by instance", () => {
    testState.environments.push({
      environmentId: "legacy-server",
      label: "Legacy server",
      isPending: false,
      error: null,
      summary: {},
    });

    const markup = renderToStaticMarkup(<UsagePage />);

    expect(markup).toContain("Instance filtering is unavailable");
    expect(markup).toContain("all usage available from that server is shown");
  });

  it("does not treat a current server with an empty provider roster as legacy", () => {
    testState.environments.push({
      environmentId: "current-server",
      label: "Current server",
      isPending: false,
      error: null,
      summary: { providerInstances: [] },
    });

    const markup = renderToStaticMarkup(<UsagePage />);

    expect(markup).not.toContain("Instance filtering is unavailable");
  });
});
