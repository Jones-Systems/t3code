import { USAGE_CONTRACT_VERSION } from "@t3tools/contracts";
import { mergeUsage } from "@t3tools/shared/usageMerge";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  useUsage: vi.fn(),
  metric: "cost" as "cost" | "tokens",
  breakdown: "time" as "model" | "time",
  expandedModels: new Set<string>(),
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
  testState.useUsage.mockReturnValue({
    merged: {
      ...mergeUsage([], USAGE_CONTRACT_VERSION),
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
    environments: [],
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
