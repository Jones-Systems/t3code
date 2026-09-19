import { EnvironmentHttpConflictError } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { loadCompleteWorkstreamList, nativePlacementInventoryJson } from "./workstreams";

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
