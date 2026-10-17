---
name: rcat
description: "Read RevenueCat analytics with the `rcat` CLI — overview metrics (MRR, active subscriptions, active trials, revenue and new customers over the last 28 days), revenue for any date range with a total across apps, and any RevenueCat chart (MRR, ARR, churn, trials, conversions, retention, LTV, refunds, paywalls, ads…) for one or several RevenueCat projects at once. Use when asked how an app is doing financially, about subscription revenue, proceeds, MRR, subscribers, trials, churn, conversion or other RevenueCat numbers, to compare apps, or to report on a period. Read-only, it never changes anything in RevenueCat."
---

# Reading RevenueCat analytics with `rcat`

`rcat` reads the RevenueCat API v2 for several RevenueCat projects (one per app) at once. It is
**read-only**: nothing you run can change RevenueCat data, so you can run it freely to answer questions.

## Before the first command

- Run `rcat` if it is on the PATH. Otherwise use `node <checkout>/bin/rcat.mjs`. The checkout is two
  directories above this file (`../../bin/rcat.mjs`). Node 22.13 or newer is required.
- The API keys are already in the environment. **Never print, echo, `env | grep` or ask for an API key**,
  and never pass one as an argument. Refer to keys only by the *name* of their variable. `rcat` itself
  redacts keys from everything it prints.
- Add `--json` whenever you will process the output. It prints exactly one line of JSON on stdout.
  Leave it off when you only show the result to the user.

## Accounts: one per RevenueCat project

An **account** is the full name of an environment variable holding a project's v2 secret key, for example
`REVENUECAT_MYAPP_APIKEY`. `rcat` never shortens or completes names, so always pass the full variable
name.

- **Default set (no `-a`):** every non-empty variable matching `REVENUECAT_*_APIKEY`. If `RCAT_ACCOUNTS`
  is set, it replaces that default with a comma-separated list of variable names.
- **Choose explicitly:** pass `-a VAR [VAR...]` or `--account VAR`. `-a` takes several values, so put
  the chart name (the positional argument) **before** `-a`:
  `rcat chart mrr -a REVENUECAT_MYAPP_APIKEY`. Do not write `rcat chart -a REVENUECAT_MYAPP_APIKEY mrr`.
- **Start here:** `rcat accounts` lists the variables together with the project id and the human project
  name, e.g. `REVENUECAT_MYAPP_APIKEY  proj1a2b3c4d  My App`. Use it to map the app the user mentions to
  the right variable. Use the project name, not the variable name, when you talk to the user.
- The project behind each key is looked up through the API and cached in `~/.rcat-cli/projects.json`,
  which holds no keys. If a key can see several projects, or cannot list projects, pass
  `-a VAR --project-id <id>`. `--project-id` is allowed only with exactly one account.

## Commands

All commands accept `-a`, `--project-id` and `--json`, except `charts`, which accepts only `--json`.

### `rcat overview [--currency CODE]`
Shows the dashboard numbers for each account:
- **Current values** (`period: "P0D"`): Active Trials and Active Subscriptions.
- **Last-28-days values** (`period: "P28D"`): MRR, Revenue, New Customers and Active Users.

This is the quickest answer to "how are my apps doing". It is also the endpoint most likely to work
even with limited key permissions.

### `rcat revenue [--days N | --from YYYY-MM-DD --to YYYY-MM-DD] [--type revenue|net|proceeds] [--currency CODE]`
Shows revenue for an inclusive date range for each account. When there are two or more accounts, all
succeeded and all report the same currency, it also prints a `TOTAL` (`total` in JSON).
- **Range:** the default is `--days 28`, which ends today. `--days 1` means today only. Today may be
  partial.
- **`--type revenue`** (default): gross revenue.
- **`--type net`:** revenue net of taxes.
- **`--type proceeds`:** what the developer keeps after taxes and store commission. Use it for "how much
  did I earn".

### `rcat chart <name> [options]`
Fetches the data series of one RevenueCat chart for each account.
- `--from` / `--to` (YYYY-MM-DD): the window.
- `--resolution <id>`: the granularity. **Resolution ids are opaque numbers.** Look them up with
  `chart-options`, which prints them as `0=day, 1=week, 2=month, …`. They are usually `0`=day, `1`=week,
  `2`=month, `3`=quarter and `4`=year, but verify.
- `--segment <id>`: split the series, for example by `country`, `store`, `product_id` or `platform`.
- `--filter '<json array>'`: e.g. `'[{"name":"country","values":["US","CZ"]}]'`. Restrict to one app with
  `'[{"name":"app_id","values":["app1a2b3c4d5e"]}]'`; the id keeps its `app` prefix.
- `--selector '<json object>'`: e.g. `'{"revenue_type":"proceeds"}'`.
- `--aggregate average,total`: return only the summary. `values` comes back empty.
- `--no-realtime`: use the older (v2) chart engine. Realtime-only charts need the default.

In text mode `rcat` prints a date/value table. If a chart has an unusual shape, it falls back to
pretty JSON. With `--json` the raw RevenueCat `ChartData` is in `results[].data`:
- `values`: the series.
- `summary`: totals and averages.
- `segments` and `measures`: describe the series.
- `yaxis` / `yaxis_currency`: the unit.
- `start_date` / `end_date`: epoch milliseconds.

**Cohort charts** (`cohort_explorer`, `subscription_retention`, …) return `{cohort, period, value}`.
`period` indexes `periods`, and `periods[0]` is the cohort size.

### `rcat chart-options <name>`
Lists what a chart accepts: resolutions, segments, filters with their allowed values, and selectors. Text
mode prints `id=name` wherever the name says more than the id, e.g. `resolutions: 0=day, 1=week, 2=month`.
With `--json`, `results[].options` has the full lists (`id`, `display_name`). Run it before building `--resolution`, `--segment`, `--filter` or `--selector`; never guess
ids.

### `rcat charts`
Lists every chart name. It is offline and makes no request. Names:
- **Subscriptions and revenue:** `actives`, `actives_movement`, `actives_new`, `arr`, `churn`, `mrr`,
  `mrr_movement`, `revenue`, `refund_rate`, `refund_request`, `refunds`,
  `non-subscription_purchases`, `subscription_status`, `subscription_retention`
- **Customers and trials:** `customers_new`, `customers_active`, `conversion_to_paying`,
  `initial_conversion`, `trials`, `trials_movement`, `trials_new`, `trial_conversion`,
  `trial_conversion_rate`, `trial_cancellation`
- **Cohorts and LTV:** `cohort_explorer`, `prediction_explorer`, `ltv_per_customer`,
  `ltv_per_paying_customer`
- **Ads:** `ad_revenue`, `ad_impressions`, `ad_clicks`, `ad_monetized_customers`, `ad_arpdau`,
  `ad_rpm`, `ad_fill_rate`, `ad_ctr`
- **Paywalls:** `paywall_encounter`, `paywall_conversion`, `paywall_ltv`, `paywall_abandonment`
- **Other:** `app_store_save_outcomes`

### Currency
`--currency` accepts USD, EUR, GBP, AUD, CAD, JPY, BRL, KRW, CNY, MXN, SEK, PLN, NZD and CHF. Without it
`rcat` sends no currency and RevenueCat picks one (USD for secret keys). Always read the `currency` field
from the result, and pass the same `--currency` for every account if you want a `TOTAL`.

## Recipes

| Question | Command |
|---|---|
| How are my apps doing? | `rcat overview` |
| Which variable is which app? | `rcat accounts` |
| How much did I earn last month? | `rcat revenue --from 2026-09-01 --to 2026-09-30 --type proceeds` |
| Revenue of one app this week | `rcat revenue -a REVENUECAT_MYAPP_APIKEY --days 7` |
| MRR trend by month | `rcat chart-options mrr -a VAR` → `rcat chart mrr -a VAR --from 2026-01-01 --resolution <month id>` |
| Revenue by country | `rcat chart revenue -a VAR --segment country --from … --to …` |
| Trial conversion | `rcat chart trial_conversion_rate -a VAR --from … --to …` |
| Everything in EUR | add `--currency EUR` |

To compare apps, run one command across all accounts and compare `results[]`. Do not run one command
per app.

## Output and errors

`--json` always prints exactly one line. `charts` prints `{"charts":[…]}`; every other command prints
`results`, one entry per account. Only `revenue` can add a top-level `total`:

```json
{"results":[{"account":"REVENUECAT_MYAPP_APIKEY","ok":true,"project":{"id":"proj…","name":"My App"}, …},
            {"account":"REVENUECAT_OTHERAPP_APIKEY","ok":false,"error":{"code":"E_…","message":"…","hint":"…"}}],
 "total":{"currency":"USD","value":123.45}}
```

What each command adds per result:
- **`overview`:** `currency` and `metrics[]` (`id`, `name`, `unit`, `period`, `value`).
- **`revenue`:** `start_date`, `end_date`, `currency`, `revenue_type` and `value`, plus the top-level
  `total`.
- **`chart`:** `chart` and `data`.
- **`chart-options`:** `chart` and `options`.
- **`accounts`:** `project_id` and `project_name` instead of `project`.

**Exit codes:**
- `0`: everything succeeded.
- `1`: any failure, including a **partial** failure. In a partial failure the results of the other
  accounts are still printed, so read every `results[]` entry and report the failed ones. Do not discard
  the good data.

If the whole command fails (bad argument, no accounts), it prints
`{"error":{"code","message","hint"}}` with `--json`, or `error: …` on stderr without it. **Read and
follow the `hint`.**

| Code | Meaning / what to do |
|---|---|
| `E_NO_ACCOUNTS` | No `REVENUECAT_*_APIKEY` variable is set. Tell the user; do not try to find keys yourself. |
| `E_UNKNOWN_ACCOUNT` | The named variable is unset or empty. Check its spelling with `rcat accounts`. |
| `E_AMBIGUOUS_PROJECT` | The key sees several projects. The message lists them; rerun with `-a VAR --project-id <id>`. |
| `E_BAD_ARGUMENT` | `rcat` rejected a date, currency, chart name, JSON or option before sending anything. Fix it as the message says. |
| `E_BAD_REQUEST` (400) | RevenueCat rejected a parameter, e.g. an unknown `--resolution`, `--segment` or filter. Check the values with `chart-options`. |
| `E_UNAUTHORIZED` (401) | The key is invalid or revoked. Tell the user. |
| `E_FORBIDDEN` (403) | The key lacks a permission. During project lookup (the hint mentions `--project-id`), rerun with `-a VAR --project-id <id>` if you know the id (`rcat accounts` from an earlier run, or ask the user). Otherwise tell the user which permission is missing, if the message names it. |
| `E_NOT_FOUND` (404) | If the key "sees no projects", use `--project-id` as for `E_FORBIDDEN`. With "App not found or not accessible", the key is probably missing Charts & Metrics read permission. Tell the user to enable it on the v2 key in the RevenueCat dashboard. `overview` usually still works, so fall back to it. |
| `E_RATE_LIMITED` | Over 25 requests/minute for a project. `rcat` already retried; wait a minute before the next call. |
| `E_NETWORK` / `E_API` | A network or RevenueCat server problem. Retry once later. |
| `E_UNEXPECTED` | A bug in `rcat`. Report the message to the user; do not retry in a loop. |

## Etiquette

- Keep the number of calls low (25/min per project). One `overview` or one multi-account `revenue` call
  is usually enough. Do not loop `chart` calls day by day; use a range and `--resolution`.
- Report money with its currency and the exact range and revenue type (gross, net or proceeds). Say
  when a range includes today and may be partial.
- Values are what RevenueCat reports. Do not invent numbers for accounts that failed; say they failed
  and why.
