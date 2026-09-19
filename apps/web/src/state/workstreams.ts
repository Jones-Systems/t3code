import type {
  T3WorkstreamListResult,
  T3PlacementIdentity,
  WorkstreamDeclarationPage,
  WorkstreamDetail,
  WorkstreamEdgePage,
  WorkstreamHistoryPage,
  WorkstreamMembershipPage,
  WorkstreamReadContext,
  WorkstreamReferenceDetail,
  WorkstreamReferencePage,
  WorkstreamCommand,
  WorkstreamReceipt,
} from "@t3tools/contracts";
import { EnvironmentHttpConflictError, T3_PLACEMENT_MAX_IDENTITIES } from "@t3tools/contracts";
import {
  appendWorkstreamDtoPage,
  appendWorkstreamListResult,
  LiveWorkstreamMetadataCache,
  orderWorkstreamMetadata,
  type WorkstreamDtoPage,
  loadLiveT3Placements,
  type LiveT3Placements,
} from "@t3tools/client-runtime/state/workstreams";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PrimaryEnvironmentHttpClient } from "../environments/primary/httpClient";
import { runPrimaryHttp } from "../lib/runtime";

type PrimaryClient = Effect.Success<typeof PrimaryEnvironmentHttpClient>;

const request = <A, E>(run: (client: PrimaryClient) => Effect.Effect<A, E>) =>
  runPrimaryHttp(PrimaryEnvironmentHttpClient.pipe(Effect.flatMap(run)));

const metadataCache = new LiveWorkstreamMetadataCache();
const isCursorStale = Schema.is(EnvironmentHttpConflictError);
const CURSOR_RESTART_ATTEMPTS = 3;

const isRestartableCursorStale = (cause: unknown): boolean =>
  isCursorStale(cause) && cause.message === "workstream_cursor_stale";

export interface CursorRestartOptions {
  readonly wait?: (delayMs: number) => Promise<void>;
}

async function withCursorRestart<A>(
  load: () => Promise<A>,
  options: CursorRestartOptions = {},
): Promise<A> {
  const wait =
    options.wait ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, delayMs);
      }));
  for (let attempt = 0; attempt < CURSOR_RESTART_ATTEMPTS; attempt += 1) {
    try {
      return await load();
    } catch (cause) {
      if (!isRestartableCursorStale(cause) || attempt + 1 === CURSOR_RESTART_ATTEMPTS) throw cause;
      await wait(50 * 2 ** attempt);
    }
  }
  throw new Error("Workstream cursor restart policy is invalid.");
}

async function loadAllPages<Item>(
  load: (cursor?: string) => Promise<WorkstreamDtoPage<Item>>,
): Promise<WorkstreamDtoPage<Item>> {
  let result = await load();
  const cursors = new Set<string>();
  while (result.next_cursor !== null) {
    if (cursors.has(result.next_cursor)) throw new Error("Workstream pagination cursor repeated.");
    cursors.add(result.next_cursor);
    result = appendWorkstreamDtoPage(result, await load(result.next_cursor));
  }
  return result;
}

export async function loadCompleteWorkstreamList(
  load: (cursor?: string) => Promise<T3WorkstreamListResult>,
  options: CursorRestartOptions = {},
): Promise<T3WorkstreamListResult> {
  return withCursorRestart(async () => {
    let result = await load();
    const cursors = new Set<string>();
    while (result.nextCursor !== null) {
      if (cursors.has(result.nextCursor)) throw new Error("Workstream list cursor repeated.");
      cursors.add(result.nextCursor);
      result = appendWorkstreamListResult(result, await load(result.nextCursor));
    }
    return result;
  }, options);
}

export interface WorkstreamDetailView {
  readonly detail: WorkstreamDetail;
  readonly memberships: WorkstreamMembershipPage;
  readonly declarations: WorkstreamDeclarationPage;
  readonly edges: WorkstreamEdgePage;
  readonly history: WorkstreamHistoryPage;
  readonly references: WorkstreamReferencePage;
}

export interface WorkstreamDetailLoaders {
  readonly detail: () => Promise<WorkstreamDetail>;
  readonly memberships: (cursor?: string) => Promise<WorkstreamMembershipPage>;
  readonly declarations: (cursor?: string) => Promise<WorkstreamDeclarationPage>;
  readonly edges: (cursor?: string) => Promise<WorkstreamEdgePage>;
  readonly history: (cursor?: string) => Promise<WorkstreamHistoryPage>;
  readonly references: (cursor?: string) => Promise<WorkstreamReferencePage>;
}

export async function loadCompleteWorkstreamDetail(
  loaders: WorkstreamDetailLoaders,
  options: CursorRestartOptions = {},
): Promise<WorkstreamDetailView> {
  return withCursorRestart(async () => {
    const [
      detailResult,
      membershipsResult,
      declarationsResult,
      edgesResult,
      historyResult,
      referencesResult,
    ] = await Promise.allSettled([
      loaders.detail(),
      loadAllPages(loaders.memberships),
      loadAllPages(loaders.declarations),
      loadAllPages(loaders.edges),
      loadAllPages(loaders.history),
      loadAllPages(loaders.references),
    ] as const);
    const failures = [
      detailResult,
      membershipsResult,
      declarationsResult,
      edgesResult,
      historyResult,
      referencesResult,
    ].filter((result) => result.status === "rejected");
    const nonRestartableFailure = failures.find(
      (result) => result.status === "rejected" && !isRestartableCursorStale(result.reason),
    );
    if (nonRestartableFailure?.status === "rejected") throw nonRestartableFailure.reason;
    const staleFailure = failures[0];
    if (staleFailure?.status === "rejected") throw staleFailure.reason;
    if (
      detailResult.status !== "fulfilled" ||
      membershipsResult.status !== "fulfilled" ||
      declarationsResult.status !== "fulfilled" ||
      edgesResult.status !== "fulfilled" ||
      historyResult.status !== "fulfilled" ||
      referencesResult.status !== "fulfilled"
    )
      throw new Error("Workstream detail load did not settle.");
    const detail = detailResult.value;
    const memberships = membershipsResult.value;
    const declarations = declarationsResult.value;
    const edges = edgesResult.value;
    const history = historyResult.value;
    const references = referencesResult.value;
    const contexts: readonly WorkstreamReadContext[] = [
      memberships.context,
      declarations.context,
      edges.context,
      history.context,
      references.context,
    ];
    if (
      contexts.some(
        (context) =>
          context.owner_id !== detail.context.owner_id ||
          context.server_generation !== detail.context.server_generation ||
          context.registry_version !== detail.context.registry_version,
      )
    ) {
      throw new Error("Workstream detail changed while it was loading; reload it.");
    }
    return { detail, memberships, declarations, edges, history, references };
  }, options);
}

export interface WorkstreamListView {
  readonly placements: LiveT3Placements | null;
  readonly data: T3WorkstreamListResult | null;
  readonly error: string | null;
  readonly loading: boolean;
  readonly refresh: () => void;
  readonly submit: (command: WorkstreamCommand) => Promise<WorkstreamReceipt>;
  readonly loadDetail: (workstreamId: string) => Promise<WorkstreamDetailView>;
  readonly loadReference: (nativeReferenceId: string) => Promise<WorkstreamReferenceDetail>;
}

export function nativePlacementInventoryJson(
  nativeThreads: readonly { readonly environmentId: string; readonly id: string }[],
): string {
  const identities = new Map<string, T3PlacementIdentity>();
  for (const thread of nativeThreads) {
    identities.set(JSON.stringify([thread.environmentId, thread.id]), {
      source_instance_id: thread.environmentId,
      native_thread_id: thread.id,
    });
    if (identities.size > T3_PLACEMENT_MAX_IDENTITIES) break;
  }
  return JSON.stringify(
    [...identities.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, value]) => value),
  );
}

export function useWorkstreams(
  placementsEnabled = true,
  nativeThreads: readonly { readonly environmentId: string; readonly id: string }[] = [],
): WorkstreamListView {
  const inventoryJson = nativePlacementInventoryJson(placementsEnabled ? nativeThreads : []);
  const identities = useMemo(
    () => JSON.parse(inventoryJson) as readonly T3PlacementIdentity[],
    [inventoryJson],
  );
  const [placements, setPlacements] = useState<LiveT3Placements | null>(null);
  const [data, setData] = useState<T3WorkstreamListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const refresh = useCallback(() => {
    generation.current += 1;
    setPlacements(null);
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    const current = ++generation.current;
    setPlacements(null);
    setLoading(true);
    void loadCompleteWorkstreamList((cursor) =>
      request((client) =>
        client.workstreams.list({
          headers: {},
          payload: { limit: 50, ...(cursor === undefined ? {} : { cursor }) },
        }),
      ),
    )
      .then(async (value) => {
        if (generation.current !== current) return;
        const normalized = { ...value, items: [...orderWorkstreamMetadata(value.items)] };
        metadataCache.write(normalized);
        setData(metadataCache.read(normalized.binding));
        setError(null);
        if (placementsEnabled) {
          try {
            const projection = await loadLiveT3Placements(normalized, identities, () =>
              request((client) =>
                client.workstreams.threadPlacements({
                  headers: {},
                  payload: { identities },
                }),
              ),
            );
            if (generation.current === current) setPlacements(projection);
          } catch {
            if (generation.current === current) setPlacements(null);
          }
        }
      })
      .catch((cause: unknown) => {
        if (generation.current !== current) return;
        // Authorization/session lifecycle failures must hide previously authorized content.
        metadataCache.purgeAuthorization();
        setData(null);
        setError(cause instanceof Error ? cause.message : "Workstreams are unavailable.");
      })
      .finally(() => {
        if (generation.current === current) setLoading(false);
      });
    return () => {
      generation.current += 1;
    };
  }, [revision, placementsEnabled, identities]);

  useEffect(() => {
    if (!placements || placements.items.length === 0) return;
    const expiry = Math.min(...placements.items.map((item) => Date.parse(item.expires_at)));
    const timer = window.setTimeout(
      () => setPlacements(null),
      Math.max(0, Math.min(2_147_483_647, expiry - Date.now())),
    );
    return () => window.clearTimeout(timer);
  }, [placements]);

  const submit = useCallback(
    async (command: WorkstreamCommand) => {
      try {
        let receipt = await request((client) =>
          client.workstreams.submit({ headers: {}, payload: { command } }),
        );
        // Pending effects reconcile through the exact GET route; commands are never resubmitted.
        while (receipt.state === "pending" || receipt.state === "unresolved") {
          const retryAfterSeconds = receipt.retry_after_seconds;
          await new Promise<void>((resolve) => {
            const timer = window.setTimeout(
              resolve,
              Math.min(30_000, Math.max(250, retryAfterSeconds * 1_000)),
            );
            void timer;
          });
          receipt = await request((client) =>
            client.workstreams.command({ headers: {}, params: { commandId: command.command_id } }),
          );
        }
        refresh();
        return receipt;
      } catch (cause) {
        generation.current += 1;
        setPlacements(null);
        metadataCache.purgeAuthorization();
        setData(null);
        throw cause;
      }
    },
    [refresh],
  );

  const loadDetail = useCallback(async (workstreamId: string) => {
    try {
      return await loadCompleteWorkstreamDetail({
        detail: () =>
          request((client) => client.workstreams.detail({ headers: {}, params: { workstreamId } })),
        memberships: (cursor) =>
          request((client) =>
            client.workstreams.memberships({
              headers: {},
              params: { workstreamId },
              payload: { limit: 50, ...(cursor === undefined ? {} : { cursor }) },
            }),
          ),
        declarations: (cursor) =>
          request((client) =>
            client.workstreams.declarations({
              headers: {},
              params: { workstreamId },
              payload: { limit: 50, ...(cursor === undefined ? {} : { cursor }) },
            }),
          ),
        edges: (cursor) =>
          request((client) =>
            client.workstreams.edges({
              headers: {},
              params: { workstreamId },
              payload: { limit: 50, ...(cursor === undefined ? {} : { cursor }) },
            }),
          ),
        history: (cursor) =>
          request((client) =>
            client.workstreams.history({
              headers: {},
              params: { workstreamId },
              payload: { limit: 50, ...(cursor === undefined ? {} : { cursor }) },
            }),
          ),
        references: (cursor) =>
          request((client) =>
            client.workstreams.references({
              headers: {},
              payload: { limit: 50, ...(cursor === undefined ? {} : { cursor }) },
            }),
          ),
      });
    } catch (cause) {
      generation.current += 1;
      setPlacements(null);
      metadataCache.purgeAuthorization();
      setData(null);
      throw cause;
    }
  }, []);

  const loadReference = useCallback(async (nativeReferenceId: string) => {
    try {
      return await request((client) =>
        client.workstreams.reference({ headers: {}, params: { nativeReferenceId } }),
      );
    } catch (cause) {
      generation.current += 1;
      setPlacements(null);
      metadataCache.purgeAuthorization();
      setData(null);
      throw cause;
    }
  }, []);

  return {
    placements,
    data,
    error,
    loading,
    refresh,
    submit,
    loadDetail,
    loadReference,
  };
}
