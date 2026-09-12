import type {
  T3WorkstreamListResult,
  WorkstreamDeclarationPage,
  WorkstreamDetail,
  WorkstreamEdgePage,
  WorkstreamHistoryPage,
  WorkstreamMembershipPage,
  WorkstreamCommand,
  WorkstreamReceipt,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useRef, useState } from "react";

import { PrimaryEnvironmentHttpClient } from "../environments/primary/httpClient";
import { runPrimaryHttp } from "../lib/runtime";

type PrimaryClient = Effect.Success<typeof PrimaryEnvironmentHttpClient>;

const request = <A>(run: (client: PrimaryClient) => Effect.Effect<A, unknown>) =>
  runPrimaryHttp(PrimaryEnvironmentHttpClient.pipe(Effect.flatMap(run)));

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
  }>;
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
    void request((client) => client.workstreams.list({ headers: {}, payload: { limit: 50 } }))
      .then((value) => {
        if (generation.current !== current) return;
        setData(value);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (generation.current !== current) return;
        // Authorization/session lifecycle failures must hide previously authorized content.
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
      let receipt = await request((client) =>
        client.workstreams.submit({ headers: {}, payload: { command } }),
      );
      // Pending effects reconcile through the exact GET route; commands are never resubmitted.
      for (
        let attempts = 0;
        (receipt.state === "pending" || receipt.state === "unresolved") && attempts < 30;
        attempts += 1
      ) {
        await new Promise<void>((resolve) => {
          const timer = window.setTimeout(
            resolve,
            Math.min(30_000, Math.max(250, receipt.retry_after_seconds * 1_000)),
          );
          void timer;
        });
        receipt = await request((client) =>
          client.workstreams.command({ headers: {}, params: { commandId: command.command_id } }),
        );
      }
      refresh();
      return receipt;
    },
    [refresh],
  );

  const loadDetail = useCallback(async (workstreamId: string) => {
    const page = { limit: 50 } as const;
    const [detail, memberships, declarations, edges, history] = await Promise.all([
      request((client) => client.workstreams.detail({ headers: {}, params: { workstreamId } })),
      request((client) =>
        client.workstreams.memberships({ headers: {}, params: { workstreamId }, payload: page }),
      ),
      request((client) =>
        client.workstreams.declarations({ headers: {}, params: { workstreamId }, payload: page }),
      ),
      request((client) =>
        client.workstreams.edges({ headers: {}, params: { workstreamId }, payload: page }),
      ),
      request((client) =>
        client.workstreams.history({ headers: {}, params: { workstreamId }, payload: page }),
      ),
    ]);
    const contexts = [memberships.context, declarations.context, edges.context, history.context];
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
    return { detail, memberships, declarations, edges, history };
  }, []);

  return { data, error, loading, refresh, submit, loadDetail };
}
