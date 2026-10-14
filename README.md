# rcat

Read RevenueCat analytics across several RevenueCat projects from the command line. Read-only, `--json` everywhere, Node >= 22.13, one runtime dependency (commander).

```sh
npm install && npm run build
node bin/rcat.mjs --help      # or `npm link` and use `rcat`
```

## Accounts

RevenueCat API v2 keys are per project. An account is an environment variable holding a key, and it is
always identified by its **full variable name**: nothing is derived, lowercased or completed.

- Default set (no `-a`): every non-empty variable matching `REVENUECAT_*_APIKEY` (for example
  `REVENUECAT_MYAPP_APIKEY`, `REVENUECAT_OTHERAPP_APIKEY`). If `RCAT_ACCOUNTS` is set it is a comma-separated
  list of variable names that replaces this pattern.
- `-a, --account <ENV_VAR...>` selects variables explicitly, e.g. `-a REVENUECAT_OTHERAPP_APIKEY REVENUECAT_THIRDAPP_APIKEY`.
  Any variable name works. A variable that is unset or empty is `E_UNKNOWN_ACCOUNT` and the message names it.
- The project is looked up with `GET /projects`; if the key sees exactly one project it is used. With several
  (`E_AMBIGUOUS_PROJECT`) or without the `project_configuration:projects:read` permission (`E_FORBIDDEN`), pass
  `-a <VAR> --project-id <id>`. `--project-id` is only allowed with exactly one account.
- The resolved `{id, name}` is cached in `$RCAT_CLI_HOME/projects.json` (default `~/.rcat-cli`), keyed by the
  variable name and a short fingerprint of the key, so a rotated key resolves again. A cache that cannot be
  written is ignored. Keys themselves are never printed, logged or cached.

## Usage

```sh
rcat accounts                                   # variable, project id and name for each account
rcat overview [-a VAR...] [--currency EUR]      # MRR, active subscriptions, ...
rcat revenue [--from 2026-01-01 --to 2026-01-31 | --days 28] [--type revenue|net|proceeds] [--currency USD]
rcat chart mrr [--from D] [--to D] [--resolution month] [--segment country] \
  [--filter '[{"id":"platform","value":"ios"}]'] [--selector '{"k":"v"}'] [--aggregate average,total] [--no-realtime]
rcat chart-options mrr                          # resolutions, segments, filters, selectors
rcat charts                                     # known chart names (offline)
```

Every command takes `--json`. `-a` is variadic: put the chart name before it (`rcat chart mrr -a VAR`).
`revenue` adds a TOTAL line (and a `total` field) when every account answered in the same currency.
Dates are inclusive `YYYY-MM-DD`; `--days N` (default 28) ends today.

Examples:

```sh
rcat overview
rcat revenue -a REVENUECAT_OTHERAPP_APIKEY --days 7 --type net --json
rcat chart mrr -a REVENUECAT_THIRDAPP_APIKEY --from 2026-01-01 --resolution month
```

Multi-account results are `{"results":[{"account":"REVENUECAT_OTHERAPP_APIKEY","ok":true,...},{"account":"...","ok":false,"error":{...}}]}`.
Chart `values` differ per chart and are passed through untouched in JSON; text mode prints date, value and
segment/measure when they look like a time series, and pretty JSON otherwise.

## JSON error convention

With `--json`, stdout is one line of JSON. A failed command prints `{"error":{"code","message","hint"}}`
on stdout; without `--json` it prints `error: <message>` and the hint on stderr. A failure of a single account
in a multi-account command is an entry `{"account","ok":false,"error":{code,message,hint}}` and the other
accounts are still printed.

Codes: `E_NO_ACCOUNTS`, `E_UNKNOWN_ACCOUNT`, `E_AMBIGUOUS_PROJECT`, `E_BAD_ARGUMENT`, `E_UNAUTHORIZED` (401),
`E_FORBIDDEN` (403), `E_NOT_FOUND` (404), `E_BAD_REQUEST` (400), `E_RATE_LIMITED`, `E_NETWORK`, `E_API`, `E_UNEXPECTED`.

## Exit codes

`0` success; `1` any error, including a partial failure (all results are still printed).

## Rate limits

Charts and metrics allow 25 requests per minute per project. Calls for one account run sequentially, different
accounts in parallel. On HTTP 429 `Retry-After` is honoured (at most 60 s per wait, up to 3 retries), then `E_RATE_LIMITED`.

## Environment

`RCAT_ACCOUNTS`, `RCAT_CLI_HOME`, `RCAT_API_BASE` (override of `https://api.revenuecat.com/v2`, used by tests).

## Tests

`npm test` builds and runs the `node:test` suites against a local fake server; the real API is never called.

## Troubleshooting

- `E_NOT_FOUND` with "App not found or not accessible" on `revenue` or `chart` (while `overview` works): RevenueCat
  refused chart/revenue data for this key. Check that the v2 secret key has the Charts & Metrics read permissions
  (`charts_metrics:charts:read`, `charts_metrics:overview:read`) and access to the project's apps.
- `E_AMBIGUOUS_PROJECT` / `E_FORBIDDEN` on project lookup: pass `-a <VAR> --project-id <id>`.
