import { isValidElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";
import type { WorkstreamDetailView, WorkstreamListView } from "../../state/workstreams";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useLayoutEffect: reactHookHarness.useEffect,
    useMemo: reactHookHarness.useMemo,
    useRef: reactHookHarness.useRef,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

import { WorkstreamSidebarSection } from "./WorkstreamSidebarSection";

const binding = {
  registryId: "registry",
  ownerId: "owner",
  principalId: "principal",
  authorizationRevision: 1,
  serverGeneration: 7,
  registryVersion: 11,
  permissions: ["workstreams:read" as const],
  contractVersion: "workstreams/1.0.0" as const,
  contractManifest: "6d8da23d51c1bba024dddc4b8d4dd9a594d2f474affd73e4cc7de508b797f557" as const,
};

const data = {
  binding,
  items: [
    {
      workstreamId: "ws-a",
      name: "Alpha",
      lifecycle: "active" as const,
      progress: { state: "progressing" as const },
      delivery: "pr-open" as const,
      freshness: "current" as const,
      sortOrder: 0,
      version: 1,
      updatedAt: "2026-09-12T12:00:00Z",
    },
  ],
  nextCursor: null,
  source: "live" as const,
  stale: false,
};

const detailWithReference = {
  detail: {
    context: { owner_id: "owner", server_generation: 7, registry_version: 11 },
    workstream: {
      workstream_id: "ws-a",
      name: "Alpha detail",
      lifecycle: "active",
      version: 1,
    },
  },
  memberships: {
    context: {},
    items: [
      {
        membership_id: "membership-a",
        native_reference_id: "reference-a",
        kind: "primary",
        closed: null,
      },
    ],
    next_cursor: null,
  },
  declarations: { context: {}, items: [], next_cursor: null },
  edges: { context: {}, items: [], next_cursor: null },
  history: { context: {}, items: [], next_cursor: null },
  references: {
    context: {},
    items: [
      {
        native_reference_id: "reference-a",
        identity: {
          provider: "github",
          source_instance_id: "github-owner",
          resource_kind: "pull_request",
          id_kind: "external",
          native_id: "jones-systems/t3code#5",
          account_provenance: { kind: "not_account_scoped" },
        },
        pr_locator: {
          host: "github.com",
          repository_owner: "jones-systems",
          repository_name: "t3code",
          number: 5,
        },
      },
    ],
    next_cursor: null,
  },
} as unknown as WorkstreamDetailView;

function containsText(node: unknown, text: string): boolean {
  if (typeof node === "string") return node.includes(text);
  if (Array.isArray(node)) return node.some((child) => containsText(child, text));
  if (!isValidElement<Record<string, unknown>>(node)) return false;
  return Object.values(node.props).some((value) => containsText(value, text));
}

function findElement(
  node: unknown,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
) {
  return visitElements(node, predicate) as ReactElement<Record<string, unknown>> | undefined;
}

describe("Workstream sidebar binding cancellation", () => {
  afterEach(() => hooks.reset());

  it.each([
    ["registry", { registryId: "registry-replaced" }],
    [
      "contract",
      {
        contractManifest:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as typeof binding.contractManifest,
      },
    ],
  ])("cannot commit deferred detail after a %s-only binding change", async (_name, change) => {
    let resolveDetail!: (value: WorkstreamDetailView) => void;
    const pendingDetail = new Promise<WorkstreamDetailView>((resolve) => {
      resolveDetail = resolve;
    });
    const loadDetail = vi.fn(
      (_workstreamId: string, _options?: { readonly signal?: AbortSignal }) => pendingDetail,
    );
    let controller: WorkstreamListView = {
      placementInventory: { coverage: "complete", identities: [], json: "[]", totalIdentities: 0 },
      placements: null,
      data,
      error: null,
      loading: false,
      refresh: vi.fn(),
      submit: vi.fn(),
      runBindingOperation: vi.fn(),
      loadDetail,
      loadReference: vi.fn(),
    };

    hooks.beginRender();
    const initial = WorkstreamSidebarSection({ controller });
    const alpha = visitElements(
      initial,
      (element) => element.type === "button" && containsText(element, "Alpha"),
    ) as ReactElement<{ onClick: () => void }> | undefined;
    alpha?.props.onClick();
    const signal = loadDetail.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);

    controller = {
      ...controller,
      data: { ...data, binding: { ...binding, ...change } },
    };
    hooks.beginRender();
    WorkstreamSidebarSection({ controller });
    expect(signal?.aborted).toBe(true);

    resolveDetail(detailWithReference);
    await pendingDetail;
    await Promise.resolve();

    hooks.beginRender();
    const current = WorkstreamSidebarSection({ controller });
    expect(containsText(current, "Alpha detail")).toBe(false);
  });

  it("cannot commit detail from a replaced non-null authorization snapshot", async () => {
    let resolveDetail!: (value: WorkstreamDetailView) => void;
    const pendingDetail = new Promise<WorkstreamDetailView>((resolve) => {
      resolveDetail = resolve;
    });
    const loadDetail = vi.fn(
      (_workstreamId: string, _options?: { readonly signal?: AbortSignal }) => pendingDetail,
    );
    const loadReference = vi.fn();
    let controller: WorkstreamListView = {
      placementInventory: { coverage: "complete", identities: [], json: "[]", totalIdentities: 0 },
      placements: null,
      data,
      error: null,
      loading: false,
      refresh: vi.fn(),
      submit: vi.fn(),
      runBindingOperation: vi.fn(),
      loadDetail,
      loadReference,
    };

    hooks.beginRender();
    const initial = WorkstreamSidebarSection({ controller });
    const alpha = visitElements(
      initial,
      (element) => element.type === "button" && containsText(element, "Alpha"),
    ) as ReactElement<{ onClick: () => void }> | undefined;
    expect(alpha).toBeDefined();
    alpha?.props.onClick();
    const signal = loadDetail.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    controller = {
      ...controller,
      data: {
        ...data,
        binding: { ...binding, authorizationRevision: 2, registryVersion: 12 },
      },
    };
    hooks.beginRender();
    WorkstreamSidebarSection({ controller });
    expect(signal?.aborted).toBe(true);

    resolveDetail(detailWithReference);
    await pendingDetail;
    await Promise.resolve();

    hooks.beginRender();
    const current = WorkstreamSidebarSection({ controller });
    expect(containsText(current, "Alpha detail")).toBe(false);
    expect(loadReference).not.toHaveBeenCalled();
  });

  it("cannot commit a linked-PR status from a replaced authorization snapshot", async () => {
    let resolveStaleReference!: (value: unknown) => void;
    const staleReference = new Promise((resolve) => {
      resolveStaleReference = resolve;
    });
    const pendingCurrentReference = new Promise(() => undefined);
    const loadDetail = vi.fn(async () => detailWithReference);
    const loadReference = vi
      .fn()
      .mockImplementationOnce(() => staleReference)
      .mockImplementation(() => pendingCurrentReference);
    let controller = {
      placementInventory: {
        coverage: "complete" as const,
        identities: [],
        json: "[]",
        totalIdentities: 0,
      },
      placements: null,
      data,
      error: null,
      loading: false,
      refresh: vi.fn(),
      submit: vi.fn(),
      runBindingOperation: vi.fn(),
      loadDetail,
      loadReference,
    } as WorkstreamListView;

    hooks.beginRender();
    const initial = WorkstreamSidebarSection({ controller });
    const initialAlpha = visitElements(
      initial,
      (element) => element.type === "button" && containsText(element, "Alpha"),
    ) as ReactElement<{ onClick: () => void }> | undefined;
    initialAlpha?.props.onClick();
    await Promise.resolve();
    expect(loadReference).toHaveBeenCalledTimes(1);

    controller = {
      ...controller,
      data: {
        ...data,
        binding: { ...binding, authorizationRevision: 2, registryVersion: 12 },
      },
    };
    hooks.beginRender();
    WorkstreamSidebarSection({ controller });
    resolveStaleReference({
      latest_observation: { last_success: { state: "STALE STATUS" } },
    });
    await staleReference;
    await Promise.resolve();
    expect(JSON.stringify(hooks.snapshot())).not.toContain("STALE STATUS");

    hooks.beginRender();
    const afterStaleResolution = WorkstreamSidebarSection({ controller });
    expect(containsText(afterStaleResolution, "STALE STATUS")).toBe(false);

    hooks.beginRender();
    const rebound = WorkstreamSidebarSection({ controller });
    const reboundAlpha = visitElements(
      rebound,
      (element) => element.type === "button" && containsText(element, "Alpha"),
    ) as ReactElement<{ onClick: () => void }> | undefined;
    reboundAlpha?.props.onClick();
    await Promise.resolve();

    hooks.beginRender();
    const current = WorkstreamSidebarSection({ controller });
    expect(containsText(current, "STALE STATUS")).toBe(false);
    expect(containsText(current, "loading")).toBe(true);
    expect(loadReference).toHaveBeenCalledTimes(2);
  });

  it("cancels a pending manual PR refresh when the binding changes", async () => {
    let resolveReference!: (value: unknown) => void;
    const pendingReference = new Promise((resolve) => {
      resolveReference = resolve;
    });
    const loadDetail = vi.fn(async () => detailWithReference);
    const loadReference = vi
      .fn()
      .mockResolvedValueOnce({
        latest_observation: { observation_version: 1, last_success: { state: "OPEN" } },
      })
      .mockImplementationOnce(() => pendingReference);
    const submit = vi.fn();
    let controller = {
      placementInventory: {
        coverage: "complete" as const,
        identities: [],
        json: "[]",
        totalIdentities: 0,
      },
      placements: null,
      data,
      error: null,
      loading: false,
      refresh: vi.fn(),
      submit,
      runBindingOperation: vi.fn(),
      loadDetail,
      loadReference,
    } as WorkstreamListView;

    hooks.beginRender();
    const initial = WorkstreamSidebarSection({ controller });
    const alpha = visitElements(
      initial,
      (element) => element.type === "button" && containsText(element, "Alpha"),
    ) as ReactElement<{ onClick: () => void }> | undefined;
    alpha?.props.onClick();
    await Promise.resolve();
    await Promise.resolve();

    hooks.beginRender();
    const detailed = WorkstreamSidebarSection({ controller });
    const refreshStatus = visitElements(
      detailed,
      (element) =>
        element.props.children === "Refresh status" && typeof element.props.onClick === "function",
    ) as ReactElement<{ onClick: () => void }> | undefined;
    expect(refreshStatus).toBeDefined();
    const automaticSignal = loadReference.mock.calls[0]?.[1]?.signal;
    refreshStatus?.props.onClick();
    const signal = loadReference.mock.calls
      .map((call) => call[1]?.signal)
      .find((candidate) => candidate !== undefined && candidate !== automaticSignal);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    controller = {
      ...controller,
      data: {
        ...data,
        binding: { ...binding, authorizationRevision: 2, registryVersion: 12 },
      },
    };
    hooks.beginRender();
    WorkstreamSidebarSection({ controller });
    expect(signal?.aborted).toBe(true);

    resolveReference({
      latest_observation: { observation_version: 1, last_success: { state: "OPEN" } },
    });
    await pendingReference;
    await Promise.resolve();
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not commit command UI after its binding is replaced", async () => {
    let resolveSubmit!: (value: unknown) => void;
    const pendingSubmit = new Promise((resolve) => {
      resolveSubmit = resolve;
    });
    const loadDetail = vi.fn(async () => detailWithReference);
    const controllerBase = {
      placementInventory: {
        coverage: "complete" as const,
        identities: [],
        json: "[]",
        totalIdentities: 0,
      },
      placements: null,
      data,
      error: null,
      loading: false,
      refresh: vi.fn(),
      submit: vi.fn(() => pendingSubmit),
      runBindingOperation: vi.fn(),
      loadDetail,
      loadReference: vi.fn(async () => ({ latest_observation: null })),
    } as unknown as WorkstreamListView;
    let controller = controllerBase;

    hooks.beginRender();
    const initial = WorkstreamSidebarSection({ controller });
    const alpha = visitElements(
      initial,
      (element) => element.type === "button" && containsText(element, "Alpha"),
    ) as ReactElement<{ onClick: () => void }> | undefined;
    alpha?.props.onClick();
    await Promise.resolve();
    await Promise.resolve();

    hooks.beginRender();
    const detailed = WorkstreamSidebarSection({ controller });
    const lifecycle = visitElements(
      detailed,
      (element) =>
        element.type === "select" && element.props["aria-label"] === "Workstream lifecycle",
    ) as ReactElement<{ onChange: (event: { target: { value: string } }) => void }> | undefined;
    expect(lifecycle).toBeDefined();
    lifecycle?.props.onChange({ target: { value: "paused" } });
    await vi.waitFor(() => expect(controller.submit).toHaveBeenCalledTimes(1));

    controller = {
      ...controller,
      data: {
        ...data,
        binding: { ...binding, authorizationRevision: 2, registryVersion: 12 },
      },
    };
    hooks.beginRender();
    WorkstreamSidebarSection({ controller });

    resolveSubmit({
      command_id: "command-a",
      operation: "update_workstream",
      accepted_at: "2026-09-12T12:00:00Z",
      state: "committed",
      completed_at: "2026-09-12T12:00:01Z",
      registry_version: 12,
      changed: true,
      effects: {
        workstream_versions: [{ workstream_id: "ws-a", version: 2 }],
        native_reference_id: null,
        membership_ids: [],
        declaration_id: null,
        declaration_revision: null,
        edge_id: null,
        observation: null,
        registration: null,
        lifecycle_declaration: null,
        coordination_disposition: null,
        native_settlement: null,
      },
    });
    await pendingSubmit;
    await Promise.resolve();

    expect(controller.submit).toHaveBeenCalledTimes(1);
    expect(loadDetail).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(hooks.snapshot())).not.toContain("command-a");
  });

  it("keeps a multi-step reorder in one binding operation until every step settles", async () => {
    let resolveSecond!: (value: unknown) => void;
    const second = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    const refresh = vi.fn();
    const stepReceipts = [
      {
        state: "committed",
        registry_version: 12,
        effects: {
          workstream_versions: [
            { workstream_id: "ws-c", version: 2 },
            { workstream_id: "ws-a", version: 5 },
          ],
        },
      },
      second,
      {
        state: "committed",
        registry_version: 14,
        effects: { workstream_versions: [{ workstream_id: "ws-b", version: 10 }] },
      },
    ];
    const submitStep = vi.fn(async (_command: unknown) => {
      const value = stepReceipts.shift();
      return await Promise.resolve(value);
    });
    const runBindingOperation = vi.fn(async (operation: (submit: typeof submitStep) => unknown) => {
      const value = await operation(submitStep);
      refresh();
      return value;
    });
    const items = [
      data.items[0],
      { ...data.items[0]!, workstreamId: "ws-b", name: "Beta", sortOrder: 1 },
      { ...data.items[0]!, workstreamId: "ws-c", name: "Gamma", sortOrder: 2 },
    ];
    const controller = {
      placementInventory: { coverage: "complete", identities: [], json: "[]", totalIdentities: 0 },
      placements: null,
      data: { ...data, items },
      error: null,
      loading: false,
      refresh,
      submit: vi.fn(async () => {
        throw new Error("reorder used per-command submission");
      }),
      runBindingOperation,
      loadDetail: vi.fn(),
      loadReference: vi.fn(),
    } as unknown as WorkstreamListView;

    hooks.beginRender();
    const initial = WorkstreamSidebarSection({ controller });
    const gamma = findElement(
      initial,
      (element) => element.type === "li" && containsText(element, "Gamma"),
    ) as ReactElement<{ onDragStart: () => void }> | undefined;
    gamma?.props.onDragStart();

    hooks.beginRender();
    const dragging = WorkstreamSidebarSection({ controller });
    const alpha = findElement(
      dragging,
      (element) => element.type === "li" && containsText(element, "Alpha"),
    ) as ReactElement<{ onDrop: (event: { preventDefault: () => void }) => void }> | undefined;
    alpha?.props.onDrop({ preventDefault: vi.fn() });

    await vi.waitFor(() => expect(submitStep).toHaveBeenCalledTimes(2));
    expect(runBindingOperation).toHaveBeenCalledTimes(1);
    expect(controller.submit).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(submitStep.mock.calls[1]?.[0]).toMatchObject({
      expected_registry_version: 12,
      action: { workstream_id: "ws-a", expected_version: 5 },
    });

    resolveSecond({
      state: "committed",
      registry_version: 13,
      effects: {
        workstream_versions: [
          { workstream_id: "ws-a", version: 6 },
          { workstream_id: "ws-b", version: 9 },
        ],
      },
    });
    await vi.waitFor(() => expect(submitStep).toHaveBeenCalledTimes(3));
    expect(submitStep.mock.calls[2]?.[0]).toMatchObject({
      expected_registry_version: 13,
      action: { workstream_id: "ws-b", expected_version: 9 },
    });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
