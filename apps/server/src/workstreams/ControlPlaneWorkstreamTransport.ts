import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

import {
  WORKSTREAM_CONTRACT_MANIFEST_SHA256,
  WORKSTREAM_CONTRACT_VERSION,
  WORKSTREAM_MAX_RESPONSE_BYTES,
  WorkstreamCapabilities,
  WorkstreamDeclarationPage,
  WorkstreamDetail,
  WorkstreamEdgePage,
  WorkstreamHistoryPage,
  WorkstreamMembershipPage,
  WorkstreamPage,
  WorkstreamReceipt,
  WorkstreamReferenceDetail,
  WorkstreamReferencePage,
  type T3WorkstreamBinding,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { WorkstreamTransportError, type WorkstreamTransport } from "./WorkstreamGateway.ts";

const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");
const TIMEOUT_MS = 15_000;

export interface ControlPlaneWorkstreamActivation {
  readonly baseUrl: URL;
  readonly ownerId: string;
  readonly principalId: string;
  readonly authorizationRevision: number;
  readonly keyId: string;
  readonly signingSecret: string;
}

export type WorkstreamActivation =
  | { readonly state: "disabled" }
  | { readonly state: "enabled"; readonly value: ControlPlaneWorkstreamActivation };

function activationFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): WorkstreamActivation {
  const raw = environment.T3_WORKSTREAM_CONTROL_PLANE_URL;
  const ownerId = environment.T3_WORKSTREAM_OWNER_ID;
  const principalId = environment.T3_WORKSTREAM_PRINCIPAL_ID;
  const keyId = environment.T3_WORKSTREAM_KEY_ID;
  const signingSecret = environment.T3_WORKSTREAM_SIGNING_SECRET;
  const revision = Number(environment.T3_WORKSTREAM_AUTHORIZATION_REVISION);
  if (!raw && !ownerId && !principalId && !keyId && !signingSecret) return { state: "disabled" };
  if (
    !raw ||
    !ownerId ||
    !principalId ||
    !keyId ||
    !signingSecret ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  ) {
    return { state: "disabled" };
  }
  try {
    const baseUrl = new URL(raw);
    if (
      baseUrl.protocol !== "https:" ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.hash ||
      (baseUrl.pathname !== "/" && baseUrl.pathname !== "")
    )
      return { state: "disabled" };
    return {
      state: "enabled",
      value: {
        baseUrl,
        ownerId,
        principalId,
        authorizationRevision: revision,
        keyId,
        signingSecret,
      },
    };
  } catch {
    return { state: "disabled" };
  }
}

const disabled = (): WorkstreamTransport => {
  const unavailable = (operation: string) =>
    Effect.fail(
      new WorkstreamTransportError({
        operation,
        effect: "no-effect",
        detail: "Workstream control-plane activation is disabled.",
      }),
    );
  return {
    getCapabilities: () => unavailable("capabilities"),
    listWorkstreams: () => unavailable("list_workstreams"),
    getWorkstream: () => unavailable("get_workstream"),
    listReferences: () => unavailable("list_references"),
    getReference: () => unavailable("get_reference"),
    listMemberships: () => unavailable("list_memberships"),
    listDeclarations: () => unavailable("list_declarations"),
    listEdges: () => unavailable("list_edges"),
    listHistory: () => unavailable("list_history"),
    getCommand: () => unavailable("get_command"),
    submitCommand: () => unavailable("submit_command"),
  };
};

function query(input: { readonly limit: number; readonly cursor?: string }): string {
  const value = new URLSearchParams({ limit: String(input.limit) });
  if (input.cursor !== undefined) value.set("cursor", input.cursor);
  return value.toString();
}

export function makeControlPlaneWorkstreamTransport(
  activation: WorkstreamActivation = activationFromEnvironment(),
): {
  readonly transport: WorkstreamTransport;
  readonly binding: Pick<
    T3WorkstreamBinding,
    "registryId" | "ownerId" | "principalId" | "authorizationRevision"
  >;
} {
  if (activation.state === "disabled") {
    return {
      transport: disabled(),
      binding: {
        registryId: "disabled",
        ownerId: "disabled",
        principalId: "disabled",
        authorizationRevision: 0,
      },
    };
  }
  const config = activation.value;
  const request = <A>(
    operation: string,
    method: "GET" | "POST",
    target: string,
    schema: Schema.Schema<A>,
    body = "",
    idempotencyKey?: string,
  ) =>
    Effect.tryPromise({
      try: async (signal) => {
        if (!target.startsWith("/workstreams/v1/") || target.includes("#") || /[\r\n]/.test(target))
          throw new Error("invalid_target");
        const sentAt = new Date().toISOString();
        const requestId = randomUUID();
        const nonce = randomBytes(24).toString("base64url");
        const contentSha256 =
          body === "" ? EMPTY_SHA256 : createHash("sha256").update(body).digest("hex");
        const canonical = [
          "hmac-sha256-v1",
          WORKSTREAM_CONTRACT_VERSION,
          requestId,
          idempotencyKey ?? "",
          sentAt,
          nonce,
          config.principalId,
          config.keyId,
          method,
          target,
          contentSha256,
        ].join("\n");
        const signature = createHmac("sha256", config.signingSecret)
          .update(canonical)
          .digest("base64url");
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
        signal.addEventListener("abort", () => controller.abort(), { once: true });
        try {
          const response = await fetch(new URL(target, config.baseUrl), {
            method,
            redirect: "error",
            signal: controller.signal,
            headers: {
              accept: "application/json",
              "content-type": "application/json; charset=utf-8",
              "x-control-algorithm": "hmac-sha256-v1",
              "x-control-contract-version": `workstreams/${WORKSTREAM_CONTRACT_VERSION}`,
              "x-control-contract-manifest": WORKSTREAM_CONTRACT_MANIFEST_SHA256,
              "x-control-request-id": requestId,
              "x-control-timestamp": sentAt,
              "x-control-nonce": nonce,
              "x-control-principal-id": config.principalId,
              "x-control-key-id": config.keyId,
              "x-control-content-sha256": contentSha256,
              "x-control-signature": signature,
              ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
            },
            ...(body === "" ? {} : { body }),
          });
          const declared = response.headers.get("content-length");
          if (declared !== null && Number(declared) > WORKSTREAM_MAX_RESPONSE_BYTES)
            throw new Error("response_too_large");
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.byteLength > WORKSTREAM_MAX_RESPONSE_BYTES)
            throw new Error("response_too_large");
          const value = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          ) as unknown;
          if (!response.ok) throw new Error(`http_${response.status}`);
          return Schema.decodeUnknownSync(schema)(value);
        } finally {
          clearTimeout(timeout);
        }
      },
      catch: (cause) =>
        new WorkstreamTransportError({
          operation,
          effect: method === "POST" ? "unknown-effect" : "no-effect",
          detail: cause instanceof Error ? cause.message : "Control-plane request failed.",
          cause,
        }),
    });
  return {
    binding: {
      registryId: config.baseUrl.origin,
      ownerId: config.ownerId,
      principalId: config.principalId,
      authorizationRevision: config.authorizationRevision,
    },
    transport: {
      getCapabilities: () =>
        request("capabilities", "GET", "/workstreams/v1/capabilities", WorkstreamCapabilities),
      listWorkstreams: (input) =>
        request(
          "list_workstreams",
          "GET",
          `/workstreams/v1/workstreams?${query(input)}`,
          WorkstreamPage,
        ),
      getWorkstream: ({ workstreamId }) =>
        request(
          "get_workstream",
          "GET",
          `/workstreams/v1/workstreams/${encodeURIComponent(workstreamId)}`,
          WorkstreamDetail,
        ),
      listReferences: (input) =>
        request(
          "list_references",
          "GET",
          `/workstreams/v1/references?${query(input)}`,
          WorkstreamReferencePage,
        ),
      getReference: ({ nativeReferenceId }) =>
        request(
          "get_reference",
          "GET",
          `/workstreams/v1/references/${encodeURIComponent(nativeReferenceId)}`,
          WorkstreamReferenceDetail,
        ),
      listMemberships: ({ workstreamId, ...input }) =>
        request(
          "list_memberships",
          "GET",
          `/workstreams/v1/workstreams/${encodeURIComponent(workstreamId)}/memberships?${query(input)}`,
          WorkstreamMembershipPage,
        ),
      listDeclarations: ({ workstreamId, ...input }) =>
        request(
          "list_declarations",
          "GET",
          `/workstreams/v1/workstreams/${encodeURIComponent(workstreamId)}/declarations?${query(input)}`,
          WorkstreamDeclarationPage,
        ),
      listEdges: ({ workstreamId, ...input }) =>
        request(
          "list_edges",
          "GET",
          `/workstreams/v1/workstreams/${encodeURIComponent(workstreamId)}/edges?${query(input)}`,
          WorkstreamEdgePage,
        ),
      listHistory: ({ workstreamId, ...input }) =>
        request(
          "list_history",
          "GET",
          `/workstreams/v1/${workstreamId === undefined ? "history" : `workstreams/${encodeURIComponent(workstreamId)}/history`}?${query(input)}`,
          WorkstreamHistoryPage,
        ),
      getCommand: ({ commandId }) =>
        request(
          "get_command",
          "GET",
          `/workstreams/v1/commands/${encodeURIComponent(commandId)}`,
          WorkstreamReceipt,
        ),
      submitCommand: ({ body, idempotencyKey }) =>
        request(
          "submit_command",
          "POST",
          "/workstreams/v1/commands",
          WorkstreamReceipt,
          body,
          idempotencyKey,
        ),
    },
  };
}
