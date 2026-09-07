# Level 2 scratch recovery — DO NOT MERGE

Repository: Jones-Systems/t3code (1322539044).
Task branch: fix/goal-pause-on-stop. Upstream PR: pingdotgg/t3code#10447.
Recovery branch: scratch/level-2/fix/goal-pause-on-stop.
Owner: ChatGPT / GPT-6 Astra Pro, single Level 2 agent with sequential self-review.

## Binding and status

The original source commit is 54b359252440a17c59bee6dc77bbf9eaaeac407c, parent 5f878d2a85807618a4c8571cdef5daa3124672d6, tree 63b07c2b656508458d467814977bae81e9ac5435. This companion retains that original in its ancestry before the explicitly requested rebase. Never merge or cherry-pick this companion into an implementation branch.

Prepared rebased commit: 1df0e3c4ebd94a71d1f09abe6171cf8b6976c0d8; base: 0860cea0c25f34582d03f17ccde23c5dfec64c12; tree: ba7ea8c3190d12e2122f6269c7188feabf0ed43f. Its tree comes from GitHub's real conflict-checked PR integration f4ac574c3a9e3debd1502337210a21543e842455, whose parents are exactly that base and the original fix. The base-to-candidate diff is only the original three files, 92 insertions and no deletions. Preparation is not publication: re-read the task ref and PR before acting.

The patch pauses only an active native goal before interrupting children/root, with a combined one-second best-effort goal-control deadline. The regression asserts pause-before-interrupt ordering and selects the active rather than queued root turn. Goal-control failure/hang behavior is source-reviewed, not newly runtime-tested here.

## Verification and current gates

The candidate mock blob 0e97a1f9aef723126820045d3451eba56ce137f4 was reconstructed in scratch, Git-blob-verified (7625 bytes), and passed node --check on Node v22.16.0. This is syntax only. Vite+, Bun, pnpm and dependencies were unavailable; scratch networking failed. No fresh integration, lint, format or server typecheck pass is claimed. The owner's historical 11-test report belongs to the original commit, not the rebased head.

Original-head CI run 34073575018, attempt 1, ended action_required with zero jobs. Cursor hygiene run 34073575012 also required action. Upstream write access is absent; a maintainer must approve the fork workflows. Macroscope comment 5563804728 said Would Approve but withheld approval because its monthly spending limit was reached; it is not approval or latest-head qualification.

## Next safe action

Verify this checkpoint and original ancestry, then verify the prepared commit and fresh upstream/task refs. Publish the owner-requested one-commit rebase only while the task head still equals the original, preserving this companion. Rebind PR #10447 to its actual head. Inspect all current runs, jobs, statuses and comments. Do not bypass workflow approval, change billing, weaken CI, merge, deploy, access the VPS, or use the ChatGPT Web Connector.

After approval, qualify the current head against CI Check, Test, all three Test Server shards, Rust, Mobile Native Changes, Release Smoke and any other applicable checks. Mobile Native Static Analysis is legitimately skipped only when detection says no native change. Locate the focused CodexCollabRuntime.integration.test.ts result in server job logs. On a qualified local checkout, run from apps/server: vp test run src/provider/Layers/CodexCollabRuntime.integration.test.ts; use the existing server typecheck script and targeted lint/format. Do not run repo-wide local checks. Fix actual findings, then requalify the new head. Use 10-minute waits only after all other PR work is complete and only for work that can progress; an approval gate is not a queued test.

Guidance: Jones-Systems/Codex-V3 at e2f9782ee79f04e4720383030c0571e66638fd00, docs/handoffs/chatgpt-web-github-scratch-flow.md and docs/handoffs/chatgpt-web-scratch-persistence.md. Read the current task branch AGENTS.md, not this companion's inherited old guidance. The PR discussion is the implementation/continuity locator; no work notes or recovery payload belong in the upstream diff.

Post-merge installation and native-runtime qualification are separate, unauthorized here. Full fresh-agent instructions: .chatgpt-scratch/post-merge-vps.md on this recovery branch. No source edits remain only in scratch; no unresolved write effects are known.
