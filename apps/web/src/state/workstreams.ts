import type {
  T3WorkstreamListResult,
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
import {
  appendWorkstreamDtoPage,
  appendWorkstreamListResult,
  LiveWorkstreamMetadataCache,
  orderWorkstreamMetadata,
  type WorkstreamDtoPage,
} from "@t3tools/client-runtime/state/workstreams";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useRef, useState } from "react";

import { PrimaryEnvironmentHttpClient } from "../environments/primary/httpClient";
import { runPrimaryHttp } from "../lib/runtime";

type PrimaryClient = Effect.Success<typeof PrimaryEnvironmentHttpClient>;

const request = <A, E>(run: (client: PrimaryClient) => Effect.Effect<A, E>) =>
  runPrimaryHttp(PrimaryEnvironmentHttpClient.pipe(Effect.flatMap(run)));

const metadataCache = new LiveWorkstreamMetadataCache();

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
): Promise<T3WorkstreamListResult> {
  let result = await load();
  const cursors = new Set<string>();
  while (result.nextCursor !== null) {
    if (cursors.has(result.nextCursor)) throw new Error("Workstream list cursor repeated.");
    cursors.add(result.nextCursor);
    result = appendWorkstreamListResult(result, await load(result.nextCursor));
  }
  return result;
}

export interface WorkstreamListView {
  readonly data: T3WorkstreamListResult | null;
  readonly error: string | null;
  readonly loading: boolean;
  readonly refresh: () => void;
  readonly submit: (command: WorkstreamCommand) => Promise<WorkstreamReceipt>;
  readonly loadDetail: (workstreamId: string) => Promise<{
    readonly detail: WorkstreamDetail;
    readonly memberships: WorkstreamMembershipPage;
    readonly declarations: WorkstreamDeclarationPage;
    readonly edges: WorkstreamEdgePage;
    readonly history: WorkstreamHistoryPage;
    readonly references: WorkstreamReferencePage;
  }>;
  readonly loadReference: (nativeReferenceId: string) => Promise<WorkstreamReferenceDetail>;
}

export function useWorkstreams(): WorkstreamListView {
  const [data, setData] = useState<T3WorkstreamListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const current = ++generation.current;
    setLoading(true);
    void loadCompleteWorkstreamList((cursor) =>
      request((client) =>
        client.workstreams.list({
          headers: {},
          payload: { limit: 50, ...(cursor === undefined ? {} : { cursor }) },
        }),
      ),
    )
      .then((value) => {
        if (generation.current !== current) return;
        const normalized = { ...value, items: [...orderWorkstreamMetadata(value.items)] };
        metadataCache.write(normalized);
        setData(metadataCache.read(normalized.binding));
        setError(null);
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
  }, [revision]);

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
        metadataCache.purgeAuthorization();
        setData(null);
        throw cause;
      }
    },
    [refresh],
  );

  const loadDetail = useCallback(async (workstreamId: string) => {
    try {
      const paged = <Item>(
        run: (cursor?: string) => Promise<WorkstreamDtoPage<Item>>,
      ): Promise<WorkstreamDtoPage<Item>> => loadAllPages(run);
      const [detail, memberships, declarations, edges, history, references] = await Promise.all([
        request((client) => client.workstreams.detail({ headers: {}, params: { workstreamId } })),
        paged((cursor) =>
          request((client) =>
            client.workstreams.memberships({
              headers: {},
              params: { workstreamId },
              payload: { limit: 50, ...(cursor === undefined ? {} : { cursor }) },
            }),
          ),
        ),
        paged((cursor) =>
          request((client) =>
            client.workstreams.declarations({
              headers: {},
              params: { workstreamId },
              payload: { limit: 50, ...(cursor === undefined ? {} : { cursor }) },
            }),
          ),
        ),
        paged((cursor) =>
          request((client) =>
            client.workstreams.edges({
              headers: {},
              params: { workstreamId },
              payload: { limit: 50, ...(cursor === undefined ? {} : { cursor }) },
            }),
          ),
        ),
        paged((cursor) =>
          request((client) =>
            client.workstreams.history({
              headers: {},
              params: { workstreamId },
              payload: { limit: 50, ...(cursor === undefined ? {} : { cursor }) },
            }),
          ),
        ),
        paged((cursor) =>
          request((client) =>
            client.workstreams.references({
              headers: {},
              payload: { limit: 50, ...(cursor === undefined ? {} : { cursor }) },
            }),
          ),
        ),
      ]);
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
    } catch (cause) {
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
      metadataCache.purgeAuthorization();
      setData(null);
      throw cause;
    }
  }, []);

  return {
    data,
    error,
    loading,
    refresh,
    submit,
    loadDetail,
    loadReference,
  };
}
