# Review usage

The Usage page combines Codex, Claude Code, and Grok Build activity from your connected
environments. It reads the providers' local session history and shows API-equivalent token cost,
processed tokens, cache savings, provider shares, and model breakdowns. Subscription billing is
separate from the raw token cost shown here.

Use the provider filter to select one or more configured entries from **Settings → Providers**.
Names include instance IDs or environment labels when needed to distinguish entries. Choose
**All providers** to return to the combined view; charts and provider shares still group activity by
provider family. Disabled entries remain selectable so you can inspect their saved history. Entries
without a usage collector remain visible and are marked **Usage not collected**. If an entry's usage
history is unavailable, the page says so instead of showing its missing data as a measured zero.

Some entries can share transcript history. The page explains when that applies; selecting either
entry or both counts the shared source once. Older connected servers that do not provide instance
details show a coverage notice. Their history remains in **All providers**, but cannot be isolated
by entry.

Expand a model row to see ordinary input, cache reads and writes, total input, output, reasoning
output, cache shares, record counts, cache savings, and unpriced records. Cache read and write
percentages use total input (ordinary input + cache reads + cache writes); reasoning output is
included in output. These details use reported token counts. Usage collection currently covers
Codex, Claude Code, and Grok Build; other configured providers may be shown without collected
usage details. Providers may omit cache-write or reasoning details. The provider filter applies to
historical usage only; Limits remains a separate live quota view.

Grok Build totals come from persisted session updates. Interactive turns that never wrote a
completed-turn record will not appear.

The **Limits** view shows how much of each subscription window you have used on Codex and Claude
Code, per connected environment: the session and weekly windows, plus a per-model weekly window
such as Fable when your plan has one. Each window is a bar from the moment it opened to its reset,
filled by the share of quota spent; a thin line marks how far into the window you are, which is
also where even spending would have put the fill, and the icon beside the label says whether you
are ahead of, on, or under that pace. Hover a bar for the exact reset time. Limits refresh on the
provider health-check interval and update live while a turn runs. API-key accounts have no
subscription windows and say so; that includes a Claude Code that reaches Anthropic through a proxy
via `ANTHROPIC_AUTH_TOKEN`, since the CLI then treats itself as an API-key client.

If you pool accounts behind a CLIProxyAPI hub, open **Settings → Providers → Usage providers**
and choose **Add hub**. Select the device that should connect to the hub; its accounts appear on
the Limits view. Remove hubs from the same settings section. Each limits row shows its provider
and instance name, or a small _CLI Proxy_ label for
hub accounts. When a connected provider reports limits for the same provider and email, its row
replaces the hub copy, keeping details such as banked reset credits. The hub copy remains visible
if the connected provider cannot report limits. Enter the hub's URL and management key; the key
is stored on the server and never sent back to a client. Emails are blurred until clicked, as in
provider settings.

Use **Past 24h** for an hourly chart covering the exact rolling 24-hour period. The **7 days**,
**30 days**, and **90 days** ranges use daily resolution. Cost and token toggles update both the
headline and chart. Refreshing rescans every connected environment and refetches model pricing on
each of them, so a newly released model that showed $0.00 gets a price without waiting for the daily
pricing update.
