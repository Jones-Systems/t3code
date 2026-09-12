import { describe, expect, it } from "vite-plus/test";
import type {
  T3PlacementResult,
  T3ThreadPlacement,
  T3WorkstreamListResult,
} from "@t3tools/contracts";
import { loadLiveT3Placements } from "./placements.ts";

const now = Date.parse("2026-09-12T12:00:00Z");
const metadata: T3WorkstreamListResult = {
  binding: {
    registryId: "registry",
    ownerId: "owner",
    principalId: "principal",
    authorizationRevision: 3,
    serverGeneration: 2,
    registryVersion: 8,
    permissions: ["workstreams:read"],
    contractVersion: "workstreams/1.0.0",
    contractManifest: "a03e34613ea1293b579316a21f98d4edd69a19221f9907cf0449e3b4933420dd",
  },
  items: [],
  nextCursor: null,
  source: "live",
  stale: false,
};
const item = (index: number): T3ThreadPlacement => ({
  membership_id: `membership:${String(index).padStart(3, "0")}`,
  workstream_id: "workstream:1",
  native_reference_id: `reference:${String(index).padStart(3, "0")}`,
  kind: "primary",
  source_instance_id: "environment:1",
  native_thread_id: `thread:${index}`,
  attestation_version: 2,
  attested_at: "2026-09-12T11:00:00.000Z",
  expires_at: "2026-09-12T13:00:00.000Z",
  evidence_sha256: "a".repeat(64),
  source_binding_version: 4,
  authority_namespace: "t3:store",
  store_generation: 9,
});
const page = (index: number, cursor: string | null = null): T3PlacementResult => ({
  page: {
    context: {
      owner_id: "owner",
      principal_id: "principal",
      authorization_revision: 3,
      server_generation: 2,
      registry_version: 8,
    },
    items: [item(index)],
    next_cursor: cursor,
  },
  trustedEnvironments: [],
  readiness: "trust-provider-required",
});

describe("live placement page assembly", () => {
  it("continues empty pages when excluded references advance a distinct cursor", async () => {
    const first = { ...page(0, "next"), page: { ...page(0, "next").page, items: [] } };
    const result = await loadLiveT3Placements(
      metadata,
      async (cursor) => (cursor ? page(1) : first),
      () => now,
    );
    expect(result.items).toEqual([item(1)]);
  });
  it("loads all pages once without deriving native trust from registry evidence", async () => {
    const result = await loadLiveT3Placements(
      metadata,
      async (cursor) => (cursor ? page(1) : page(0, "next")),
      () => now,
    );
    expect(result.items).toHaveLength(2);
    expect(result.trustedEnvironments).toEqual([]);
    expect(result.readiness).toBe("trust-provider-required");
  });
  it("rejects each changed binding field on a later page", async () => {
    for (const field of [
      "owner_id",
      "principal_id",
      "authorization_revision",
      "server_generation",
      "registry_version",
    ] as const) {
      await expect(
        loadLiveT3Placements(
          metadata,
          async (cursor) => {
            const value = page(cursor ? 1 : 0, cursor ? null : "next");
            return cursor
              ? {
                  ...value,
                  page: {
                    ...value.page,
                    context: {
                      ...value.page.context,
                      [field]: typeof value.page.context[field] === "string" ? "foreign" : 99,
                    },
                  },
                }
              : value;
          },
          () => now,
        ),
      ).rejects.toThrow("revision changed");
    }
  });
  it("rejects repeated cursor/membership, reversed order, expiry, excess data, or trust changes", async () => {
    const variants: T3PlacementResult[] = [
      page(0),
      { ...page(1), page: { ...page(1).page, next_cursor: "next" } },
      {
        ...page(1),
        page: { ...page(1).page, items: [{ ...item(1), expires_at: "2026-09-12T12:00:00Z" }] },
      },
      {
        ...page(1),
        readiness: "ready",
        trustedEnvironments: [
          { environmentId: "environment:1", authorityNamespace: "t3:store", storeGeneration: 9 },
        ],
      },
    ];
    for (const value of variants) {
      await expect(
        loadLiveT3Placements(
          metadata,
          async (cursor) => (cursor ? value : page(0, "next")),
          () => now,
        ),
      ).rejects.toThrow();
    }
    await expect(
      loadLiveT3Placements(
        metadata,
        async () => ({ ...page(1), content: "private" }),
        () => now,
      ),
    ).rejects.toThrow();
    await expect(
      loadLiveT3Placements(
        { ...metadata, source: "cache" },
        async () => page(0),
        () => now,
      ),
    ).rejects.toThrow();
  });
  it("bounds total page work at 100 and rejects partial success", async () => {
    let calls = 0;
    await expect(
      loadLiveT3Placements(
        metadata,
        async () => page(calls++, `next-${calls}`),
        () => now,
      ),
    ).rejects.toThrow("workload exceeded");
    expect(calls).toBe(100);
  });
});
