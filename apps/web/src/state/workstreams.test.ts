import {
  EnvironmentHttpConflictError,
  type WorkstreamDetail,
  type WorkstreamReadContext,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  loadCompleteWorkstreamDetail,
  loadCompleteWorkstreamList,
  nativePlacementInventoryJson,
  type WorkstreamDetailLoaders,
} from "./workstreams";

const binding = {
  registryId: "registry",
  ownerId: "owner",
  principalId: "principal",
  authorizationRevision: 1,
  serverGeneration: 7,
  registryVersion: 11,
  permissions: ["workstreams:read" as const],
  contractVersion: "workstreams/1.0.0" as const,
  contractManifest: "a03e34613ea1293b579316a21f98d4edd69a19221f9907cf0449e3b4933420dd" as const,
};

const context: WorkstreamReadContext = {
  owner_id: "owner",
  server_generation: 7,
  registry_version: 11,
};
const detail = { context, workstream: {} } as WorkstreamDetail;
const emptyPage = { context, items: [], next_cursor: null } as const;

const detailLoaders = (
  calls: Record<keyof WorkstreamDetailLoaders, Array<string | undefined>>,
  memberships: WorkstreamDetailLoaders["memberships"],
): WorkstreamDetailLoaders => ({
  detail: async () => {
    calls.detail.push(undefined);
    return detail;
  },
  memberships,
  declarations: async (cursor) => {
    calls.declarations.push(cursor);
    return emptyPage;
  },
  edges: async (cursor) => {
    calls.edges.push(cursor);
    return emptyPage;
  },
  history: async (cursor) => {
    calls.history.push(cursor);
    return emptyPage;
  },
  references: async (cursor) => {
    calls.references.push(cursor);
    return emptyPage;
  },
});

const detailCalls = (): Record<keyof WorkstreamDetailLoaders, Array<string | undefined>> => ({
  detail: [],
  memberships: [],
  declarations: [],
  edges: [],
  history: [],
  references: [],
});

describe("complete Workstream list loading", () => {
  it("projects only stable native identity pairs, preserves colon IDs and caps excess inventory", () => {
    const threads = [
      { environmentId: "a:b", id: "c", title: "private" },
      { environmentId: "a", id: "b:c", title: "private" },
    ];
    const inventory = nativePlacementInventoryJson([...threads, threads[0]!]);
    expect(JSON.parse(inventory)).toHaveLength(2);
    expect(inventory).not.toContain("private");
    expect(
      nativePlacementInventoryJson(
        [...threads].reverse().map((value) => ({ ...value, title: "changed" })),
      ),
    ).toBe(inventory);
    expect(
      JSON.parse(
        nativePlacementInventoryJson(
          Array.from({ length: 20_000 }, (_, i) => ({ environmentId: "env", id: String(i) })),
        ),
      ),
    ).toHaveLength(1001);
  });
  it("loads across page boundaries before exposing an owner list", async () => {
    const cursors: Array<string | undefined> = [];
    const result = await loadCompleteWorkstreamList(async (cursor) => {
      cursors.push(cursor);
      return {
        binding,
        items: [],
        nextCursor: cursor === undefined ? "second-page" : null,
        source: "live",
        stale: false,
      };
    });
    expect(cursors).toEqual([undefined, "second-page"]);
    expect(result.nextCursor).toBeNull();
  });

  it("rejects a partial list when a later page fails", async () => {
    await expect(
      loadCompleteWorkstreamList(async (cursor) => {
        if (cursor) throw new Error("later-page-conflict");
        return {
          binding,
          items: [],
          nextCursor: "second-page",
          source: "live",
          stale: false,
        };
      }),
    ).rejects.toThrow("later-page-conflict");
  });

  it("restarts a stale page sequence with bounded backoff before exposing data", async () => {
    const cursors: Array<string | undefined> = [];
    const wait = vi.fn(async () => undefined);
    let attempt = 0;
    const result = await loadCompleteWorkstreamList(
      async (cursor) => {
        cursors.push(cursor);
        if (cursor === undefined) {
          attempt += 1;
          return {
            binding,
            items: [],
            nextCursor: attempt === 1 ? "stale" : "fresh",
            source: "live" as const,
            stale: false,
          };
        }
        if (cursor === "stale")
          throw new EnvironmentHttpConflictError({ message: "workstream_cursor_stale" });
        return { binding, items: [], nextCursor: null, source: "live" as const, stale: false };
      },
      { wait },
    );
    expect(cursors).toEqual([undefined, "stale", undefined, "fresh"]);
    expect(wait).toHaveBeenCalledWith(50);
    expect(result.nextCursor).toBeNull();
  });

  it("fails closed after three stale page sequences", async () => {
    const wait = vi.fn(async () => undefined);
    let firstPages = 0;
    await expect(
      loadCompleteWorkstreamList(
        async (cursor) => {
          if (cursor !== undefined)
            throw new EnvironmentHttpConflictError({ message: "workstream_cursor_stale" });
          firstPages += 1;
          return {
            binding,
            items: [],
            nextCursor: `stale-${firstPages}`,
            source: "live" as const,
            stale: false,
          };
        },
        { wait },
      ),
    ).rejects.toMatchObject({ message: "workstream_cursor_stale" });
    expect(firstPages).toBe(3);
    expect(wait.mock.calls).toEqual([[50], [100]]);
  });
});

describe("complete Workstream detail loading", () => {
  it("restarts every detail component when a later page becomes stale", async () => {
    const calls = detailCalls();
    const wait = vi.fn(async () => undefined);
    let round = 0;
    const loaders = detailLoaders(calls, async (cursor) => {
      calls.memberships.push(cursor);
      if (cursor === undefined) {
        round += 1;
        return { ...emptyPage, next_cursor: round === 1 ? "stale" : null };
      }
      throw new EnvironmentHttpConflictError({ message: "workstream_cursor_stale" });
    });

    const result = await loadCompleteWorkstreamDetail(loaders, { wait });

    expect(result.detail).toBe(detail);
    expect(calls.memberships).toEqual([undefined, "stale", undefined]);
    for (const name of ["detail", "declarations", "edges", "history", "references"] as const)
      expect(calls[name]).toHaveLength(2);
    expect(wait.mock.calls).toEqual([[50]]);
  });

  it("fails closed after three complete detail rounds under sustained churn", async () => {
    const calls = detailCalls();
    const wait = vi.fn(async () => undefined);
    const loaders = detailLoaders(calls, async (cursor) => {
      calls.memberships.push(cursor);
      if (cursor === undefined) return { ...emptyPage, next_cursor: "stale" };
      throw new EnvironmentHttpConflictError({ message: "workstream_cursor_stale" });
    });

    await expect(loadCompleteWorkstreamDetail(loaders, { wait })).rejects.toMatchObject({
      message: "workstream_cursor_stale",
    });

    expect(calls.memberships).toEqual([undefined, "stale", undefined, "stale", undefined, "stale"]);
    for (const name of ["detail", "declarations", "edges", "history", "references"] as const)
      expect(calls[name]).toHaveLength(3);
    expect(wait.mock.calls).toEqual([[50], [100]]);
  });
});
