import type {
  T3WorkstreamBinding,
  T3WorkstreamListResult,
  WorkstreamCommand,
  WorkstreamReceipt,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness as hooks } from "../test/reactHookHarness";

const runtime = vi.hoisted(() => ({
  responses: [] as Promise<unknown>[],
  signals: [] as Array<AbortSignal | undefined>,
  runPrimaryHttp: vi.fn(
    (_effect: unknown, options?: { readonly signal?: AbortSignal }): Promise<unknown> => {
      const response = runtime.responses.shift();
      if (!response) throw new Error("Unexpected Workstream HTTP request");
      runtime.signals.push(options?.signal);
      return response;
    },
  ),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../test/reactHookHarness");
  return {
    ...actual,
    useCallback: reactHookHarness.useCallback,
    useEffect: (effect: () => void | (() => void), dependencies?: readonly unknown[]) =>
      reactHookHarness.useEffect(
        effect,
        dependencies?.map((dependency) =>
          typeof dependency === "object" ? JSON.stringify(dependency) : dependency,
        ),
      ),
    useMemo: reactHookHarness.useMemo,
    useRef: reactHookHarness.useRef,
    useState: reactHookHarness.useState,
  };
});

vi.mock("../lib/runtime", () => ({ runPrimaryHttp: runtime.runPrimaryHttp }));

import { useWorkstreams } from "./workstreams";

const binding = (overrides: Partial<T3WorkstreamBinding> = {}): T3WorkstreamBinding => ({
  registryId: "registry",
  ownerId: "owner",
  principalId: "principal",
  authorizationRevision: 1,
  serverGeneration: 7,
  registryVersion: 11,
  permissions: ["workstreams:read", "workstreams:write"],
  contractVersion: "workstreams/1.0.0",
  contractManifest: "6d8da23d51c1bba024dddc4b8d4dd9a594d2f474affd73e4cc7de508b797f557",
  ...overrides,
});

const list = (value: T3WorkstreamBinding): T3WorkstreamListResult => ({
  binding: value,
  items: [],
  nextCursor: null,
  source: "live",
  stale: false,
});

const command = {
  command_id: "command-a",
  expected_server_generation: 7,
  expected_registry_version: 11,
  action: {
    operation: "update_workstream",
    workstream_id: "ws-a",
    expected_version: 1,
    name: "Alpha",
    lifecycle: "active",
    progress: { state: "progressing" },
    sort_order: 0,
  },
} as WorkstreamCommand;

const committed = {
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
} as unknown as WorkstreamReceipt;

const pending = {
  command_id: "command-a",
  operation: "update_workstream",
  accepted_at: "2026-09-12T12:00:00Z",
  state: "pending",
  retry_after_seconds: 1,
} as WorkstreamReceipt;

const deferred = <A>() => {
  let resolve!: (value: A) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<A>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const flush = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

async function initialController() {
  runtime.responses.push(Promise.resolve(list(binding())));
  hooks.beginRender();
  useWorkstreams(false);
  await flush();
  hooks.beginRender();
  const controller = useWorkstreams(false);
  expect(
    controller.data?.binding.registryVersion,
    controller.error ?? JSON.stringify(hooks.snapshot()),
  ).toBe(11);
  return controller;
}

async function replaceBinding(
  controller: ReturnType<typeof useWorkstreams>,
  nextBinding: T3WorkstreamBinding,
) {
  runtime.responses.push(Promise.resolve(list(nextBinding)));
  controller.refresh();
  hooks.beginRender();
  useWorkstreams(false);
  await flush();
  hooks.beginRender();
  const rebound = useWorkstreams(false);
  expect(rebound.data?.binding).toEqual(nextBinding);
  return rebound;
}

describe("Workstream command binding ownership", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      clearTimeout: vi.fn(),
      setTimeout: vi.fn(() => 1),
    });
  });

  afterEach(() => {
    hooks.reset();
    runtime.responses = [];
    runtime.signals = [];
    runtime.runPrimaryHttp.mockClear();
    vi.unstubAllGlobals();
  });

  it("does not refresh or purge the replacement binding after deferred command success", async () => {
    const controller = await initialController();
    const response = deferred<WorkstreamReceipt>();
    runtime.responses.push(response.promise);
    const submission = controller.submit(command);
    expect(runtime.runPrimaryHttp).toHaveBeenCalledTimes(2);

    const replacement = binding({ registryId: "registry-replaced", registryVersion: 1 });
    let rebound = await replaceBinding(controller, replacement);
    response.resolve(committed);
    await expect(submission).rejects.toMatchObject({ name: "AbortError" });
    await flush();

    hooks.beginRender();
    rebound = useWorkstreams(false);
    expect(rebound.data?.binding).toEqual(replacement);
    expect(runtime.runPrimaryHttp).toHaveBeenCalledTimes(3);
  });

  it("does not purge the replacement binding after deferred command failure", async () => {
    const controller = await initialController();
    const response = deferred<WorkstreamReceipt>();
    runtime.responses.push(response.promise);
    const submission = controller.submit(command);
    const failure = new Error("stale-command-failure");

    const replacement = binding({ contractManifest: "changed" as never, registryVersion: 1 });
    let rebound = await replaceBinding(controller, replacement);
    response.reject(failure);
    await expect(submission).rejects.toBe(failure);
    await flush();

    hooks.beginRender();
    rebound = useWorkstreams(false);
    expect(rebound.data?.binding).toEqual(replacement);
    expect(runtime.runPrimaryHttp).toHaveBeenCalledTimes(3);
  });

  it("aborts pending receipt delay on binding replacement without another GET", async () => {
    const controller = await initialController();
    runtime.responses.push(Promise.resolve(pending));
    const submission = controller.submit(command);
    await flush();
    expect(runtime.runPrimaryHttp).toHaveBeenCalledTimes(2);

    const replacement = binding({ registryId: "registry-replaced", registryVersion: 1 });
    await replaceBinding(controller, replacement);
    expect(runtime.signals[1]).toBeInstanceOf(AbortSignal);
    expect(runtime.signals[1]?.aborted).toBe(true);
    await expect(submission).rejects.toMatchObject({ name: "AbortError" });

    expect(runtime.runPrimaryHttp).toHaveBeenCalledTimes(3);
  });

  it("aborts pending receipt delay on unmount without another GET", async () => {
    const controller = await initialController();
    runtime.responses.push(Promise.resolve(pending));
    const submission = controller.submit(command);
    await flush();
    expect(runtime.runPrimaryHttp).toHaveBeenCalledTimes(2);

    hooks.reset();
    expect(runtime.signals[1]).toBeInstanceOf(AbortSignal);
    expect(runtime.signals[1]?.aborted).toBe(true);
    await expect(submission).rejects.toMatchObject({ name: "AbortError" });
    expect(runtime.runPrimaryHttp).toHaveBeenCalledTimes(2);
  });

  it("reconciles a pending receipt with one POST and exact same-signal GET", async () => {
    vi.useFakeTimers();
    try {
      const controller = await initialController();
      runtime.responses.push(Promise.resolve(pending), Promise.resolve(committed));
      const submission = controller.submit(command);
      await flush();
      expect(runtime.runPrimaryHttp).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(submission).resolves.toBe(committed);

      expect(runtime.runPrimaryHttp).toHaveBeenCalledTimes(3);
      expect(runtime.signals[1]).toBeInstanceOf(AbortSignal);
      expect(runtime.signals[2]).toBe(runtime.signals[1]);
      expect(runtime.signals[1]?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
