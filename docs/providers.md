# Provider credentials, models and usage

How a workspace decides which credentials it may spend, which models an agent may
pick, and how the platform accounts for what was spent.

Status: **a slice is built.** `apps/backend/src/providers/` stores a key as a
`user_credentials` row of kind `opencode-go`, proves it against the usage endpoint
before writing anything, caches the model list the key returns, and answers which
keys and models a workspace may spend through `/providers/*` and
`/workspaces/:workspaceId/providers`. Two things are deliberately not built yet:
the six tables below in their full shape, and everything that needs them — per-call
usage rows, meter snapshots, polling and admission control. `providers/usage`
answers zeros for that reason, and a zero there means "not recorded", never "free".
Sources are listed at the end; everything about OpenCode Go is from their
documentation read on 2026-11-24.

## Why

Two questions that look like one but are not:

- **Which key pays for this request?** A store may hold three OpenCode Go keys
  and one Anthropic key. A workspace should be able to allow two of the Go keys
  and none of the Anthropic one, so a mistake in one workspace cannot spend
  another's budget.
- **What did the request cost?** A subscription meters dollars in windows; a
  pay-per-token key meters tokens. Both must produce one number, or the stats
  screen lies.

## Credentials belong to the store, workspaces allow a subset

Credentials already live in the store, encrypted with the `SECRET_KEY`-derived
key used for TOTP secrets (`apps/backend/src/auth/secret-box.ts`). What changes
is that a workspace names which of them it may use:

| table | columns |
| --- | --- |
| `workspace_credentials` | workspace id, credential id |

That is the whole mechanism: a workspace's usable models are the union of the
models its **allowed credentials** offer. Nothing about credentials is copied
into the workspace, so rotating a key in the store rotates it everywhere.

An agent then narrows further, inside the workspace's set:

| column on `agents` | meaning |
| --- | --- |
| `allowed_models` | provider-qualified ids (`opencode-go/claude-haiku-5-5`) the agent may run |
| `model` | the one it runs now |
| `thinking_level` | `off`/`low`/`medium`/`high`/`xhigh`/`max`, as the catalog names them |

The UI order follows from this: pick credentials for the workspace once, then the
agent screen offers only the models those credentials can serve. A model whose
credential is removed from the workspace stops being selectable; an agent running
it is refused at harness open with a message that names the missing credential
rather than falling back to something else.

## Two billing kinds, one accounting shape

Every provider credential carries exactly one of two shapes. There is no third,
and no "unknown":

**`subscription`** — a fixed price buys an allowance measured in **dollars in
windows**. OpenCode Go is this kind.

- `plan` (`go`, `go-plus`, `go-teams`), `monthly_allowance_usd`;
- meters: `rolling` (5 hours), `weekly`, `monthly`;
- usage is reported by the provider as a percentage of the allowance, not as
  tokens.

**`metered`** — pay per token, no windows. OpenCode Zen and most direct provider
keys are this kind.

- `unit_prices` come from the model catalog (input, output, cache read, cache
  write, per million tokens, with tiered prices above a token threshold);
- usage is computed from token counts the response reports.

The distinction is not cosmetic: it decides what a "budget" is (a percentage of
an allowance versus dollars spent), which meter can refuse a request, and which
number the stats screen shows.

## OpenCode Go, concretely

**Three meters, one allowance.** The 5-hour limit is 20% of the monthly
allowance and starts with first use; the weekly limit is 50% and resets Monday
00:00 UTC; the monthly allowance resets with the paid period. Each model has its
own monthly dollar limit — the same allowance buys different amounts per model —
and every request reports what it counted.

**Usage endpoint.**

```bash
GET https://opencode.ai/inference/go/v1/usage
Authorization: Bearer <go-api-key>
```

```json
{
  "usage": {
    "rolling": { "status": "ok", "percent": 30, "resetsAt": "2026-11-21T15:00:00.000Z" },
    "weekly": { "status": "rate-limited", "percent": 100, "resetsAt": "2026-11-23T00:00:00.000Z" },
    "monthly": { "status": "ok", "percent": 50, "resetsAt": "2026-12-01T00:00:00.000Z" }
  }
}
```

`percent` is a whole number 0–100, `status` is `ok` or `rate-limited`, `resetsAt`
is ISO 8601. An invalid key answers `401`; a key the plan does not cover answers
`403` with `{ "type": "error", "error": { "type": "EntitlementError", ... } }`.
On Go and Go Plus the key is the subscriber's personal key or a service account
key; on Go Teams any member's personal key works.

**Models endpoint.** `GET https://opencode.ai/inference/go/v1/models` returns the
model list with metadata including each model's monthly usage limit. The local
catalog already carries the per-token prices
(`node_modules/@earendil-works/pi-ai/dist/providers/data/opencode-go.json`), so
prices do not need to be fetched at runtime; the monthly limits do.

**Exactness, stated plainly.**

| question | answer | how |
| --- | --- | --- |
| what did this request count against the allowance? | **exact, from the provider** — Go reports `opencode.allowance` per response | needs upstream support in `pi-ai`, which does not surface it today |
| what did this request cost at list price? | **exact arithmetic** — tokens × catalog price, and `pi-ai` already returns `Usage.cost` computed that way | `Usage` in `pi-ai/dist/types.d.ts:292` |
| how much of the month/week/5h is gone? | **exact, from the provider** — the three meters | poll the usage endpoint |
| what is left in the rolling window? | exact: `100 - percent` applied to that model's monthly limit ÷ 5 | derived |

So per-message dollars are available two ways and they should agree: the
provider's own allowance figure (authoritative) and tokens × catalog price
(computable today). Storing both turns the second into a reconciliation check for
the first.

## Recording usage

One row per model call, written when the turn commits:

| column | why |
| --- | --- |
| workspace, conversation, entry id | so a message can be attributed and a conversation costed |
| provider, credential id, model, plan | "what spent it" — the credential is the unit a budget belongs to |
| tokens: input, output, cache read, cache write, reasoning | `pi-ai`'s `Usage` already separates these |
| `cost_usd` at catalog price, computed at write time | prices change; the row must not be recomputed later |
| `allowance_usd` when the provider reported it | the authoritative figure for subscription keys |
| `recorded_at` | the "at what time" in the stats |

Cost is written, not derived on read. A price change must not rewrite history, so
the row carries the numbers that were true when it happened — the same reason
`entries` store the model that answered.

Meter snapshots are a second table, one row per credential per poll:
`meter` (`rolling`/`weekly`/`monthly`), `status`, `percent`, `resets_at`,
`fetched_at`. Snapshots are append-only; the current value is the newest row.
Polling interval per credential, default five minutes when the workspace has an
active conversation and every thirty minutes otherwise, so an idle install does
not hammer the endpoint.

## Where this plugs into the client

Four facts from `@earendil-works/pi-ai`, checked in `apps/backend/node_modules/@earendil-works/pi-ai/dist/types.d.ts`,
because they decide how much of this is configuration and how much is a fork:

1. **`StreamOptions.apiKey`** (types.d.ts:52) — the key can be passed per request, so
   "which credential pays" needs no environment variable and no process restart.
   Today `apps/backend/src/agent.ts` opens the provider once, with a credential store
   (`providers/stored-credentials.ts`) that answers the owner's newest stored OpenCode
   Go key; `OPENCODE_API_KEY` is only the fallback when none is stored. One key serves
   every chat. Choosing the key per workspace is still to come.
2. **`StreamOptions.sessionId`** (types.d.ts:144) becomes the `x-opencode-session`
   header (`dist/providers/opencode-headers.js`), which Go asks every client to send
   so it can route and cache per conversation. We pass nothing today, so every
   conversation looks like one anonymous stream and prompt caching is left on the
   table — which is a cost item, not a nicety. The conversation id is the right
   value, and it is already stable.
3. **Prices come from the catalog, tiers included.** `providers/data/opencode-go.json`
   carries `cost.input`, `cost.output`, `cost.cacheRead`, `cost.cacheWrite` and
   `cost.tiers` (`inputTokensAbove`), and `Usage.cost` is already resolved from them.
   So no price fetching at runtime, and no risk of our arithmetic drifting from
   theirs on tiered prompts.
4. **Cost is already summed per conversation.** `UsageTotals` in
   `apps/backend/src/agent.ts` carries `cost` alongside the four token counts,
   summed from the engine's usage ledger. What is missing is the *workspace*,
   *credential* and *model* dimensions — the existing total has no axis to group by.

Because of (1) and (2), the credentials feature is a routing change: pick credential →
pass `apiKey` and `sessionId` → record what came back. Nothing in the client blocks it.

## The Go meters are admission control, and that is delicate

Two properties of Go make "refuse when the meter is full" wrong as stated:

**Extra Usage.** With it enabled, a `rate-limited` meter does not block — the request
continues against Console credits at list price. Whether it is on is a console
setting we cannot read. So a platform that refuses on `rate-limited` will refuse
turns the provider would happily serve, and the user who pays extra for exactly
that continuity pays for nothing. The right shape: **warn, do not block**, unless the
workspace says "stop at the limit" — a setting that exists precisely because the
answer lives in a console we cannot see.

**Granularity.** `percent` is a whole number, so on a $60 allowance one step is 60
cents. Snapshots cannot tell a $0.12 request from a $0.60 one; per-request dollars
have to come from the response (`opencode.allowance`) or from tokens × catalog
price. Snapshots draw the curve and prove the windows; they do not bill.

**Go Teams meters per member.** A credential's percentage belongs to the person who
owns that key, not to the workspace, so a workspace total is a sum of member
meters — which is why the usage table is keyed on the credential and aggregated
upward, never the reverse.

## Schema

Six tables, none of which need a new dependency.

```sql
provider_credentials        -- widen the existing encrypted credential row
  billing text not null     -- 'subscription' | 'metered'
  plan text                 -- 'go' | 'go-plus' | 'go-teams', null for metered
  monthly_allowance_usd     -- null for metered

workspace_credentials
  workspace_id, credential_id, primary key (workspace_id, credential_id)

agents
  allowed_models text[]     -- provider-qualified ids, subset of what the workspace allows
  model text                -- the one it runs now, null until set

usage                        -- one row per model call, written where entries are written
  conversation_id, entry_id, call_index   -- (entry_id, call_index) unique: a replay cannot double count
  workspace_id, credential_id, provider, model
  input, output, cache_read, cache_write, reasoning
  cost_usd                  -- catalog price at write time
  allowance_usd             -- provider-reported, null when unreported
  recorded_at

meter_snapshot               -- append-only, one row per credential per poll
  credential_id, meter ('rolling' | 'weekly' | 'monthly'),
  status, percent, resets_at, fetched_at
```

Two choices here are the load-bearing ones. **`(entry_id, call_index)` unique** is
what makes the write idempotent: the engine can replay an append after a crash and
the second one is a no-op instead of a second charge. **`cost_usd` stored, not
derived** is what makes a price change a price change rather than a silent rewrite
of last month's bill — the same rule that puts the model name on the entry that
answered.

## What the stats show

- **Per workspace:** dollars and tokens this month, split by model and provider,
  and percentage of every subscription allowance consumed.
- **Per credential:** the three meters with reset times, plus a spend curve since
  the window opened.
- **Per conversation:** what it cost, per model, including model switches — which
  is why the switch marker and the usage rows share the entry id.
- **Across time:** dollars per day/week/month, so "what did November cost" is a
  query rather than a spreadsheet.

Two numbers must reconcile or the screen has to say so: the sum of
`allowance_usd` per credential per window versus the meter delta observed between
the first and last snapshot in that window. A discrepancy is displayed, not
hidden — silent disagreement between an estimate and a bill is worse than a
visible gap.

**Two currencies, never blended.** `cost_usd` is list price; `allowance_usd` is what
the plan was charged, and a $10 plan buys $15 of usage on some models, so they are
different numbers on the same request. A single "total spend" that adds both would
be arithmetic over currencies. The rule: a subscription's spend is reported in
allowance dollars, a metered key's in list dollars, a mixed workspace shows the two
totals side by side and says which is which, and no query ever sums across the
billing kind.

**Admission control, not just accounting.** Because the rolling meter is only
full five hours ahead, the backend refuses a turn when every allowed credential
for the chosen model reports `rate-limited` on `rolling`, and says which meter
recovers when. With multiple credentials allowed in a workspace, it picks the one
with the most headroom — which is the reason the workspace-level credential list
exists at all.

## Open

- **Scope of the first implementation is OpenCode Go only.** The two billing kinds
  and the usage tables are written to hold any provider, but only Go has a usage
  endpoint this design reads. A metered key is accounted from token counts alone
  until someone needs more; no other provider's balance API is polled.
- **`opencode.allowance` is not surfaced by `pi-ai`.** Reading it means either an
  upstream change to `@earendil-works/pi-ai` (report the field alongside `Usage`)
  or a second reader of the raw provider response, which would mean bypassing the
  client. Until one of those lands, per-message dollars are computed at list price
  and reconciled against meter deltas.
- **What counts as a "budget" for a metered key.** No window and no provider
  number: either the user sets a monthly ceiling and the platform enforces it, or
  there is no budget and only spend. Guarding it means checking before a turn, not
  after — which means a metered key needs a local ledger that is trustworthy enough
  to refuse on.
- **Where the polling lives.** A timer in the backend process is the obvious
  answer and dies with the process; a durable task saves the timestamp but needs
  the alert path to be idempotent.

## Sources (read 2026-11-24)

- Go plans, limits and the usage endpoint: <https://opencode.ai/docs/console/go/>
- Usage endpoint documented upstream: <https://github.com/anomalyco/opencode/pull/65455>
- Pay-as-you-go prices: <https://opencode.ai/console/models>
