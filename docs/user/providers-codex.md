# Codex

This guide is for people who want to use more than one Codex account in T3 Code. For Claude, see
[Claude](./providers-claude.md). For first-time setup, see [Install T3 Code](./install.md).

Common reasons:

- use a work account for work projects
- use a personal account for personal projects
- switch to another account when one account hits limits
- keep one shared Codex history instead of maintaining two separate Codex setups

## I Only Use One Codex Account

Use the default provider.

In Settings, your Codex provider can stay like this:

```text
Display name: Codex
CODEX_HOME path: ~/.codex
Shadow home path: empty
```

Log in with Codex normally:

```bash
codex login
```

## Send feedback to OpenAI

In an existing Codex thread, send `/feedback` or `/feedback` followed by a description of the
issue. T3 Code uploads the thread and Codex logs to OpenAI and shows a thread ID that you can copy
and share with OpenAI employees.

## Answer questions while Codex works

Codex can ask questions without stopping its work. Choose a suggested answer or enter your own
in the question panel. Questions without suggested answers accept text.

Your answers are sent as a new message. They reach the current turn while Codex is working, or
start a new turn if it has finished. Unanswered questions stay available after you reconnect.
This works in the web, desktop, and mobile apps. Codex must support async questions.

## Automatic capacity recovery

If a turn started with Sol at medium reasoning and Codex reports terminal server-capacity pressure,
T3 Code keeps the failure visible and continues the same turn automatically. It retries the same
selection up to 20 times at 15-second intervals, then tries Sol at high reasoning and Astra at
medium reasoning when Codex advertises those exact selections. Each selection gets the same bounded
retry window.

Sending a new message or interrupting the turn cancels a pending retry. T3 Code stops recovery
instead of replaying when Codex cannot confirm what happened, when the session closes, or when a
fallback selection is unavailable.

## Stop a goal

Selecting **Stop** pauses an active native Codex goal before interrupting the current turn and
its sub-agents. This prevents the goal from immediately starting another continuation. Stop
also pauses the goal when an automatic capacity retry is waiting to start.

If Codex cannot read or pause the goal, T3 Code still interrupts the turn. The goal may remain
active in that case. Threads without an active goal keep their ordinary Stop behavior.

## Sub-agent models

The web and desktop Agents panel shows each sub-agent's model and reasoning effort when Codex
reports them. If Codex does not report either value, T3 Code leaves it out instead of using the
parent agent's settings.

## Browser and computer activity

Browser and Computer Use calls show their user-facing task title when Codex provides one. Expanded
activity groups show an icon for every call. Website calls use the active page's favicon when it is
available, and desktop app calls use the app's native icon on macOS when available. Other hosts use
a generic fallback glyph.

Collapsed activity groups are summarized by source, such as `Used Chrome integration`, instead of
showing the underlying tool name. Website favicons and native app icons keep their original colors;
integrations that provide separate light and dark logos use the logo for the current appearance.

## Approve access to other apps

When a Codex tool needs access to an app such as Safari, T3 Code shows the app name and asks for
approval. You can approve, decline, or cancel the request from the desktop app, web app, or mobile
app. Some tools also offer approval for the current session or permanent approval.

## I Want Work And Personal Codex Accounts

Use one real Codex home and one shadow home.

Recommended setup:

```text
~/.codex      shared Codex home
~/.codex_p    second account auth
```

The idea is:

- both accounts can see the same T3/Codex sessions
- each account keeps its own login
- existing threads can continue with either account

### Set Up The First Account

Log in normally:

```bash
codex login
```

This is the account used by `~/.codex`.

In T3 Code Settings, name it something obvious:

```text
Display name: Codex Work
CODEX_HOME path: ~/.codex
Shadow home path: empty
```

### Set Up The Second Account

Log in with a separate Codex home:

```bash
mkdir -p ~/.codex_p
CODEX_HOME=~/.codex_p codex login
```

In T3 Code Settings, add another Codex provider:

```text
Display name: Codex Personal
CODEX_HOME path: ~/.codex
Shadow home path: ~/.codex_p
```

The important part is that both providers use the same `CODEX_HOME path`, but only the second one
has a `Shadow home path`.

## Which Account Am I Using?

Open Settings and look at the provider row.

T3 Code shows the authenticated email for providers that report one. Emails are blurred by default;
click the blurred email to reveal it.

Use display names and accent colors to make accounts easy to tell apart in the model picker.

## I Need A Different API Key Or Endpoint

Use the provider's Environment variables section in Settings.

This is useful when a Codex-compatible setup needs account-specific variables. Add the variables to
the provider instance that should receive them, and mark API keys or tokens as sensitive. Sensitive
values are stored as server secrets and are not sent back to the app after saving.

## Can I Switch Accounts In An Existing Thread?

Yes, when both Codex providers share the same `CODEX_HOME path`.

For example:

```text
Codex Work      CODEX_HOME path: ~/.codex
Codex Personal  CODEX_HOME path: ~/.codex, Shadow home path: ~/.codex_p
```

Those two providers are considered compatible for continuation, so the locked model picker can show
both.

If you add a third Codex provider with a completely different `CODEX_HOME path`, T3 Code treats it
as a different workspace. It will not be offered for existing threads created under `~/.codex`.

## If Both Accounts Look The Same

If two Codex providers show the same account or the same unexpected model list:

1. Check the email in Settings.
2. Refresh provider status.
3. Confirm the second provider has `Shadow home path` set.
4. Confirm the shadow directory has its own `auth.json`.
5. If you copied `~/.codex` into the shadow directory, remove everything except `auth.json`.

Example cleanup:

```bash
find ~/.codex_p -mindepth 1 ! -name auth.json -exec rm -rf {} +
```

## When To Use A Separate CODEX_HOME

Use a totally separate `CODEX_HOME path` only when you want a separate Codex workspace.

That means separate sessions and less account switching inside old threads. Most dual-account users
should use the shared-home plus shadow-home setup instead.
