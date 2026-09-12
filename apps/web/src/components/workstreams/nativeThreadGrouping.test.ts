import { describe, expect, it } from "vite-plus/test";

import { groupNativeThreadsByWorkstream } from "./nativeThreadGrouping";

const ws = (workstreamId: string, sortOrder: number) => ({
  workstreamId,
  name: workstreamId,
  lifecycle: "active" as const,
  progress: { state: "progressing" as const },
  delivery: "none-observed" as const,
  freshness: "current" as const,
  sortOrder,
  version: 1,
  updatedAt: "2026-09-12T12:00:00Z",
});
const ref = (nativeReferenceId: string, environmentId: string, threadId: string) => ({
  native_reference_id: nativeReferenceId,
  owner_id: "owner",
  identity: {
    provider: "t3",
    source_instance_id: environmentId,
    resource_kind: "thread",
    id_kind: "internal" as const,
    native_id: threadId,
    account_provenance: { kind: "not_account_scoped" as const },
  },
  pr_locator: null,
  registration: {
    state: "verification-pending" as const,
    attestation_version: 0,
    attested_at: null,
    expires_at: null,
    evidence: null,
  },
  created_at: "2026-09-12T12:00:00Z",
  created_by: { principal_id: "principal" },
  created_registry_version: 1,
});
const member = (
  id: string,
  workstreamId: string,
  referenceId: string,
  kind: "primary" | "secondary" = "primary",
) => ({
  membership_id: id,
  workstream_id: workstreamId,
  native_reference_id: referenceId,
  kind,
  opened: {
    at: "2026-09-12T12:00:00Z",
    actor: { principal_id: "principal" },
    command_id: "command-open-0001",
    registry_version: 1,
  },
  closed: null,
});

describe("native Workstream thread grouping", () => {
  it("places each primary once in owner order and preserves native thread order", () => {
    const threads = [
      { environmentId: "env-b", id: "same", projectId: "project-b" },
      { environmentId: "env-a", id: "same", projectId: "project-a" },
      { environmentId: "env-a", id: "free", projectId: "project-a" },
    ];
    const result = groupNativeThreadsByWorkstream({
      workstreams: [ws("ws-b", 0), ws("ws-a", 0)],
      references: [ref("ref-a", "env-a", "same"), ref("ref-b", "env-b", "same")],
      memberships: [member("m-a", "ws-a", "ref-a"), member("m-b", "ws-b", "ref-b")],
      threads,
    });
    expect(result.groups.map((group) => group.workstream.workstreamId)).toEqual(["ws-b", "ws-a"]);
    expect(result.ordered.map((thread) => `${thread.environmentId}:${thread.id}`)).toEqual([
      "env-b:same",
      "env-a:same",
      "env-a:free",
    ]);
    expect(new Set(result.ordered).size).toBe(3);
    expect(result.groups[1]?.threads[0]?.projectId).toBe("project-a");
  });

  it("ignores closed and foreign references, records secondary links, and exposes conflicts", () => {
    const closed = {
      ...member("closed", "ws-a", "ref-closed"),
      closed: {
        ...member("x", "x", "x").opened,
        reason: "removed" as const,
        other_reason: null,
      },
    };
    const foreign = {
      ...ref("foreign", "env", "foreign"),
      identity: { ...ref("foreign", "env", "foreign").identity, provider: "github" },
    };
    const result = groupNativeThreadsByWorkstream({
      workstreams: [ws("ws-a", 0), ws("ws-b", 1)],
      references: [ref("shared", "env", "thread"), ref("ref-closed", "env", "closed"), foreign],
      memberships: [
        member("p-a", "ws-a", "shared"),
        member("p-b", "ws-b", "shared"),
        member("s", "ws-b", "shared", "secondary"),
        closed,
        member("f", "ws-a", "foreign"),
      ],
      threads: [
        { environmentId: "env", id: "thread" },
        { environmentId: "env", id: "closed" },
        { environmentId: "env", id: "foreign" },
      ],
    });
    expect(result.groups).toHaveLength(0);
    expect(result.ungrouped).toHaveLength(3);
    expect(result.conflictingKeys.has("env:thread")).toBe(true);
    expect(result.secondaryWorkstreamIdsByKey.get("env:thread")).toEqual(["ws-b"]);
  });
});
