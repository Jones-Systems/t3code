import type {
  T3WorkstreamMetadata,
  WorkstreamDeclarationPage,
  WorkstreamDetail,
  WorkstreamEdgePage,
  WorkstreamHistoryPage,
  WorkstreamMembershipPage,
  WorkstreamCommand,
  WorkstreamReceipt,
} from "@t3tools/contracts";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  PencilIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useWorkstreams } from "../../state/workstreams";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

function commandId(): string {
  return `t3-workstream-${crypto.randomUUID()}`;
}

export function WorkstreamSidebarSection() {
  const { data, submit, loadDetail } = useWorkstreams();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<WorkstreamReceipt | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    readonly detail: WorkstreamDetail;
    readonly memberships: WorkstreamMembershipPage;
    readonly declarations: WorkstreamDeclarationPage;
    readonly edges: WorkstreamEdgePage;
    readonly history: WorkstreamHistoryPage;
  } | null>(null);
  useEffect(() => {
    if (!data) {
      setDetail(null);
      setReceipt(null);
    }
  }, [data]);
  const items = useMemo(
    () =>
      [...(data?.items ?? [])].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.workstreamId.localeCompare(b.workstreamId),
      ),
    [data],
  );
  if (!data) return null;

  const update = (
    item: T3WorkstreamMetadata,
    changes: { readonly name?: string; readonly sortOrder?: number },
  ) => {
    if (!data) return;
    const command: WorkstreamCommand = {
      command_id: commandId(),
      expected_server_generation: data.binding.serverGeneration,
      expected_registry_version: data.binding.registryVersion,
      action: {
        operation: "update_workstream",
        workstream_id: item.workstreamId,
        expected_version: item.version,
        name: changes.name ?? item.name,
        lifecycle: item.lifecycle,
        progress: item.progress,
        sort_order: changes.sortOrder ?? item.sortOrder,
      },
    };
    void submit(command).then(
      (value) => {
        setReceipt(value);
        setCommandError(null);
      },
      (cause: unknown) => {
        setCommandError(cause instanceof Error ? cause.message : "Workstream update failed.");
      },
    );
  };
  const move = (item: T3WorkstreamMetadata, direction: "up" | "down") => {
    const index = items.findIndex((candidate) => candidate.workstreamId === item.workstreamId);
    const target = items[index + (direction === "up" ? -1 : 1)];
    if (!target) return;
    update(item, { sortOrder: direction === "up" ? target.sortOrder - 1 : target.sortOrder + 1 });
  };

  return (
    <section aria-label="Owner Workstreams" className="border-b border-sidebar-border/60 px-2 pb-2">
      <div className="flex h-8 items-center px-1 text-xs font-medium text-sidebar-muted-foreground">
        Workstreams
      </div>
      {commandError ? <p className="px-1 pb-1 text-xs text-destructive">{commandError}</p> : null}
      <ul className="space-y-0.5">
        {items.map((item, index) => (
          <li
            className="flex min-h-8 items-center gap-1 rounded-md hover:bg-sidebar-row-hover"
            draggable
            key={item.workstreamId}
            onDragStart={() => setDragging(item.workstreamId)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const sourceIndex = items.findIndex(
                (candidate) => candidate.workstreamId === dragging,
              );
              if (sourceIndex < 0 || sourceIndex === index) return;
              move(items[sourceIndex]!, sourceIndex < index ? "down" : "up");
              setDragging(null);
            }}
          >
            <GripVerticalIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            {editing === item.workstreamId ? (
              <Input
                aria-label="Workstream name"
                autoFocus
                nativeInput
                onBlur={() => {
                  const next = name.trim();
                  if (next && next !== item.name) update(item, { name: next });
                  setEditing(null);
                }}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") setEditing(null);
                }}
                size="compact"
                value={name}
              />
            ) : (
              <button
                className="min-w-0 flex-1 truncate px-1 text-left text-sm"
                onClick={() =>
                  void loadDetail(item.workstreamId).then(setDetail, () => setDetail(null))
                }
                type="button"
              >
                {item.name}
                <span className="ms-1 text-[10px] text-muted-foreground">{item.lifecycle}</span>
              </button>
            )}
            <Menu>
              <MenuTrigger
                aria-label={`Actions for ${item.name}`}
                render={<Button size="icon-micro" variant="ghost-muted" />}
              >
                <MoreHorizontalIcon />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem
                  onClick={() => {
                    setName(item.name);
                    setEditing(item.workstreamId);
                  }}
                >
                  <PencilIcon /> Rename
                </MenuItem>
                <MenuItem disabled={index === 0} onClick={() => move(item, "up")}>
                  <ChevronUpIcon /> Move up
                </MenuItem>
                <MenuItem disabled={index === items.length - 1} onClick={() => move(item, "down")}>
                  <ChevronDownIcon /> Move down
                </MenuItem>
              </MenuPopup>
            </Menu>
          </li>
        ))}
      </ul>
      {detail ? (
        <div className="mx-1 mt-2 rounded-md border border-sidebar-border/70 p-2 text-xs">
          <p className="font-medium">{detail.detail.workstream.name}</p>
          <p className="text-muted-foreground">
            {detail.memberships.items.filter((item) => item.closed === null).length} current ·{" "}
            {detail.memberships.items.length} membership episodes
          </p>
          <p className="text-muted-foreground">
            {detail.declarations.items.length} declarations · {detail.edges.items.length}{" "}
            relationships
          </p>
          <ol className="mt-1 space-y-0.5" aria-label="Workstream history">
            {detail.history.items.slice(0, 3).map((event) => (
              <li key={event.event_id}>
                {event.operation} · {event.occurred_at}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {receipt ? (
        <p className="mx-1 mt-2 text-xs text-muted-foreground" role="status">
          {receipt.operation}: {receipt.state}
          {receipt.state === "committed" && receipt.effects.coordination_disposition
            ? " · coordination recorded"
            : ""}
          {receipt.state === "committed" && receipt.effects.native_settlement
            ? ` · native settlement ${receipt.effects.native_settlement.outcome}`
            : ""}
        </p>
      ) : null}
    </section>
  );
}
