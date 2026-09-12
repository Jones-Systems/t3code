import { describe, expect, it } from "vite-plus/test";

import { loadCompleteWorkstreamList } from "./workstreams";

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
