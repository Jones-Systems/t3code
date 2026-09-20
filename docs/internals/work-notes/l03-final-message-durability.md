# L03 Final Message Durability Work Note

## Scope

Bind a current terminal turn with missing assistant output to its provider, ingestion,
projection, or rendering seam, then make the smallest supported durability fix. Session
and turn coherence work tracked as U02 remains outside this lane.

## Reproduction and diagnosis

Buffered assistant delivery is the default. The shared ingestion layer holds assistant
deltas of at most 24,000 characters in memory until an assistant `item.completed` or
`turn.completed` event finalizes the message. OpenCode's unexpected event-stream/process
exit path emits `session.exited` with the active turn ID, but ingestion previously cleared
all turn caches immediately for that event. Therefore an OpenCode assistant delta followed
by transport exit before item or turn completion produced a stopped terminal session while
discarding the only copy of the assistant text. The message was neither durable nor visible.

## Bounded fix

When `session.exited` carries an explicit turn ID, finalize the assistant message IDs
already buffered for that exact turn before the normal session-state cache sweep. Exits
without a turn ID still make no attribution inference. Buffered plan behavior is unchanged.

## Verification

- Ingestion regression: an OpenCode turn buffers assistant text, then exits with that turn
  ID; the session stops and the exact text remains as a non-streaming assistant message.
- Existing completion-deduplication coverage remains applicable because finalized message
  IDs are cleared before the session-wide sweep.
- `vp test run apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts`:
  52 tests passed.
- `vp run --filter t3 typecheck`: passed (existing Effect suggestions only).
- Targeted lint, formatting, and whitespace checks: passed.
- Independent non-bot review found and prompted removal of an unnecessary thread-detail
  hydration on turnless exits; the corrected diff passed re-review with no findings.

## Boundary

This change does not alter session identity, turn attribution, steering, or active-turn
reconciliation. An exit without an explicit turn ID is not rebound or inferred; any such
U02 coherence work remains in that lane.
