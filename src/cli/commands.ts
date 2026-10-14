import type { Command } from 'commander';
import { DEFAULT_ACCOUNTS_HELP, forEachAccount, selectAccounts, type AccountResult } from '../core/accounts.js';
import { apiGet } from '../core/client.js';
import { CHART_NAMES, CURRENCIES, REVENUE_TYPES } from '../core/constants.js';
import { RcatError } from '../core/errors.js';
import { chartValuesText, failureText, metricValue, money, periodText } from './format.js';
import { printError, printResult, refuseSwallowedFlags } from './output.js';

const bad = (message: string, hint?: string): RcatError => new RcatError(message, { code: 'E_BAD_ARGUMENT', hint });

function currencyOption(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const upper = value.toUpperCase();
  if (!(CURRENCIES as readonly string[]).includes(upper)) throw bad(`Unknown currency "${value}".`, `Use one of: ${CURRENCIES.join(' ')}`);
  return upper;
}

function chartName(value: string): string {
  if (!(CHART_NAMES as readonly string[]).includes(value)) throw bad(`Unknown chart "${value}".`, 'Run `rcat charts` to list the chart names.');
  return value;
}

function dateOption(value: string | undefined, flag: string): string | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  if (!valid) throw bad(`${flag} must be a date as YYYY-MM-DD, got "${value}".`);
  return value;
}

function checkOrder(from: string | undefined, to: string | undefined): void {
  if (from && to && from > to) throw bad(`--from (${from}) is after --to (${to}).`);
}

function jsonOption(value: string | undefined, flag: string, kind: 'array' | 'object'): string | undefined {
  if (value === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw bad(`${flag} is not valid JSON.`, `Pass a JSON ${kind}, e.g. ${kind === 'array' ? `${flag} '[{"id":"country","value":"US"}]'` : `${flag} '{"key":"value"}'`}`);
  }
  const ok = kind === 'array' ? Array.isArray(parsed) : parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  if (!ok) throw bad(`${flag} must be a JSON ${kind}.`);
  return value;
}

const localDate = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** `--from/--to`, or the last `--days` days (default 28) ending today, inclusive. */
function revenueRange(opts: Record<string, any>): { from: string; to: string } {
  const from = dateOption(opts.from, '--from');
  const to = dateOption(opts.to, '--to');
  if (from || to) {
    if (opts.days !== undefined) throw bad('--days cannot be combined with --from/--to.');
    if (!from || !to) throw bad('--from and --to must be given together.');
    checkOrder(from, to);
    return { from, to };
  }
  const text = opts.days ?? '28';
  if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > 3650) throw bad(`--days must be a whole number from 1 to 3650, got "${text}".`);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (Number(text) - 1));
  return { from: localDate(start), to: localDate(today) };
}

/** Runs an action; any failure is reported the way the command asks for (`--json`) and sets exit code 1. */
function guarded(fn: (...args: any[]) => Promise<void> | void) {
  return async (...args: any[]): Promise<void> => {
    const command = args[args.length - 1] as Command;
    try {
      refuseSwallowedFlags(command);
      await fn(...args);
    } catch (error) {
      printError(error, { json: Boolean(command.opts().json) });
      process.exitCode = 1;
    }
  };
}

/** Prints per-account results; a failed account sets the exit code but does not hide the others. */
function report<T extends object>(results: AccountResult<T>[], json: boolean | undefined, line: (r: Extract<AccountResult<T>, { ok: true }>) => string, extra: object = {}, footer = ''): void {
  printResult({ results, ...extra }, {
    json,
    text: () =>
      results.map((r) => (r.ok ? line(r) : failureText(r))).join('\n') + footer,
  });
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

const accountOption = (command: Command): Command =>
  command
    .option('-a, --account <ENV_VAR...>', `full name(s) of the environment variable(s) holding the key (default: ${DEFAULT_ACCOUNTS_HELP})`)
    .option('--project-id <id>', 'project id to use, skipping lookup (exactly one account)')
    .option('--json', 'print the result as JSON');

export function registerCommands(program: Command): void {
  accountOption(program.command('accounts').description('List the accounts found in the environment and their projects')).action(
    guarded(async (opts: Record<string, any>) => {
      const accounts = selectAccounts(opts.account, opts.projectId);
      const results = await forEachAccount(accounts, async (account, project) => ({ project_id: project.id, project_name: project.name }));
      report(results, opts.json, (r) => `${r.account}  ${r.project_id}  ${r.project_name ?? '-'}`);
    }),
  );

  accountOption(program.command('overview').description('Overview metrics (MRR, active subscriptions, ...) per account'))
    .option('--currency <code>', 'currency of monetary values')
    .action(
      guarded(async (opts: Record<string, any>) => {
        const currency = currencyOption(opts.currency);
        const results = await forEachAccount(selectAccounts(opts.account, opts.projectId), async (account, project) => {
          const data = await apiGet(account.apiKey, `/projects/${encodeURIComponent(project.id)}/metrics/overview`, { currency });
          return { project, currency: data.currency ?? currency ?? null, metrics: data.metrics ?? [] };
        });
        report(results, opts.json, (r) =>
          [`${r.account} (${r.project.name ?? r.project.id})`, ...r.metrics.map((m: any) => `  ${m.name}: ${metricValue(m, r.currency ?? '')} [${periodText(m.period)}]`)].join('\n'),
        );
      }),
    );

  accountOption(program.command('revenue').description('Revenue for a period per account, with a total across accounts'))
    .option('--from <YYYY-MM-DD>', 'first day (inclusive)')
    .option('--to <YYYY-MM-DD>', 'last day (inclusive)')
    .option('--days <n>', 'the last n days ending today (default: 28)')
    .option('--type <type>', 'revenue | net | proceeds (default: revenue)')
    .option('--currency <code>', 'currency')
    .action(
      guarded(async (opts: Record<string, any>) => {
        const range = revenueRange(opts);
        const type = opts.type ?? 'revenue';
        if (!(type in REVENUE_TYPES)) throw bad(`--type must be one of: ${Object.keys(REVENUE_TYPES).join(', ')}; got "${type}".`);
        const currency = currencyOption(opts.currency);
        const results = await forEachAccount(selectAccounts(opts.account, opts.projectId), async (account, project) => {
          const data = await apiGet(account.apiKey, `/projects/${encodeURIComponent(project.id)}/metrics/revenue`, {
            start_date: range.from,
            end_date: range.to,
            currency,
            revenue_type: REVENUE_TYPES[type],
          });
          return { project, start_date: data.start_date ?? range.from, end_date: data.end_date ?? range.to, currency: data.currency ?? currency ?? null, revenue_type: data.revenue_type ?? REVENUE_TYPES[type], value: data.value };
        });
        // A total only means something when every account answered in the same currency.
        const oks = results.filter((r): r is Extract<typeof r, { ok: true }> => r.ok);
        const sameCurrency = oks.length === results.length && oks.length > 1 && oks.every((r) => r.currency && r.currency === oks[0]!.currency && typeof r.value === 'number');
        const total = sameCurrency ? { currency: oks[0]!.currency as string, value: oks.reduce((sum, r) => sum + (r.value as number), 0) } : undefined;
        report(
          results,
          opts.json,
          (r) => `${r.account} (${r.project.name ?? r.project.id}): ${typeof r.value === 'number' ? money(r.value, r.currency ?? '') : '-'} (${r.revenue_type}, ${r.start_date}..${r.end_date})`,
          total ? { total } : {},
          total ? `\nTOTAL: ${money(total.value, total.currency)}` : '',
        );
      }),
    );

  accountOption(program.command('chart').description('Data of a chart per account (see `rcat charts`)'))
    .argument('<name>', 'chart name')
    .option('--from <YYYY-MM-DD>', 'start date')
    .option('--to <YYYY-MM-DD>', 'end date')
    .option('--resolution <id>', 'resolution (see chart-options)')
    .option('--segment <id>', 'segment (see chart-options)')
    .option('--filter <json>', 'filters as a JSON array')
    .option('--selector <json>', 'selectors as a JSON object')
    .option('--aggregate <list>', 'average,total')
    .option('--no-realtime', 'use the non-realtime data')
    .action(
      guarded(async (name: string, opts: Record<string, any>) => {
        chartName(name);
        const from = dateOption(opts.from, '--from');
        const to = dateOption(opts.to, '--to');
        checkOrder(from, to);
        const filters = jsonOption(opts.filter, '--filter', 'array');
        const selectors = jsonOption(opts.selector, '--selector', 'object');
        const aggregate = opts.aggregate;
        if (aggregate !== undefined && !aggregate.split(',').every((a: string) => a === 'average' || a === 'total')) throw bad(`--aggregate must be average, total or both separated by a comma; got "${aggregate}".`);
        const results = await forEachAccount(selectAccounts(opts.account, opts.projectId), async (account, project) => {
          const data = await apiGet(account.apiKey, `/projects/${encodeURIComponent(project.id)}/charts/${name}`, {
            realtime: opts.realtime,
            filters,
            selectors,
            aggregate,
            resolution: opts.resolution,
            start_date: from,
            end_date: to,
            segment: opts.segment,
          });
          return { project, chart: name, data };
        });
        report(results, opts.json, (r) => `${r.account} (${r.project.name ?? r.project.id}): ${r.data?.display_name ?? r.chart}${r.data?.resolution ? ` [${r.data.resolution}]` : ''}\n${chartValuesText(r.data)}`);
      }),
    );

  accountOption(program.command('chart-options').description('Resolutions, segments, filters and selectors a chart supports'))
    .argument('<name>', 'chart name')
    .action(
      guarded(async (name: string, opts: Record<string, any>) => {
        chartName(name);
        const results = await forEachAccount(selectAccounts(opts.account, opts.projectId), async (account, project) => {
          const data = await apiGet(account.apiKey, `/projects/${encodeURIComponent(project.id)}/charts/${name}/options`, { realtime: true });
          return { project, chart: name, options: data };
        });
        const names = (list: any): string => (Array.isArray(list) ? list.map((x: any) => x.id).join(', ') : '') || '-';
        report(results, opts.json, (r) =>
          [
            `${r.account} (${r.project.name ?? r.project.id}): ${name}`,
            `  resolutions: ${names(r.options.resolutions)}`,
            `  segments: ${names(r.options.segments)}`,
            ...(Array.isArray(r.options.filters) ? r.options.filters : []).map((f: any) => `  filter ${f.id}: ${names(f.options)}`),
            `  user_selectors: ${JSON.stringify(r.options.user_selectors ?? null)}`,
          ].join('\n'),
        );
      }),
    );

  program
    .command('charts')
    .description('List the known chart names (offline)')
    .option('--json', 'print the result as JSON')
    .action(guarded((opts: Record<string, any>) => printResult({ charts: [...CHART_NAMES] }, { json: opts.json, text: (v) => v.charts.join('\n') })));
}
