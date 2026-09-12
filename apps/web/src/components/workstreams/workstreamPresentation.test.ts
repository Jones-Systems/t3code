import { describe, expect, it } from "vitest";
import {
  getReceiptSummary,
  getWorkstreamMemberActions,
  pageWindow,
  planWorkstreamDrop,
  planWorkstreamKeyboardMove,
} from "./workstreamPresentation";

describe("workstream member actions", () => {
  it("keeps removal separate from native settlement and provides every reverse path", () => {
    expect(getWorkstreamMemberActions({ association: "primary", isRemoved: false })).toEqual([
      { id: "move", label: "Move to another workstream" },
      { id: "link", label: "Link to another workstream" },
      { id: "remove", label: "Remove from workstream", destructive: true },
    ]);
    expect(getWorkstreamMemberActions({ association: "primary", isRemoved: true })).toEqual([
      { id: "reattach", label: "Reattach to workstream" },
    ]);
  });
});

describe("workstream movement planning", () => {
  it("uses the same reorder command shape for pointer drop and keyboard movement", () => {
    expect(
      planWorkstreamDrop({
        memberRef: "thread:1",
        sourceWorkstreamId: "ws:1",
        targetWorkstreamId: "ws:1",
        targetPosition: 1,
        targetMemberCount: 3,
      }),
    ).toEqual({ type: "reorder", workstreamId: "ws:1", memberRef: "thread:1", position: 1 });
    expect(
      planWorkstreamKeyboardMove({
        workstreamId: "ws:1",
        memberRef: "thread:1",
        currentPosition: 0,
        direction: "down",
        memberCount: 3,
      }),
    ).toEqual({ type: "reorder", workstreamId: "ws:1", memberRef: "thread:1", position: 1 });
  });

  it("plans cross-workstream drops as moves and rejects invalid positions", () => {
    expect(
      planWorkstreamDrop({
        memberRef: "thread:1",
        sourceWorkstreamId: "ws:1",
        targetWorkstreamId: "ws:2",
        targetPosition: 99,
        targetMemberCount: 4,
      }),
    ).toEqual({
      type: "move",
      memberRef: "thread:1",
      fromWorkstreamId: "ws:1",
      toWorkstreamId: "ws:2",
      position: 4,
    });
    expect(
      planWorkstreamDrop({
        memberRef: "thread:1",
        sourceWorkstreamId: "ws:1",
        targetWorkstreamId: "ws:2",
        targetPosition: -1,
        targetMemberCount: 4,
      }),
    ).toBeNull();
  });
});

describe("receipt and paging presentation", () => {
  it("reports a partial result when coordination and native settlement differ", () => {
    const result = getReceiptSummary({
      coordination: { id: "c1", operation: "Remove", state: "succeeded" },
      nativeSettlement: { id: "s1", operation: "Settle", state: "failed" },
    });
    expect(result.isPartial).toBe(true);
    expect(result.coordination.id).toBe("c1");
    expect(result.nativeSettlement.id).toBe("s1");
  });

  it("clamps large-list page requests to a bounded window", () => {
    expect(pageWindow({ items: [1, 2, 3, 4, 5], page: 8, pageSize: 2 })).toEqual({
      items: [5],
      page: 2,
      pageCount: 3,
    });
  });
});
