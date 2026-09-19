import { describe, expect, it } from "vite-plus/test";
import { T3_PLACEMENT_MAX_REQUEST_BYTES } from "@t3tools/contracts";

import {
  loadCompleteWorkstreamList,
  nativePlacementInventory,
  nativePlacementInventoryJson,
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
    const excessThreads = Array.from({ length: 20_000 }, (_, i) => ({
      environmentId: "env",
      id: String(i),
    }));
    const excessInventory = nativePlacementInventory(excessThreads);
    expect(excessInventory.identities).toHaveLength(1_000);
    expect(excessInventory.totalIdentities).toBe(20_000);
    expect(excessInventory.coverage).toBe("partial");
    expect(nativePlacementInventory([...excessThreads].reverse())).toEqual(excessInventory);
    expect(nativePlacementInventory(threads).coverage).toBe("complete");

    const byteBoundInventory = nativePlacementInventory(
      Array.from({ length: 900 }, (_, i) => ({
        environmentId: `environment-${String(i).padStart(3, "0")}`,
        id: `${String(i).padStart(3, "0")}-${"x".repeat(508)}`,
      })),
    );
    expect(byteBoundInventory.identities.length).toBeLessThan(900);
    expect(byteBoundInventory.coverage).toBe("partial");
    expect(
      new TextEncoder().encode(JSON.stringify({ identities: byteBoundInventory.identities }))
        .byteLength,
    ).toBeLessThanOrEqual(T3_PLACEMENT_MAX_REQUEST_BYTES);
    const nextIdentity = {
      source_instance_id: `environment-${String(byteBoundInventory.identities.length).padStart(3, "0")}`,
      native_thread_id: `${String(byteBoundInventory.identities.length).padStart(3, "0")}-${"x".repeat(508)}`,
    };
    expect(
      new TextEncoder().encode(
        JSON.stringify({ identities: [...byteBoundInventory.identities, nextIdentity] }),
      ).byteLength,
    ).toBeGreaterThan(T3_PLACEMENT_MAX_REQUEST_BYTES);
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
});
