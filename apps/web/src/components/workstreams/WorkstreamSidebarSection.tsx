import {
  canonicalGitHubPullRequestUrl,
  type T3WorkstreamMetadata,
  type WorkstreamCommand,
  type WorkstreamReceipt,
} from "@t3tools/contracts";
import {
  orderWorkstreamMetadata,
  planWorkstreamOwnerOrder,
  workstreamBindingKey,
} from "@t3tools/client-runtime/state/workstreams";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import { ChevronDownIcon, ChevronUpIcon, GripVerticalIcon, MoreHorizontalIcon } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { runtime } from "../../lib/runtime";
import type { WorkstreamListView } from "../../state/workstreams";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

const commandId = () =>
  runtime.runPromise(
    Crypto.Crypto.pipe(
      Effect.flatMap((crypto) => crypto.randomUUIDv4),
      Effect.map((uuid) => `t3-workstream-${uuid}`),
    ),
  );

const bindingSuperseded = Symbol("binding superseded");

export function WorkstreamSidebarSection(props: { readonly controller: WorkstreamListView }) {
  const { data, placementInventory, submit, loadDetail, loadReference, refresh } = props.controller;
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [targetId, setTargetId] = useState("");
  const [declarationText, setDeclarationText] = useState("");
  const [receipt, setReceipt] = useState<WorkstreamReceipt | null>(null);
  const [pullRequestStatus, setPullRequestStatus] = useState<Record<string, string>>({});
  const [commandError, setCommandError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof loadDetail>> | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const manualRefreshRequest = useRef<AbortController | null>(null);
  const items = useMemo(() => orderWorkstreamMetadata(data?.items ?? []), [data]);
  const bindingKey = data ? workstreamBindingKey(data.binding) : null;
  const bindingKeyRef = useRef(bindingKey);

  useLayoutEffect(() => {
    bindingKeyRef.current = bindingKey;
    detailRequest.current?.abort();
    detailRequest.current = null;
    manualRefreshRequest.current?.abort();
    manualRefreshRequest.current = null;
    setDetail(null);
    setPullRequestStatus({});
    setReceipt(null);
    if (bindingKey === null) {
      setSelected(null);
    }
    return () => {
      detailRequest.current?.abort();
      detailRequest.current = null;
      manualRefreshRequest.current?.abort();
      manualRefreshRequest.current = null;
    };
  }, [bindingKey]);
  if (!data) return null;

  const showDetail = (workstreamId: string) => {
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    const startedBindingKey = bindingKey;
    setSelected(workstreamId);
    setDetail(null);
    setPullRequestStatus({});
    setTargetId(items.find((item) => item.workstreamId !== workstreamId)?.workstreamId ?? "");
    void loadDetail(workstreamId, { signal: controller.signal }).then(
      (value) => {
        if (controller.signal.aborted || bindingKeyRef.current !== startedBindingKey) return;
        setDetail(value);
        for (const reference of value.references.items) {
          if (!reference.pr_locator) continue;
          void loadReference(reference.native_reference_id, { signal: controller.signal }).then(
            (result) => {
              if (controller.signal.aborted || bindingKeyRef.current !== startedBindingKey) return;
              setPullRequestStatus((current) => ({
                ...current,
                [reference.native_reference_id]:
                  result.latest_observation?.last_success?.state ??
                  result.latest_observation?.outcome ??
                  "not refreshed",
              }));
            },
            () => undefined,
          );
        }
      },
      () => {
        if (!controller.signal.aborted && bindingKeyRef.current === startedBindingKey)
          setDetail(null);
      },
    );
  };
  const run = async (
    action: WorkstreamCommand["action"],
    registryVersion?: number,
    startedBindingKey = bindingKey,
  ) => {
    const id = await commandId();
    if (bindingKeyRef.current !== startedBindingKey) throw bindingSuperseded;
    const value = await submit({
      command_id: id,
      expected_server_generation: data.binding.serverGeneration,
      expected_registry_version: registryVersion ?? data.binding.registryVersion,
      action,
    });
    if (bindingKeyRef.current !== startedBindingKey) throw bindingSuperseded;
    setReceipt(value);
    setCommandError(null);
    if (selected) showDetail(selected);
    return value;
  };
  const invoke = (action: WorkstreamCommand["action"]) => {
    const startedBindingKey = bindingKey;
    void run(action, undefined, startedBindingKey).catch((cause: unknown) => {
      if (cause === bindingSuperseded || bindingKeyRef.current !== startedBindingKey) return;
      setCommandError(cause instanceof Error ? cause.message : "Workstream command failed.");
    });
  };
  const update = (
    item: T3WorkstreamMetadata,
    changes: { readonly name?: string; readonly lifecycle?: T3WorkstreamMetadata["lifecycle"] },
  ) =>
    invoke({
      operation: "update_workstream",
      workstream_id: item.workstreamId,
      expected_version: item.version,
      name: changes.name ?? item.name,
      lifecycle: changes.lifecycle ?? item.lifecycle,
      progress: item.progress,
      sort_order: item.sortOrder,
    });
  const reorder = (sourceId: string, targetIndex: number) => {
    const startedBindingKey = bindingKey;
    void (async () => {
      const plan = planWorkstreamOwnerOrder(items, sourceId, targetIndex);
      let registryVersion = data.binding.registryVersion;
      const versions = new Map(items.map((item) => [item.workstreamId, item.version]));
      for (const step of plan) {
        if (step.item.sortOrder === step.sortOrder) continue;
        const value = await run(
          {
            operation: "update_workstream",
            workstream_id: step.item.workstreamId,
            expected_version: versions.get(step.item.workstreamId) ?? step.item.version,
            name: step.item.name,
            lifecycle: step.item.lifecycle,
            progress: step.item.progress,
            sort_order: step.sortOrder,
          },
          registryVersion,
          startedBindingKey,
        );
        if (value.state !== "committed") return;
        registryVersion = value.registry_version;
        for (const version of value.effects.workstream_versions)
          versions.set(version.workstream_id, version.version);
      }
    })().catch((cause: unknown) => {
      if (cause === bindingSuperseded || bindingKeyRef.current !== startedBindingKey) return;
      setCommandError(cause instanceof Error ? cause.message : "Workstream reorder failed.");
      refresh();
    });
  };

  const workstream = detail?.detail.workstream;
  const selectedMetadata = items.find((item) => item.workstreamId === selected);
  const target = items.find((item) => item.workstreamId === targetId);
  const references = new Map(
    detail?.references.items.map((reference) => [reference.native_reference_id, reference]) ?? [],
  );

  return (
    <section aria-label="Owner Workstreams" className="border-b border-sidebar-border/60 px-2 pb-2">
      <div className="flex h-8 items-center px-1 text-xs font-medium text-sidebar-muted-foreground">
        Workstreams
      </div>
      {placementInventory.coverage === "partial" ? (
        <p className="px-1 pb-1 text-xs text-sidebar-muted-foreground">
          Thread placement lookup scope is partial (
          {placementInventory.identities.length.toLocaleString()} of{" "}
          {placementInventory.totalIdentities.toLocaleString()} identities selected).
        </p>
      ) : null}
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
              if (dragging) reorder(dragging, index);
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
                onClick={() => showDetail(item.workstreamId)}
                type="button"
              >
                {item.name}{" "}
                <span className="text-[10px] text-muted-foreground">{item.lifecycle}</span>
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
                  Rename
                </MenuItem>
                <MenuItem
                  disabled={index === 0}
                  onClick={() => reorder(item.workstreamId, index - 1)}
                >
                  <ChevronUpIcon /> Move up
                </MenuItem>
                <MenuItem
                  disabled={index === items.length - 1}
                  onClick={() => reorder(item.workstreamId, index + 1)}
                >
                  <ChevronDownIcon /> Move down
                </MenuItem>
              </MenuPopup>
            </Menu>
          </li>
        ))}
      </ul>
      {workstream && selectedMetadata && detail ? (
        <div className="mx-1 mt-2 space-y-2 rounded-md border border-sidebar-border/70 p-2 text-xs">
          <div className="flex items-center gap-2">
            <strong className="min-w-0 flex-1 truncate">{workstream.name}</strong>
            <select
              aria-label="Workstream lifecycle"
              value={workstream.lifecycle}
              onChange={(event) =>
                update(selectedMetadata, {
                  lifecycle: event.target.value as T3WorkstreamMetadata["lifecycle"],
                })
              }
            >
              {(["planned", "active", "paused", "completed", "deferred", "abandoned"] as const).map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </select>
          </div>
          <label className="block">
            Target Workstream{" "}
            <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
              {items
                .filter((item) => item.workstreamId !== workstream.workstream_id)
                .map((item) => (
                  <option key={item.workstreamId} value={item.workstreamId}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
          <ul aria-label="Membership history" className="space-y-1">
            {detail.memberships.items.map((membership) => {
              const reference = references.get(membership.native_reference_id);
              const label = reference
                ? `${reference.identity.provider}: ${reference.identity.native_id}`
                : membership.native_reference_id;
              return (
                <li className="rounded border p-1" key={membership.membership_id}>
                  <span>
                    {label} · {membership.kind} · {membership.closed ? "removed" : "current"}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {!membership.closed && membership.kind === "primary" && target ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          invoke({
                            operation: "move_primary",
                            source_workstream_id: workstream.workstream_id,
                            expected_source_version: workstream.version,
                            source_membership_id: membership.membership_id,
                            destination_workstream_id: target.workstreamId,
                            expected_destination_version: target.version,
                          })
                        }
                      >
                        Move
                      </Button>
                    ) : null}
                    {!membership.closed && target ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          invoke({
                            operation: "link_secondary",
                            workstream_id: target.workstreamId,
                            expected_version: target.version,
                            native_reference_id: membership.native_reference_id,
                          })
                        }
                      >
                        Link
                      </Button>
                    ) : null}
                    {!membership.closed ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          invoke({
                            operation: "remove_membership",
                            workstream_id: workstream.workstream_id,
                            expected_version: workstream.version,
                            membership_id: membership.membership_id,
                          })
                        }
                      >
                        {membership.kind === "secondary" ? "Unlink" : "Remove"}
                      </Button>
                    ) : null}
                    {!membership.closed ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          invoke({
                            operation: "set_coordination_disposition",
                            workstream_id: workstream.workstream_id,
                            expected_version: workstream.version,
                            membership_id: membership.membership_id,
                            disposition: "completed",
                            other_disposition: null,
                          })
                        }
                      >
                        Mark completed
                      </Button>
                    ) : null}
                    {reference?.identity.provider === "t3" ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          invoke({
                            operation: "request_native_t3_settlement",
                            native_reference_id: reference.native_reference_id,
                            expected_attestation_version:
                              reference.registration.attestation_version,
                            native_action: "settle",
                          })
                        }
                      >
                        Settle in T3
                      </Button>
                    ) : null}
                    {membership.closed ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() =>
                          invoke(
                            membership.kind === "primary"
                              ? {
                                  operation: "reattach_primary",
                                  workstream_id: workstream.workstream_id,
                                  expected_version: workstream.version,
                                  native_reference_id: membership.native_reference_id,
                                }
                              : {
                                  operation: "link_secondary",
                                  workstream_id: workstream.workstream_id,
                                  expected_version: workstream.version,
                                  native_reference_id: membership.native_reference_id,
                                },
                          )
                        }
                      >
                        Reattach
                      </Button>
                    ) : null}
                  </div>
                  {reference?.pr_locator ? (
                    <div className="flex items-center gap-1">
                      <a href={canonicalGitHubPullRequestUrl(reference.pr_locator)}>
                        PR #{reference.pr_locator.number} ·{" "}
                        {pullRequestStatus[reference.native_reference_id] ?? "loading"}
                      </a>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          manualRefreshRequest.current?.abort();
                          const controller = new AbortController();
                          manualRefreshRequest.current = controller;
                          const startedBindingKey = bindingKey;
                          void (async () => {
                            const value = await loadReference(reference.native_reference_id, {
                              signal: controller.signal,
                            });
                            if (
                              controller.signal.aborted ||
                              bindingKeyRef.current !== startedBindingKey
                            )
                              return;
                            if (!value.latest_observation) return;
                            await run(
                              {
                                operation: "refresh_linked_pr",
                                workstream_id: workstream.workstream_id,
                                expected_version: workstream.version,
                                membership_id: membership.membership_id,
                                expected_observation_version:
                                  value.latest_observation.observation_version,
                              },
                              undefined,
                              startedBindingKey,
                            );
                            const refreshed = await loadReference(reference.native_reference_id, {
                              signal: controller.signal,
                            });
                            if (
                              controller.signal.aborted ||
                              bindingKeyRef.current !== startedBindingKey
                            )
                              return;
                            setPullRequestStatus((current) => ({
                              ...current,
                              [reference.native_reference_id]:
                                refreshed.latest_observation?.last_success?.state ??
                                refreshed.latest_observation?.outcome ??
                                "unknown",
                            }));
                          })()
                            .catch((cause: unknown) => {
                              if (
                                cause === bindingSuperseded ||
                                controller.signal.aborted ||
                                bindingKeyRef.current !== startedBindingKey
                              )
                                return;
                              setCommandError(
                                cause instanceof Error ? cause.message : "PR refresh failed.",
                              );
                            })
                            .finally(() => {
                              if (manualRefreshRequest.current === controller)
                                manualRefreshRequest.current = null;
                            });
                        }}
                      >
                        Refresh status
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!declarationText.trim()) return;
              const latest = detail.declarations.items.toSorted(
                (a, b) => b.revision - a.revision,
              )[0];
              invoke({
                operation: "set_declaration",
                workstream_id: workstream.workstream_id,
                expected_version: workstream.version,
                declaration_id: latest?.declaration_id ?? null,
                expected_revision: latest?.revision ?? 0,
                text: declarationText.trim(),
              });
              setDeclarationText("");
            }}
          >
            <Input
              aria-label="Lifecycle declaration"
              nativeInput
              value={declarationText}
              onChange={(event) => setDeclarationText(event.target.value)}
            />
            <Button size="xs" type="submit">
              Record declaration
            </Button>
          </form>
          <ul aria-label="Declarations">
            {detail.declarations.items.map((entry) => (
              <li key={`${entry.declaration_id}:${entry.revision}`}>
                {entry.state}: {entry.text}
              </li>
            ))}
          </ul>
          <div>Continuation and supersession</div>
          <ul>
            {detail.edges.items.map((edge) => (
              <li key={edge.edge_id}>
                {edge.relation}: {edge.from_workstream_id} → {edge.to_workstream_id}
              </li>
            ))}
          </ul>
          {target ? (
            <div className="flex gap-1">
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  invoke({
                    operation: "add_edge",
                    from_workstream_id: workstream.workstream_id,
                    expected_from_version: workstream.version,
                    to_workstream_id: target.workstreamId,
                    expected_to_version: target.version,
                    relation: "continues_as",
                  })
                }
              >
                Continues as
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  invoke({
                    operation: "add_edge",
                    from_workstream_id: workstream.workstream_id,
                    expected_from_version: workstream.version,
                    to_workstream_id: target.workstreamId,
                    expected_to_version: target.version,
                    relation: "superseded_by",
                  })
                }
              >
                Superseded by
              </Button>
            </div>
          ) : null}
          <ol aria-label="Permanent history">
            {detail.history.items.map((event) => (
              <li key={event.event_id}>
                {event.operation} · {event.occurred_at}
              </li>
            ))}
          </ol>
          <p>History complete: {detail.history.next_cursor === null ? "yes" : "no"}</p>
          {receipt ? (
            <div role="status">
              <p>
                Coordination:{" "}
                {receipt.state === "committed" && receipt.effects.coordination_disposition
                  ? receipt.effects.coordination_disposition.disposition
                  : "unchanged"}
              </p>
              <p>
                Native T3 settlement:{" "}
                {receipt.state === "committed" && receipt.effects.native_settlement
                  ? receipt.effects.native_settlement.outcome
                  : "unchanged"}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
