# rcat

**Read RevenueCat analytics for all your apps from the command line.**

`rcat` is a small, read-only CLI for the [RevenueCat API v2](https://www.revenuecat.com/docs/api-v2). It shows
overview metrics, revenue for any period and any RevenueCat chart (MRR, ARR, churn, trials, conversion,
retention, LTV, refunds, paywalls, ads…). It does this for **several RevenueCat projects at once**, even though
RevenueCat issues a separate API key for every project.

It is built for people and for coding agents. Every command can print a single line of JSON. Errors are
machine-readable and carry a hint. An agent skill for Claude Code and Codex comes in the box.

```text
$ rcat overview
REVENUECAT_MYAPP_APIKEY (My App)
  Active Trials: 3 [current]
  Active Subscriptions: 42 [current]
  MRR: 180.00 USD [last 28 days]
  Revenue: 215.00 USD [last 28 days]
  New Customers: 310 [last 28 days]
  Active Users: 1250 [last 28 days]
REVENUECAT_OTHERAPP_APIKEY (Other App)
  ...
```

## Features

- **Many projects in one command.** Each project is an environment variable that holds its key. Results come
  back per project, with a total across projects where that makes sense.
- **The whole Charts & Metrics API.** It covers the overview, revenue (gross, net of taxes or proceeds) and all
  41 charts, with resolution, segments, filters and selectors.
- **Read-only.** It only sends `GET` requests and never changes anything in RevenueCat.
- **Safe with secrets.** API keys are never printed, logged or cached. They are redacted even from error
  messages that echo your input.
- **Scriptable.** `--json` on every command, stable error codes and a meaningful exit code.
- **Agent-ready.** It ships a detailed [`SKILL.md`](skills/rcat/SKILL.md) for Claude Code, Codex and other agents
  that follow the skills convention.
- **Small.** Node.js 22.13 or newer and a single runtime dependency, [commander](https://github.com/tj/commander.js).

## Requirements

- Node.js **22.13** or newer
- A RevenueCat **v2 secret API key** for each project you want to read (see below)
- macOS or Linux. Windows works when you run `node bin/rcat.mjs` directly; `install.sh` is a POSIX shell script.

## Installation

```sh
git clone https://github.com/pykaso/rcat-cli.git
cd rcat-cli
./install.sh
```

`install.sh` does three things:

1. If `dist/` is missing, it builds the CLI with `npm ci && npm run build`.
2. It links `rcat` into `~/.local/bin`. Choose another directory with `BIN_DIR=/usr/local/bin ./install.sh`.
3. It links the agent skill into the skills folder of every agent it finds in your home directory:
   `~/.claude/skills/rcat`, `~/.codex/skills/rcat` and `~/.agents/skills/rcat`.

Both are **symlinks into the checkout**. The installer never overwrites anything else: if a real file or
directory, or a link to a different checkout, is already at one of those paths, it is skipped with a message
and the script exits with 1. Running it again is safe. Updating is only:

```sh
git pull && npm run build
```

To remove the links again (only links that point to this checkout are removed):

```sh
./install.sh --uninstall
```

If `~/.local/bin` is not on your `PATH`, the installer tells you. Add it, or run `bin/rcat.mjs` directly.

<details>
<summary>Manual installation</summary>

```sh
npm ci
npm run build
node bin/rcat.mjs --help   # run it in place
npm link                   # or put `rcat` on your PATH through npm
```

</details>

## Setting up RevenueCat API keys

RevenueCat API v2 keys belong to a single project. For each app:

1. In the RevenueCat dashboard, open the project, then **Project settings → API keys**.
2. Create a **secret API key**, version **v2**.
3. Give it read access to:
   - **Charts & Metrics**: `charts_metrics:overview:read` and `charts_metrics:charts:read`
   - **Project configuration**: `project_configuration:projects:read`. This lets `rcat` find the project id by
     itself. Without it, pass `--project-id`.
4. Export the key under a name of the form `REVENUECAT_<APP>_APIKEY`. For example, in `~/.zshrc`:

   ```sh
   export REVENUECAT_MYAPP_APIKEY=sk_...
   export REVENUECAT_OTHERAPP_APIKEY=sk_...
   ```

5. Check the setup with `rcat accounts`:

   ```text
   $ rcat accounts
   REVENUECAT_MYAPP_APIKEY     proj1a2b3c4d  My App
   REVENUECAT_OTHERAPP_APIKEY  proj5e6f7a8b  Other App
   ```

Treat secret keys like passwords. Keep them out of your shell history, out of git and out of any agent
conversation. `rcat` only ever reads them from the environment.

## Accounts

An **account** is an environment variable holding a key. It is always identified by its **full variable name**;
nothing is derived, lowercased or completed.

- **Default set (no `-a`).** Every non-empty variable matching `REVENUECAT_*_APIKEY` is used. If `RCAT_ACCOUNTS`
  is set, its comma-separated list of variable names replaces that pattern.
- **Choosing accounts.** `-a, --account <ENV_VAR...>` selects variables explicitly, for example
  `-a REVENUECAT_MYAPP_APIKEY REVENUECAT_OTHERAPP_APIKEY`. Any variable name works. A variable that is unset or
  empty fails just that account with `E_UNKNOWN_ACCOUNT`; the other accounts still run.
- **`-a` takes several values.** Put a positional argument, such as the chart name, *before* it:
  `rcat chart mrr -a VAR`, not `rcat chart -a VAR mrr`.
- **Finding the project.** The project is looked up with `GET /projects`. If the key sees exactly one project,
  that project is used. If it sees several (`E_AMBIGUOUS_PROJECT`), or the key cannot list projects
  (`E_FORBIDDEN`), pass `-a <VAR> --project-id <id>`. `--project-id` is allowed only with exactly one account.
- **Cache.** The resolved `{id, name}` is cached in `~/.rcat-cli/projects.json`, or under `$RCAT_CLI_HOME` if
  set. Entries are keyed by the variable name and a short SHA-256 fingerprint of the key, so a rotated key is
  looked up again. The cache never contains a key, and a cache that cannot be written is ignored.

## Usage

```text
rcat accounts                 variable, project id and project name for each account
rcat overview                 MRR, active subscriptions and trials, revenue, new customers, active users
rcat revenue                  revenue for a period, with a total across accounts
rcat chart <name>             data of one RevenueCat chart
rcat chart-options <name>     resolutions, segments, filters and selectors a chart supports
rcat charts                   all chart names (offline)
```

Every command takes `--json`. Every command except `charts` takes `-a/--account` and `--project-id`.
`rcat <command> --help` lists all options.

### `overview`

```sh
rcat overview [--currency EUR]
```

Active Trials and Active Subscriptions are current values. MRR, Revenue, New Customers and Active Users cover
the last 28 days.

### `revenue`

```sh
rcat revenue [--days N | --from YYYY-MM-DD --to YYYY-MM-DD] [--type revenue|net|proceeds] [--currency CODE]
```

- **Dates** are inclusive. The default is `--days 28`, which ends today (`--days 1` is today only). The most
  recent day may be incomplete.
- **`--type`** chooses what is counted:
  - `revenue` (default): gross revenue.
  - `net`: revenue net of taxes.
  - `proceeds`: revenue after taxes and the store's commission.
- **Total.** When there are two or more accounts, all succeeded and all report the same currency, a `TOTAL`
  line (`total` in JSON) sums them.

### `chart`

```sh
rcat chart <name> [--from D] [--to D] [--resolution ID] [--segment ID] \
  [--filter JSON_ARRAY] [--selector JSON_OBJECT] [--aggregate average,total] [--no-realtime]
```

- **`--resolution`** ids are numeric. They are usually `0` day, `1` week, `2` month, `3` quarter and `4` year,
  but take them from `chart-options`, which prints them as `resolutions: 0=day, 1=week, 2=month, …`.
- **`--segment`** splits the series, for example by `country`, `store`, `platform` or `product_id`.
- **`--filter`** narrows the data, for example `'[{"name":"country","values":["US","DE"]}]'`. To restrict to
  one app, use `'[{"name":"app_id","values":["app1a2b3c4d5e"]}]'`.
- **`--selector`** sets chart selectors, for example `'{"revenue_type":"proceeds"}'`.
- **`--aggregate`** returns only the summary (`average`, `total` or both).
- **`--no-realtime`** uses RevenueCat's older (v2) chart engine. Charts that exist only in realtime need the
  default.

In text mode a time series prints as date and value rows. Any other shape prints as pretty JSON. With `--json`
you get RevenueCat's `ChartData` untouched in `results[].data`.

Chart names (`rcat charts`):

| Group | Charts |
|---|---|
| Subscriptions and revenue | `actives` `actives_movement` `actives_new` `arr` `churn` `mrr` `mrr_movement` `revenue` `refund_rate` `refund_request` `refunds` `non-subscription_purchases` `subscription_status` `subscription_retention` |
| Customers and trials | `customers_new` `customers_active` `conversion_to_paying` `initial_conversion` `trials` `trials_movement` `trials_new` `trial_conversion` `trial_conversion_rate` `trial_cancellation` |
| Cohorts and LTV | `cohort_explorer` `prediction_explorer` `ltv_per_customer` `ltv_per_paying_customer` |
| Ads | `ad_revenue` `ad_impressions` `ad_clicks` `ad_monetized_customers` `ad_arpdau` `ad_rpm` `ad_fill_rate` `ad_ctr` |
| Paywalls | `paywall_encounter` `paywall_conversion` `paywall_ltv` `paywall_abandonment` |
| Other | `app_store_save_outcomes` |

### Currencies

`--currency` accepts `USD`, `EUR`, `GBP`, `AUD`, `CAD`, `JPY`, `BRL`, `KRW`, `CNY`, `MXN`, `SEK`,
`PLN`, `NZD` and `CHF`. Without it no currency is sent and RevenueCat chooses one (USD for secret keys); the
`currency` field of each result says which.

### Examples

```sh
rcat overview --currency EUR                                         # all apps, in euros
rcat revenue --from 2026-09-01 --to 2026-09-30 --type proceeds       # what you earned in September
rcat revenue -a REVENUECAT_MYAPP_APIKEY --days 7 --json              # one app, last 7 days, as JSON
rcat chart-options mrr -a REVENUECAT_MYAPP_APIKEY                    # which resolutions/segments exist
rcat chart mrr -a REVENUECAT_MYAPP_APIKEY --from 2026-01-01 --resolution 2   # MRR by month
rcat chart revenue -a REVENUECAT_MYAPP_APIKEY --segment country --from 2026-09-01 --to 2026-09-30
```

## Use with AI agents

[`skills/rcat/SKILL.md`](skills/rcat/SKILL.md) teaches a coding agent to use `rcat`. It covers:

- picking accounts
- every command and option
- recipes for common questions
- the JSON shapes
- what to do for each error code
- keeping the number of API calls low

The skill tells the agent never to print or ask for API keys.

### Claude Code

`./install.sh` links the skill to `~/.claude/skills/rcat`. Claude Code picks it up in new sessions and uses it
when you ask things like *"how much did my apps earn last month?"* or *"show MRR for My App by month"*.

To install by hand:

```sh
mkdir -p ~/.claude/skills && ln -sfn "$PWD/skills/rcat" ~/.claude/skills/rcat
```

### Codex

`./install.sh` links the skill to `~/.codex/skills/rcat`. To install by hand:

```sh
mkdir -p ~/.codex/skills && ln -sfn "$PWD/skills/rcat" ~/.codex/skills/rcat
```

### Other agents

For any agent that reads `SKILL.md` files from `~/.agents/skills`, `install.sh` links it there if that folder's
parent `~/.agents` exists. Otherwise, point your agent at `skills/rcat/SKILL.md` or paste the file into its
instructions.

The agent's environment must have the `REVENUECAT_*_APIKEY` variables, and `rcat` must be on its `PATH`.

## Output and errors

With `--json`, stdout is always **one line of JSON**. `charts` prints `{"charts":[…]}`; every other command
returns `results`, one entry per account (only `revenue` adds a top-level `total`):

```json
{"results":[
  {"account":"REVENUECAT_MYAPP_APIKEY","ok":true,"project":{"id":"proj1a2b3c4d","name":"My App"},"currency":"USD","value":215.0, "...": "..."},
  {"account":"REVENUECAT_OTHERAPP_APIKEY","ok":false,"error":{"code":"E_FORBIDDEN","message":"...","hint":"..."}}
],"total":{"currency":"USD","value":215.0}}
```

The fields in each successful entry depend on the command:

| Command | Fields |
|---|---|
| `overview` | `currency`, `metrics[]` (`id`, `name`, `unit`, `period`, `value`, …) |
| `revenue` | `start_date`, `end_date`, `currency`, `revenue_type`, `value`; `total` at the top level |
| `chart` | `chart`, `data` (RevenueCat `ChartData`) |
| `chart-options` | `chart`, `options` |
| `accounts` | `project_id` and `project_name`, in place of `project` |

**Partial failures.** When one account fails, the other accounts are still printed and the exit code is 1.

**Whole-command failures.** When the whole command fails, it prints `{"error":{"code","message","hint"}}` on
stdout with `--json`. Without `--json` it prints `error: <message>` and the hint on stderr.

| Code | Meaning |
|---|---|
| `E_NO_ACCOUNTS` | No `REVENUECAT_*_APIKEY` variable (or `RCAT_ACCOUNTS` entry) is set |
| `E_UNKNOWN_ACCOUNT` | A named variable is unset or empty |
| `E_AMBIGUOUS_PROJECT` | The key sees several projects; use `--project-id` |
| `E_BAD_ARGUMENT` | Invalid option, date, currency, chart name or JSON |
| `E_BAD_REQUEST` | RevenueCat rejected the request (400) |
| `E_UNAUTHORIZED` | The key is invalid or revoked (401) |
| `E_FORBIDDEN` | The key lacks a permission (403) |
| `E_NOT_FOUND` | Not found or not accessible (404), see [Troubleshooting](#troubleshooting) |
| `E_RATE_LIMITED` | Still rate limited after retries (429) |
| `E_NETWORK` | The API could not be reached |
| `E_API` | Another RevenueCat error (5xx, …) |
| `E_UNEXPECTED` | A bug in `rcat`; please [open an issue](https://github.com/pykaso/rcat-cli/issues) |

**Exit codes.** `0` means everything succeeded. `1` means any error, including a partial failure.

## Rate limits

RevenueCat allows **25 requests per minute per project** for Charts & Metrics. `rcat` sends one account's
requests one after another and runs different accounts in parallel. On HTTP 429 it waits as long as
`Retry-After` says, at most 60 s per wait and up to 3 retries. After that it reports `E_RATE_LIMITED`.

## Configuration

| Variable | Purpose |
|---|---|
| `REVENUECAT_<APP>_APIKEY` | A project's v2 secret key; every one that is set is an account by default |
| `RCAT_ACCOUNTS` | Comma-separated variable names to use instead of the pattern above |
| `RCAT_CLI_HOME` | Directory for the project cache (default `~/.rcat-cli`) |
| `RCAT_API_BASE` | API base URL (default `https://api.revenuecat.com/v2`); used by the tests |

## Security and privacy

- `rcat` reads keys only from the environment and sends them only as the `Authorization: Bearer` header to the
  API base URL.
- Keys are never written to stdout, stderr or disk. Any output that would contain a known key, for example an
  error echoing a mistyped argument, shows `[redacted]` instead.
- The cache file holds project ids and names only, with permissions `0600`.
- No telemetry. The only network calls go to the RevenueCat API.

If you find a security problem, please report it privately through
[GitHub security advisories](https://github.com/pykaso/rcat-cli/security/advisories/new) rather than in a
public issue.

## Troubleshooting

**`E_NOT_FOUND` "App not found or not accessible" on `revenue` or `chart`, while `overview` works.**
RevenueCat refused chart or revenue data for this key. Check that the v2 secret key has the Charts & Metrics
read permissions (`charts_metrics:charts:read`, `charts_metrics:overview:read`) and access to the project's
apps. You may need to create a new key with these permissions.

**`E_AMBIGUOUS_PROJECT`, or `E_FORBIDDEN` while looking up the project.** Pass `-a <VAR> --project-id <id>`. The
project id is in the RevenueCat dashboard URL (`proj…`).

**`E_NO_ACCOUNTS`.** No `REVENUECAT_*_APIKEY` variable is visible to the process. Remember that variables
exported in `~/.zshrc` only reach new shells. An agent or GUI app may need them set in its own environment.

**`rcat: command not found`.** Make sure `~/.local/bin` (or your `BIN_DIR`) is on your `PATH`, or run
`node bin/rcat.mjs`.

**Wrong or stale project name.** Delete `~/.rcat-cli/projects.json`; it is rebuilt on the next run.

## Development

```sh
npm ci
npm run build       # tsc → dist/
npm run dev         # tsc --watch
npm run typecheck
npm test            # build, then node:test suites against a local fake server
```

The tests never call the real API. They start a local HTTP server, point `RCAT_API_BASE` at it and run the CLI
in a child process with a clean environment, so your real keys never reach them.

```text
bin/rcat.mjs          executable shim, imports dist/cli.js
src/cli.ts            entry point: commander setup, output redaction, JSON parse errors
src/cli/commands.ts   the commands
src/cli/format.ts     text rendering
src/cli/output.ts     printing results and errors
src/core/accounts.ts  accounts, project lookup and cache, key redaction
src/core/client.ts    HTTP client, error mapping, 429 retries
src/core/constants.ts chart names, currencies, revenue types
skills/rcat/SKILL.md  agent skill
install.sh            installer for the CLI and the skill
```

## Contributing

Issues and pull requests are welcome. Please run `npm test` before you open a pull request, add a test for new
behaviour, and keep the CLI read-only and dependency-light. Never commit real keys or real project data; the
tests use invented values only.

## License

[MIT](LICENSE) © 2026 Lukáš Gergel

*RevenueCat is a trademark of RevenueCat, Inc. This project is not affiliated with or endorsed by RevenueCat.*
