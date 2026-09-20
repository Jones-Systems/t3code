# Work Note: Provider runtime identity attestation (P01)

## Problem

T3 records the provider instance, driver, model, and provider options it asks an adapter to use.
Those values describe routing intent. They do not prove which backend, model, account, or service
tier ultimately served a turn. In particular, several adapters synthesize `turn.started` model
metadata from the request they just sent. Treating that echo as observation makes requested and
effective identity appear equal even when the provider reroutes or ignores a setting.

## Contract

`OrchestrationSession.runtimeIdentity` keeps two records side by side:

- `requested` is the route T3 recorded: provider instance, provider driver, model, and an explicitly
  selected service tier when present.
- `observed` contains one state for each effective dimension: `observed`, `unknown`, or
  `unavailable`. An observed value names its authoritative provider event. Unknown means no
  authoritative evidence has arrived for the current request. Unavailable means the provider
  boundary does not safely attest that dimension.

Each launch also carries an opaque runtime generation. Provider observations are accepted only
when their driver, instance, and generation all match the projected session, preventing delayed
events from a retired same-instance runtime from repopulating current observations.

Clients and server logic must not promote configuration, model catalogs, authentication status,
usage-limit account metadata, launch arguments, or adapter-synthesized lifecycle fields into an
observed value.

## Authoritative evidence

| Provider boundary                   | Event or response                                | Safe observations                                      | Explicitly not attested       |
| ----------------------------------- | ------------------------------------------------ | ------------------------------------------------------ | ----------------------------- |
| Codex app server                    | Typed `thread/start` or `thread/resume` response | model, `modelProvider` backend, non-null `serviceTier` | account; a null tier          |
| Codex app server                    | `model/rerouted` notification                    | rerouted model                                         | backend, account, tier        |
| Claude Agent SDK                    | Native `system:init` message                     | model                                                  | backend, account, tier        |
| Cursor, Grok, OpenCode, Antigravity | Current canonical events                         | none                                                   | backend, model, account, tier |

The unsupported providers still expose requested routing. Their observed dimensions remain unknown
until an authoritative native event is mapped. Account remains unavailable for every current
provider because no supported lifecycle event binds an account identity to the specific runtime or
turn. Reading credentials or provider-private state is outside this contract and would not repair
that missing binding.

## Lifecycle rules

- Every new runtime generation resets observations to unknown, except account, which is
  unavailable. A failed launch restores the prior session and its observations.
- Repeated lifecycle events for the same request preserve prior authoritative observations.
- A Codex reroute updates only the observed model.
- Historical snapshots without the optional identity field continue to decode.
- The projection persists the identity document as JSON so web, desktop, mobile, and remote clients
  receive the same contract through the existing thread session surface.

## Verification record

Focused coverage owns schema compatibility, projection migration and round-trip behavior, Codex
response normalization, Claude init normalization, same-instance generation correlation,
transactional recovery ordering, failed-launch rollback, and ingestion's refusal to treat
synthesized `turn.started` model metadata as observation. The pull request and its exact-head
checks are the publication record for this work note.
