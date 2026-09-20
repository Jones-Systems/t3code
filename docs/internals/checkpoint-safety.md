# Checkpoint safety — S01 Work Note

## Scope

S01 separates synthetic checkpoint prevention from closure of the protected historical incident.
This note covers only the current checkpoint writer and the invariant enforced for future captures.

Protected historical backups and refs are not inputs to this work. Their inspection, reproduction,
disclosure, cleanup, and incident closure remain separately gated.

## Current writer

`GitVcsDriver.checkpoints.captureCheckpoint` is the final writer seam. It builds a synthetic commit
with a temporary index and then updates the requested checkpoint ref. `CheckpointStore` delegates to
this capability, while orchestration callers decide when a checkpoint is requested.

## Invariant

Checkpoint capture is allowed only from a linked Git worktree. Before creating a temporary index,
staging files, creating a commit, or updating a ref, the writer resolves Git's per-worktree directory
and common directory. Equal directories identify the physical primary checkout and make capture fail
with `VcsPrimaryCheckoutCheckpointError`. The rule is deliberately independent of branch names and
working-tree cleanliness.

Synthetic tests create disposable repositories and linked worktrees. They must not depend on or
inspect historical checkpoint refs or backups.

## Verification record

- Base revision: `e4325b79fb72221a2ca5050bce4dfe9363f45377`.
- Focused checkpoint, reactor, GitLab mapping, and orchestration integration tests cover the changed
  paths: 46 passed and 1 skipped.
- Synthetic clean and dirty primary checkouts verify refusal without creating a checkpoint ref.
- Targeted contracts and server typechecks pass. The first server typecheck attempt was killed with
  exit 137 and no diagnostics; a fresh capacity-gated retry completed successfully.
- Targeted lint and formatting checks pass.
- Independent review found an exhaustive `VcsError` mapper gap and missing clean-primary coverage;
  both findings were corrected before publication.
- The commit, pull request, and exact-head required-check result are recorded by the task branch and
  pull request once published.
