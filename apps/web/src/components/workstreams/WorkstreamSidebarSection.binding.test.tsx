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

describe("Workstream sidebar binding cancellation", () => {
  afterEach(() => hooks.reset());

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
});
