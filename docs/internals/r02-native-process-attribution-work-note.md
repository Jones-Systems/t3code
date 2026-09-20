# R02 native process attribution work note

Status: implementation and independent review verified; publication pending

## Scope

Determine why large Codex app-server and MCP process trees cannot be reliably
attributed to native T3 threads or classified as no longer owned by a live T3
provider session. Add only the smallest privacy-safe attribution and lifecycle
surface supported by direct evidence. This work does not add process cleanup or
termination authority.

## Evidence

- The current telemetry contract and diagnostics UI define a `provider-root`
  process category, but `resourceTelemetry/Model.ts` never produces it.
- Codex owns one scoped app-server process per active T3 thread and already has
  the child PID at spawn time. That PID-to-thread relationship is not registered
  anywhere.
- A same-host attribution snapshot on 2026-09-19 at 10:22:58 PM EDT observed 14
  Codex app-server processes, 341 MCP client groups, and zero native thread
  mappings. Every mapping failure was `no_open_rollout_files`, demonstrating
  that rollout-file inspection is not a reliable ownership source for the live
  processes observed.
- Existing resource telemetry already provides a private, authenticated process
  tree using `(pid, startTimeMs)` identities. Its in-memory, non-persistent model
  is the narrowest suitable projection surface.

## Working disposition

The residual is missing source functionality. The bounded implementation is an
in-memory scoped registration made when Codex spawns its app-server root and
removed when that provider-session scope closes. Telemetry will classify the
registered root as `provider-root` and attach only opaque T3 thread identity and
provider kind. It will not expose titles, prompts, paths, commands beyond the
existing diagnostics contract, credentials, or content. Descendants remain
linked by the existing process tree rather than duplicating owner data.

Registration is advisory metadata, not a liveness claim. A running process with
no current registration is explicitly not proven stale: it may predate server
activation, belong to another T3 server, or be outside the current runtime
scope. No signal or cleanup behavior changes.

## Verification log

- Focused server tests: 164 passed across process attribution, Codex runtime
  lifecycle, telemetry model/service, process diagnostics, adapter, and provider
  registry coverage.
- Focused contracts and server typechecks passed.
- Targeted lint passed with only pre-existing warnings in untouched portions of
  `server.test.ts`; targeted formatting passed.
- Independent non-bot review identified a fast PID-reuse boundary. The
  implementation now rejects every sampled start bucket newer than registration
  and tests the same-second, +1 second, and +2 second boundaries. The review's
  live-only surface and runtime cleanup observations are documented and covered.
- Pending commit, normal push, non-draft pull request, and required checks.
