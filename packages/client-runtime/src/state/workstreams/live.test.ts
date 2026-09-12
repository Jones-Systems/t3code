import { describe, expect, it } from "vite-plus/test";
import type { T3WorkstreamBinding, T3WorkstreamMetadata } from "@t3tools/contracts";

import {
  appendWorkstreamDtoPage,
  LiveWorkstreamMetadataCache,
  orderWorkstreamMetadata,
  planWorkstreamOwnerOrder,
} from "./live.ts";

const item = (workstreamId: string, sortOrder: number): T3WorkstreamMetadata => ({
  workstreamId,
  name: workstreamId,
  lifecycle: "active",
  progress: { state: "progressing" },
  delivery: "none-observed",
  freshness: "current",
  sortOrder,
  version: 1,
  updatedAt: "2026-09-12T12:00:00Z",
});

const binding: T3WorkstreamBinding = {
  registryId: "registry",
  ownerId: "owner",
  principalId: "principal",
  authorizationRevision: 1,
  serverGeneration: 7,
  registryVersion: 11,
  permissions: ["workstreams:read"],
  contractVersion: "workstreams/1.0.0",
  contractManifest: "a03e34613ea1293b579316a21f98d4edd69a19221f9907cf0449e3b4933420dd",
};

describe("live Workstream DTO projection", () => {
  it("uses ASCII IDs for ties and plans the complete final order", () => {
    const items = [item("z", 4), item("a", 4), item("m", 9)];
    expect(orderWorkstreamMetadata(items).map((value) => value.workstreamId)).toEqual([
      "a",
      "z",
      "m",
    ]);
    expect(
      planWorkstreamOwnerOrder(items, "m", 0).map(({ item: value, sortOrder }) => [
        value.workstreamId,
        sortOrder,
      ]),
    ).toEqual([
      ["m", 0],
      ["a", 1],
      ["z", 2],
    ]);
  });

  it("merges only same-binding pages and purges minimized list DTOs on auth loss", () => {
    const first = {
      context: { owner_id: "owner", server_generation: 7, registry_version: 11 },
      items: ["one"],
      next_cursor: "next",
    };
    const merged = appendWorkstreamDtoPage(first, {
      ...first,
      items: ["two"],
      next_cursor: null,
    });
    expect(merged.items).toEqual(["one", "two"]);
    expect(() =>
      appendWorkstreamDtoPage(first, {
        ...first,
        context: { ...first.context, registry_version: 12 },
      }),
    ).toThrow("binding changed");

    const cache = new LiveWorkstreamMetadataCache();
    cache.write({ binding, items: [item("a", 0)], nextCursor: null, source: "live", stale: false });
    expect(cache.read(binding)?.items).toHaveLength(1);
    cache.purgeAuthorization();
    expect(cache.read(binding)).toBeNull();
  });
});
