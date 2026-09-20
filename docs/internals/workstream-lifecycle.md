# Workstream lifecycle authority

Workstream lifecycle is owner-registry state. T3 may submit an explicit `update_workstream` command
on behalf of an authorized principal, but it does not derive lifecycle from local thread or delivery
events. A workstream shown as completed is confirmed only when its current summary is backed by the
latest matching `WorkstreamLifecycleDeclaration`. A missing or conflicting declaration fails closed
as unverified completion. The native projection accepts only history aggregated from the first page
through a terminal cursor, binds it to the detail's registry snapshot, and verifies the declaration
against its enclosing audit event. Unproved coverage, duplicate latest revisions, future evidence,
or mismatched actor, command, time, registry version, and affected workstream evidence also fail
closed.

The minimized or cached list DTO carries only the registry's lifecycle summary. T3 labels a
`completed` list row as requiring verification until the complete detail history confirms its owner
declaration. All lifecycle, membership, statement, relationship, refresh, ordering, and native
settlement mutations require `workstreams:write`; a read-only binding remains observational even
when its reference is otherwise attested.

These facts remain independent:

- A provider session or turn terminating means only that the turn ended.
- A membership disposition describes one attached native resource.
- A pull request observation is delivery evidence and may be stale or unavailable.
- Native T3 settlement changes the owning environment's thread organization only after a separate,
  explicitly authorized request and terminal receipt.
- Workstream completion is the owner principal's lifecycle disposition for the larger effort.
- An owner statement is contextual text with no lifecycle or execution-authority effect.

Neither check success nor a closed or merged pull request grants lifecycle or settlement authority.
Reopening a completed or abandoned workstream is another explicit owner action and identifies the
superseded lifecycle declaration. T3 preserves the registry's actor, command, revision, and registry
version as completion evidence; it does not synthesize those fields from client state.

The top-level T3 project remains an environment-local workspace record. It has no completion state;
the owner-wide workstream is the product concept that carries goal lifecycle across projects,
threads, providers, repositories, and environments.
