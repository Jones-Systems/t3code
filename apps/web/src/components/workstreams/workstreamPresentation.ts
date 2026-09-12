import type {
  WorkstreamAssociation,
  WorkstreamMembershipCommand,
  WorkstreamReceiptPresentation,
  WorkstreamReceipts,
} from "./types";

export type WorkstreamMemberAction = "move" | "link" | "remove" | "reattach";

export interface WorkstreamMemberActionItem {
  readonly id: WorkstreamMemberAction;
  readonly label: string;
  readonly destructive?: boolean;
}

export function getWorkstreamMemberActions(input: {
  readonly association: WorkstreamAssociation;
  readonly isRemoved: boolean;
}): readonly WorkstreamMemberActionItem[] {
  if (input.isRemoved) {
    return [{ id: "reattach", label: "Reattach to workstream" }];
  }
  return [
    { id: "move", label: "Move to another workstream" },
    ...(input.association === "primary"
      ? ([{ id: "link", label: "Link to another workstream" }] as const)
      : []),
    { id: "remove", label: "Remove from workstream", destructive: true },
  ];
}

export function planWorkstreamDrop(input: {
  readonly memberRef: string;
  readonly sourceWorkstreamId: string;
  readonly targetWorkstreamId: string;
  readonly targetPosition: number;
  readonly targetMemberCount: number;
}): WorkstreamMembershipCommand | null {
  if (!Number.isInteger(input.targetPosition) || input.targetPosition < 0) return null;
  const position = Math.min(input.targetPosition, input.targetMemberCount);
  if (input.sourceWorkstreamId === input.targetWorkstreamId) {
    return {
      type: "reorder",
      workstreamId: input.sourceWorkstreamId,
      memberRef: input.memberRef,
      position,
    };
  }
  return {
    type: "move",
    memberRef: input.memberRef,
    fromWorkstreamId: input.sourceWorkstreamId,
    toWorkstreamId: input.targetWorkstreamId,
    position,
  };
}

export function planWorkstreamKeyboardMove(input: {
  readonly workstreamId: string;
  readonly memberRef: string;
  readonly currentPosition: number;
  readonly direction: "up" | "down";
  readonly memberCount: number;
}): WorkstreamMembershipCommand | null {
  const delta = input.direction === "up" ? -1 : 1;
  const position = input.currentPosition + delta;
  if (position < 0 || position >= input.memberCount) return null;
  return {
    type: "reorder",
    workstreamId: input.workstreamId,
    memberRef: input.memberRef,
    position,
  };
}

export function getReceiptSummary(receipts: WorkstreamReceipts): {
  readonly coordination: WorkstreamReceiptPresentation;
  readonly nativeSettlement: WorkstreamReceiptPresentation;
  readonly isPartial: boolean;
} {
  const unavailable = (operation: string): WorkstreamReceiptPresentation => ({
    id: `${operation}:not-requested`,
    operation,
    state: "pending",
    message: "Not requested",
  });
  const coordination = receipts.coordination ?? unavailable("Workstream coordination");
  const nativeSettlement = receipts.nativeSettlement ?? unavailable("Native T3 settlement");
  return {
    coordination,
    nativeSettlement,
    isPartial:
      coordination.state !== nativeSettlement.state ||
      (coordination.state === "failed") !== (nativeSettlement.state === "failed"),
  };
}
export function pageWindow<T>(input: {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
}): { readonly items: readonly T[]; readonly page: number; readonly pageCount: number } {
  const pageSize = Math.max(1, Math.floor(input.pageSize));
  const pageCount = Math.max(1, Math.ceil(input.items.length / pageSize));
  const page = Math.min(Math.max(0, Math.floor(input.page)), pageCount - 1);
  return {
    items: input.items.slice(page * pageSize, page * pageSize + pageSize),
    page,
    pageCount,
  };
}
