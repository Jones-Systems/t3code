import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  T3WorkstreamListResult,
  WORKSTREAM_CONTRACT_HEADER_VERSION,
  WORKSTREAM_CONTRACT_MANIFEST_SHA256,
  canonicalGitHubPullRequestUrl,
} from "./workstreams.ts";

describe("Workstream wire contract", () => {
  it("decodes every lifecycle value with a fully fenced client binding", () => {
    const lifecycles = ["planned", "active", "paused", "completed", "deferred", "abandoned"];
    for (const lifecycle of lifecycles) {
      const result = Schema.decodeUnknownSync(T3WorkstreamListResult)({
        binding: {
          registryId: "registry",
          ownerId: "owner",
          principalId: "principal",
          authorizationRevision: 3,
          serverGeneration: 7,
          registryVersion: 11,
          permissions: ["workstreams:read"],
          contractVersion: WORKSTREAM_CONTRACT_HEADER_VERSION,
          contractManifest: WORKSTREAM_CONTRACT_MANIFEST_SHA256,
        },
        items: [
          {
            workstreamId: `ws-${lifecycle}`,
            name: lifecycle,
            lifecycle,
            progress: { state: "progressing" },
            delivery: "none-observed",
            freshness: "current",
            sortOrder: 1,
            version: 1,
            updatedAt: "2026-09-12T12:00:00Z",
          },
        ],
        nextCursor: null,
        source: "live",
        stale: false,
      });
      expect(result.items[0]?.lifecycle).toBe(lifecycle);
    }
  });

  it("constructs only canonical HTTPS GitHub pull-request URLs", () => {
    expect(
      canonicalGitHubPullRequestUrl({
        host: "github.com",
        repository_owner: "Jones-Systems",
        repository_name: "Codex-V3",
        number: 42,
      }),
    ).toBe("https://github.com/Jones-Systems/Codex-V3/pull/42");
    expect(() =>
      canonicalGitHubPullRequestUrl({
        host: "github.com",
        repository_owner: "Jones-Systems/escape",
        repository_name: "Codex-V3",
        number: 42,
      }),
    ).toThrow("Invalid GitHub pull-request locator");
  });
});
