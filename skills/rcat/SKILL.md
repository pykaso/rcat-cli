---
name: rcat
description: Read RevenueCat analytics (overview metrics, revenue for a period, any chart such as MRR, churn or trials) for one or several RevenueCat projects with the `rcat` CLI. Use when asked about subscription revenue, MRR, active subscribers, churn, trials or other RevenueCat numbers for the user's apps.
---

# Reading RevenueCat with `rcat`

Read-only. Needs Node 22.13+. Use `rcat` if on the PATH, else `node bin/rcat.mjs` from the checkout
(`../../bin/rcat.mjs` relative to this file). Never print or ask for API keys.

## Accounts

An account is the full name of an environment variable holding a project's key, e.g. `REVENUECAT_OTHERAPP_APIKEY`.
Without `-a` all set `REVENUECAT_*_APIKEY` variables are used (or those listed in `RCAT_ACCOUNTS`).
`rcat accounts` shows them with their project. Select with `-a VAR [VAR...]` (put positional args first).
If a key sees several projects or cannot list them, use `-a VAR --project-id <id>`.

## Commands (add `--json` for machine output)

- `rcat overview [-a VAR...] [--currency EUR]`
- `rcat revenue [-a VAR...] [--days 28 | --from YYYY-MM-DD --to YYYY-MM-DD] [--type revenue|net|proceeds] [--currency X]`
- `rcat chart <name> [-a VAR...] [--from] [--to] [--resolution] [--segment] [--filter <json>] [--selector <json>] [--aggregate average,total] [--no-realtime]`
- `rcat chart-options <name>` lists valid resolutions/segments/filters; `rcat charts` lists chart names.

## Output and errors

`--json` prints one line: `{"results":[{"account":VAR,"ok":true,...}|{"account":VAR,"ok":false,"error":{code,message,hint}}]}`.
A failure of the whole command is `{"error":{code,message,hint}}` on stdout. Exit code 1 on any error, including
a partial failure (the other accounts' results are still printed). Follow the `hint`. Codes include
`E_NO_ACCOUNTS`, `E_UNKNOWN_ACCOUNT`, `E_AMBIGUOUS_PROJECT`, `E_BAD_ARGUMENT`, `E_UNAUTHORIZED`, `E_FORBIDDEN`,
`E_RATE_LIMITED` (25 requests/min per project; the CLI retries 429 itself).
