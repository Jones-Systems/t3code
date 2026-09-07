# Post-merge VPS installation and native goal Stop qualification

Instruction location: Jones-Systems/t3code, branch scratch/level-2/fix/goal-pause-on-stop, path .chatgpt-scratch/post-merge-vps.md.
Implementation: branch fix/goal-pause-on-stop; upstream PR pingdotgg/t3code#10447. Read the companion README.md and checkpoint.json for the latest source/checkpoint identities. This is an operational handoff, not authority to merge, deploy, restart, change billing, or alter credentials.

## Preconditions

Use an independently authorized VPS-local agent and the owner's approved host/workspace tools. Verify PR #10447 is actually merged and record its merge commit; do not assume the task branch survives or equals the merged commit. If it is open, stop installation and resolve the PR's workflow-approval/check/review gates instead. Verify the chosen release or build includes the merged fix. A GitHub merge does not update an already running T3 server.

Read the current installed/target repository's AGENTS.md chain and docs/operations/development.md at the pinned installation revision. Discover the real installation method, service/process owner, data location, current binary/version and active sessions without changing them. No service name, deployment command or host binding was established by the Level 2 agent; do not invent one. Obtain explicit approval for the exact installation/restart and maintenance window before mutating the live host.

## Preserve and install

Preserve dirty work, the original local fix/goal-pause-on-stop commit 54b359252440a17c59bee6dc77bbf9eaaeac407c, recovery refs and any differing local branch before synchronization. Fetch without reset, clean, force-overwrite or deleting worktrees. Never merge this scratch companion or install its source tree. Use the merged upstream revision or a verified containing release in a separate clean build location.

Follow the installation method and pinned dependency/lockfile instructions for that host; do not opportunistically upgrade dependencies or providers. Before installation, run the focused test from apps/server with vp test run src/provider/Layers/CodexCollabRuntime.integration.test.ts, the existing server typecheck and targeted lint/format. Preserve terminal results and exact revision/runtime versions. Do not substitute mock syntax checks for runtime tests, or claim the historical 11-test report is fresh proof.

Record the previous deployable artifact and an approved rollback procedure. Never point a test/dev server at live ~/.t3/userdata, copy credentials to GitHub, kill processes by pattern, or restart other sessions. Perform only the specifically approved installation/restart; do not deploy to unrelated machines.

## Verify the live fix safely

Use a disposable test project/thread with a bounded native Codex goal, not the user's runaway conversation. Record the native provider version and confirm the native goal is active before Stop. Exercise the real T3 Stop path. Use native protocol receipts/readback to verify thread/goal/set with status paused precedes child/root turn interrupts, the root interrupt targets the active rather than queued turn, and thread/goal/get reports paused afterward. Observe a bounded interval appropriate to the actual scheduler and verify no autonomous continuation turns appear; report the interval and its limits rather than claiming indefinite proof.

Verify child turns stop when present and that a no-goal/already-paused case still stops normally. Exercise goal-RPC errors/hangs only in an isolated mock/test environment, not by breaking the live provider. The one-second best-effort deadline must permit turn interruption even when goal control fails; do not claim successful native pausing on that failure path. Verify an explicit user resume/new action still works without silently resuming paused user work.

## Closeout and owner actions

Report merged/install revision, artifact/version, host binding, real checks, native paused-state/order evidence, continuation observation window and rollback location. Preserve sanitized evidence in the approved restricted host destination and a concise reference in the task record. Do not publish transcripts, credentials, raw private logs or session tokens. Existing user goals or affected conversations should only be resumed/closed with owner direction. If release availability, installation permission, downtime approval or verification is blocked, retain the old working installation and name the exact remaining owner action. Keep the original/recovery refs; cleanup is not required to complete this fix.
