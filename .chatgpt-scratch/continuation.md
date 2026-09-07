# T3 conversation workspace continuation

## Binding and delivered checkpoint

Implementation repository: Jones-Systems/t3code (repository ID 1322539044).
PR #1 is open, draft and unmerged. Branch work/conversations-core now points to 8904051fd3d28ba5c1be1858a6c5450d8c665269, tree e5723653e327d97545f2f0fbe3a77ffa60f13955. Main remains 5f878d2a85807618a4c8571cdef5daa3124672d6. The latest native compare was one commit ahead of its parent, zero behind, exactly five changed paths, 739 additions and no deletions. All five Git blobs matched locally tested bytes before the non-force ref update. Current PR totals: three commits, 17 changed paths, 1971 additions, no deletions.

Published history, in order:
1. 842c75793433fcf7bf1b30810de60c858a05f0b4: bounded export contracts/normalization, branches/gaps and unsupported-media markers.
2. 78d0f05ec203b717ac82de7f2b5fd0f21c05556e: transactional SQLite imports and private independent storage, account-scoped identity, retained snapshots, search/pagination, shared read/pin/archive/attention and guarded local removal.
3. 8904051fd3d28ba5c1be1858a6c5450d8c665269: client-runtime/conversations reader model, package export and 44 regression cases. Persistence and normalization were not rebuilt or modified.

The old PR body was replaced with a history-aware description. The prior author's comment 5559060294 remains intact. That author described local model/UI drafts; no actual bytes were available to this continuation. The new model was authored from published contracts and specification, not recovered from those drafts.

## Reader behavior and reviewed findings

The model exposes subscribe/getSnapshot for later React integration but performs no HTTP and grants no authority. It fences exact pending tickets by environment and connection generation, resets on account/filter/selection changes, rejects mismatched detail identities and explicit page/branch/snapshot requests, and refuses catalog page splicing across revisions. Snapshot/branch paging remains anchored to the visible snapshot. Gaps and unsupported-media markers remain unchanged.

Read acknowledgements require the exact explicitly displayed current terminal page, matching content/read-through revision, and a nonconflicting canonical snapshot. Receipt/prefetch alone never marks read. Flag requests include only explicit pin/archive/attention fields. Writes are single-flight, not optimistic, and never automatically retried after unknown outcomes. Snapshot selection and local removal carry the observed content revision.

Sequential self-review closed regression-tested defects involving atomic reply publication during subscriber rebinding, obsolete dispatch tickets, late successful acknowledgements without revision regression, structural extra-field smuggling, retained retry selection, stale capability replies, and removing A while newly selected B remains visible but stale. This is not an independent review. The fresh merged PR discussion contained only the older storage checkpoint and no review approval or inline findings.

## Required next implementation unit: shared core

Core is NOT complete and NOT merge-ready. Still implement runtime request/reply schemas, authenticated HTTP around the existing store, the actual prepared-connection client adapter, shared React reader/import flow, and pinned-toolchain/application verification. The three UI alternatives are not substitutes for those missing pieces.

Reuse these actual published paths rather than introducing a second transport or database:
- packages/contracts/src/conversationLibrary.ts: current pure request/reply types; no runtime schemas yet. Preserve the pure import closure when adding Effect schemas. Existing request path is /api/conversation-library; bounded supplied exports only.
- apps/server/src/conversations/Store.ts and open.ts: execute(request, canWrite) and openConversationLibrary(stateDir, write, now). Use ServerConfig.stateDir; storage is conversation-library/library.sqlite, never the coding database. Close acquired stores and preserve read-only missing-library behavior, scope guards and request-size limits.
- packages/contracts/src/environmentHttp.ts and apps/server/src/auth/http.ts: existing EnvironmentHttpApi, EnvironmentAuthenticatedAuth/Principal and requireEnvironmentScope. Reuse existing environment authentication; account/workspace labels are catalog identity, not independent authentication authority.
- apps/server/src/server.ts makeRoutesLayer: HttpApiBuilder.layer(EnvironmentHttpApi) currently provides auth/connect/orchestration/pullRequests/metadata groups plus environmentAuthenticatedAuthLayer. Add coherent library wiring using the same runtime. Read complete current bytes and recheck instructions before editing.
- packages/client-runtime/src/state/pullRequestDiffHttp.ts: reference HTTP loader built on PreparedConnection, makeEnvironmentHttpApiClient/UrlBuilder, buildEnvironmentAuthHeaders, withEnvironmentCredentials and executeEnvironmentHttpRequest. Reuse these helpers. Read state/environmentHttpAuth.ts and connection/model.ts next; those exact files were not yet read in this continuation.
- packages/client-runtime/src/state/pullRequests.ts: existing createEnvironmentQueryAtomFamily with EnvironmentSupervisor.prepared SubscriptionRef is the model for readiness/connection binding. rpc/http.ts owns timeout/error normalization; explicitly retain typed library conflict/domain errors rather than losing them in generic mapping.
- packages/client-runtime/src/conversations/model.ts: newly published presentation model. The adapter must decode replies first, rebind when the environment/generation changes, and verify isPending(ticket) immediately before dispatch on the matching prepared connection. No real adapter has yet been implemented or qualified.

Add request/reply schema cases, authenticated/unauthenticated/read-only/scope/bounds tests, real SQLite HTTP round trips, client credential-mode and connection-generation cases, and shared React tests. Validate actual app-level routing and accessible responsive reader/import behavior. Keep export content inert; no media fetching or executable rendering from supplied records.

## Three alternative interfaces

Fresh branch listing found no work/conversations-center, work/conversations-workspace or work/conversations-inbox. None has a PR or head. Once the completed shared core is coherently verified, create each from that SAME core commit and open separate PRs targeting the core branch. Center is the utility-page reader; Workspace is the preferred dedicated Code / Conversations experience; Inbox is the activity-inbox/reading-dock alternative. Do not duplicate persistence/auth/domain code or combine/merge all three alternatives.

## Evidence and blockers

checks.json records 44/44 reader cases, strict targeted TypeScript and real package-export resolution. These used Node 22.16.0, TypeScript 5.8.3 and real Node declarations 25.1.0; not the pinned Node ^24.13.1 / pnpm 11.10.0 / Vite+ toolchain. The Vite+ case-registration file was published but not executed locally. No dependency stubs were used. Local scratch is only a partial mirror, not a full checkout. Clone and runtime/dependency acquisition were unavailable. Earlier normalization/SQLite/ownership results remain prior-author evidence, not rerun claims here.

New-head CI 34077924921 was still queued after its >=180-second quiet window: all eight jobs had runner_id 0, empty runner names, empty steps and null conclusions. Mobile Fingerprint Check 34077924908 likewise had one queued, unassigned job. Preview jobs were skipped, not passed. No source-level CI failure is yet available to remediate. Preserve runner policy; do not swap runners, remove tests or weaken workflows merely to report green. A functioning authorized pinned-toolchain environment and runner access/availability must be reconciled before app qualification. Do not infer the account/organization cause from queued status alone.

No application, responsive browser, screenshot or native-client proving occurred. No VPS or deployment is needed merely to finish repository implementation/tests; deployment remains separately unauthorized. Do not re-request authorization for work already within the user's repository task.

## Operating provenance and recovery

Codex-V3 is evidence/guidance only: docs/chatgpt-web-github-scratch-flow branch and handoff plus linked scratch-persistence instructions; audit branch docs/active-thread-handoff-astra-20260906 with active-engineering-threads-20260906.md/evidence.json; planning PR #170, spec docs/engineering-specs/t3-chatgpt-conversation-workspace.md and associated Work Note. The planning PR read was pinned to 1bde72ecf78df925044329b93417a37a09e9f026. Target root AGENTS.md and vendored .repos/effect-smol/LLMS.md were read. No applicable nested AGENTS existed in the edited client-runtime paths at the source head. Re-read current instructions and refs before further work.

Before creating this companion, all 16 workflow trigger sections at the source head were inspected. Push triggers target main or release tags, not this scratch branch. Other events are PR/PR-target/issue/comment/discussion, workflow_run, workflow_call, schedule or manual dispatch. No create trigger was found. No recovery PR, tag, manual dispatch or deployment is requested. Existing workflows remain unchanged.

Recovery adds only .chatgpt-scratch files on scratch/level-2/work/conversations-core; implementation stays on work/conversations-core. Checkpoint manifest hashes identify retained notes, check summaries and publication provenance. There are no unpublished application drafts to recover. Never describe these notes as completion of the missing HTTP/React/three-interface work.
