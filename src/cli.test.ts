import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('./cli.js', import.meta.url));

const KEY_ALPHA = 'sk_FAKEKEY_alpha_0123456789';
const KEY_BETA = 'sk_FAKEKEY_beta_0123456789';
const KEY_MULTI = 'sk_FAKEKEY_multi_0123456789';
const KEY_FORBID = 'sk_FAKEKEY_forbid_0123456789';
const KEY_ROTATED = 'sk_FAKEKEY_rotated_0123456789';
const ALL_KEYS = [KEY_ALPHA, KEY_BETA, KEY_MULTI, KEY_FORBID, KEY_ROTATED];

interface Seen {
  path: string;
  query: URLSearchParams;
  auth: string | undefined;
}

let server: Server;
let base = '';
let seen: Seen[] = [];
/** Per test: may answer a request itself; returning false falls through to the default fake. */
let custom: ((req: Seen, res: ServerResponse) => boolean) | undefined;

const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

function fake(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://fake');
  const entry: Seen = { path: url.pathname, query: url.searchParams, auth: req.headers.authorization };
  seen.push(entry);
  if (custom?.(entry, res)) return;
  const key = entry.auth?.replace('Bearer ', '');
  const path = url.pathname;
  if (path === '/projects') {
    if (key === KEY_FORBID) return send(res, 403, { message: 'missing permission project_configuration:projects:read' });
    if (key === KEY_BETA) return send(res, 200, { items: [{ id: 'proj_b', name: 'Beta App' }], next_page: null });
    if (key === KEY_MULTI) {
      return url.searchParams.get('starting_after') === 'proj_b1'
        ? send(res, 200, { items: [{ id: 'proj_b2', name: 'Beta Two' }], next_page: null })
        : send(res, 200, { items: [{ id: 'proj_b1', name: 'Beta One' }], next_page: '/v2/projects?limit=100&starting_after=proj_b1' });
    }
    if (key === KEY_ALPHA) return send(res, 200, { items: [{ id: 'proj_a', name: 'Alpha App' }], next_page: null });
    if (key === KEY_ROTATED) return send(res, 200, { items: [{ id: 'proj_r', name: 'Rotated' }], next_page: null });
    return send(res, 401, { message: 'bad key' });
  }
  const m = /^\/projects\/([^/]+)\/(.*)$/.exec(path);
  if (!m) return send(res, 404, { message: 'no route' });
  const [, project, rest] = m;
  if (rest === 'metrics/overview') {
    return send(res, 200, { currency: url.searchParams.get('currency') ?? 'USD', metrics: [
      { id: 'mrr', name: 'MRR', unit: '$', period: 'P28D', value: project === 'proj_a' ? 100 : 50 },
      { id: 'active_subscriptions', name: 'Active Subscriptions', unit: '#', period: 'P0D', value: 7 },
    ] });
  }
  if (rest === 'metrics/revenue') {
    return send(res, 200, { start_date: url.searchParams.get('start_date'), end_date: url.searchParams.get('end_date'), currency: url.searchParams.get('currency') ?? 'USD', revenue_type: url.searchParams.get('revenue_type'), value: project === 'proj_a' ? 10.5 : 4.25 });
  }
  if (rest === 'charts/mrr') {
    return send(res, 200, { display_name: 'MRR', resolution: 'month', segments: [{ display_name: 'Total' }], measures: [{ display_name: 'MRR' }],
      values: [{ cohort: Date.UTC(2026, 0, 1) / 1000, segment: 0, measure: 0, value: 12 }, { cohort: Date.UTC(2026, 1, 1) / 1000, measure: 0, value: 15 }] });
  }
  if (rest === 'charts/arr') return send(res, 200, { display_name: 'ARR', values: [[1, 2], [3, 4]] });
  if (rest === 'charts/mrr/options') {
    return send(res, 200, { resolutions: [{ id: 'day', display_name: 'Day' }, { id: 'month', display_name: 'Month' }], segments: [{ id: 'country', display_name: 'Country' }], filters: [{ id: 'platform', display_name: 'Platform', options: [{ id: 'ios', display_name: 'iOS' }] }], user_selectors: {} });
  }
  send(res, 404, { message: 'nothing here' });
}

before(async () => {
  server = createServer(fake);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());
beforeEach(() => {
  seen = [];
  custom = undefined;
});

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface Env {
  home: string;
  rcat(...args: string[]): Promise<Run>;
  json(...args: string[]): Promise<any>;
}

/** The environment is built from nothing: the user's own REVENUECAT_* variables never reach the child. */
function fresh(vars: Record<string, string> = {}): Env {
  const home = mkdtempSync(join(tmpdir(), 'rcat-cli-test-'));
  const env = { PATH: process.env.PATH ?? '', RCAT_CLI_HOME: home, RCAT_API_BASE: base, ...vars };
  const rcat = (...args: string[]): Promise<Run> =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cli, ...args], { env });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', reject);
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
  return { home, rcat, json: async (...args) => JSON.parse((await rcat(...args, '--json')).stdout) };
}

const A = 'REVENUECAT_ALPHA_APIKEY';
const B = 'REVENUECAT_BETA_APIKEY';
const pair = () => fresh({ REVENUECAT_ALPHA_APIKEY: KEY_ALPHA, REVENUECAT_BETA_APIKEY: KEY_BETA });
const projectCalls = () => seen.filter((s) => s.path === '/projects').length;
const noKeys = (...texts: string[]): void => {
  for (const text of texts) for (const key of ALL_KEYS) assert.ok(!text.includes(key) && !text.includes(key.slice(3)), 'key material leaked');
};

test('charts lists chart names offline, in text and JSON', async () => {
  const e = fresh();
  const text = await e.rcat('charts');
  assert.equal(text.status, 0);
  assert.ok(text.stdout.split('\n').includes('mrr'));
  const json = await e.json('charts');
  assert.ok(json.charts.includes('app_store_save_outcomes'));
  assert.equal(json.charts.length, 41);
  assert.equal(seen.length, 0);
});

test('no arguments prints help; unknown command fails', async () => {
  const e = fresh();
  assert.match((await e.rcat()).stdout + (await e.rcat()).stderr, /Usage: rcat/);
  const bad = await e.rcat('nope');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /unknown command 'nope'/);
});

test('no accounts: E_NO_ACCOUNTS naming the variable pattern; empty values are ignored', async () => {
  const e = fresh({ REVENUECAT_EMPTY_APIKEY: '' });
  const r = await e.rcat('accounts', '--json');
  assert.equal(r.status, 1);
  const err = JSON.parse(r.stdout).error;
  assert.equal(err.code, 'E_NO_ACCOUNTS');
  assert.match(err.hint, /REVENUECAT_<NAME>_APIKEY.*RCAT_ACCOUNTS/);
  const text = await e.rcat('accounts');
  assert.equal(text.stdout, '');
  assert.match(text.stderr, /^error: No RevenueCat accounts found\./);
});

test('accounts: default set is every REVENUECAT_*_APIKEY, identified by full variable name', async () => {
  const e = fresh({ REVENUECAT_ALPHA_APIKEY: KEY_ALPHA, REVENUECAT_MY_APP_APIKEY: KEY_BETA, REVENUECAT_OTHER_PROJECT_ID: 'zzz', OTHER_APIKEY: KEY_MULTI });
  const out = await e.json('accounts');
  assert.deepEqual(out.results, [
    { account: 'REVENUECAT_ALPHA_APIKEY', ok: true, project_id: 'proj_a', project_name: 'Alpha App' },
    { account: 'REVENUECAT_MY_APP_APIKEY', ok: true, project_id: 'proj_b', project_name: 'Beta App' },
  ]);
  assert.equal(seen[0]!.auth?.startsWith('Bearer sk_FAKEKEY'), true);
  const text = await e.rcat('accounts');
  assert.match(text.stdout, /REVENUECAT_ALPHA_APIKEY {2}proj_a {2}Alpha App/);
  noKeys(text.stdout, JSON.stringify(out));
  assert.match((await e.rcat('overview', '--help')).stdout, /REVENUECAT_\*_APIKEY/);
});

test('-a takes any full variable name; RCAT_ACCOUNTS replaces the default set', async () => {
  const e = fresh({ REVENUECAT_ALPHA_APIKEY: KEY_ALPHA, MY_CUSTOM_KEY: KEY_BETA, RCAT_ACCOUNTS: 'MY_CUSTOM_KEY' });
  assert.deepEqual((await e.json('accounts')).results.map((r: any) => r.account), ['MY_CUSTOM_KEY']);
  assert.deepEqual((await e.json('accounts', '-a', 'REVENUECAT_ALPHA_APIKEY', 'MY_CUSTOM_KEY')).results.map((r: any) => r.account), ['REVENUECAT_ALPHA_APIKEY', 'MY_CUSTOM_KEY']);
});

test('--project-id skips /projects and needs exactly one account', async () => {
  const e = pair();
  const out = await e.json('accounts', '-a', B, '--project-id', 'proj_x');
  assert.equal(out.results[0].project_id, 'proj_x');
  assert.equal(projectCalls(), 0);
  const two = await e.rcat('accounts', '--project-id', 'proj_x', '--json');
  assert.equal(two.status, 1);
  assert.equal(JSON.parse(two.stdout).error.code, 'E_BAD_ARGUMENT');
  assert.equal(JSON.parse((await e.rcat('accounts', '-a', A, B, '--project-id', 'x', '--json')).stdout).error.code, 'E_BAD_ARGUMENT');
});

test('unset, empty or short-name accounts are E_UNKNOWN_ACCOUNT naming the exact variable', async () => {
  const e = fresh({ REVENUECAT_ALPHA_APIKEY: KEY_ALPHA, REVENUECAT_EMPTY_APIKEY: '' });
  for (const name of ['alpha', 'REVENUECAT_EMPTY_APIKEY', 'REVENUECAT_NOPE_APIKEY']) {
    const r = await e.rcat('overview', '-a', name, '--json');
    assert.equal(r.status, 1);
    const err = JSON.parse(r.stdout).error;
    assert.equal(err.code, 'E_UNKNOWN_ACCOUNT');
    assert.ok(err.message.includes(`variable ${name} `));
  }
  assert.equal(seen.length, 0);
});

test('several projects: E_AMBIGUOUS_PROJECT across pages, hint points at --project-id', async () => {
  const e = fresh({ REVENUECAT_MULTI_APIKEY: KEY_MULTI });
  const out = await e.json('overview');
  const r = out.results[0];
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'E_AMBIGUOUS_PROJECT');
  assert.match(r.error.message, /proj_b1 \(Beta One\).*proj_b2 \(Beta Two\)/);
  assert.match(r.error.hint, /-a REVENUECAT_MULTI_APIKEY --project-id <id>/);
  assert.equal(projectCalls(), 2);
  assert.equal((await e.rcat('overview')).status, 1);
  const fixed = await e.json('overview', '-a', 'REVENUECAT_MULTI_APIKEY', '--project-id', 'proj_b2');
  assert.equal(fixed.results[0].ok, true);
});

test('403 on /projects hints at the missing permission and --project-id', async () => {
  const e = fresh({ REVENUECAT_FORBID_APIKEY: KEY_FORBID });
  const r = (await e.json('overview')).results[0];
  assert.equal(r.error.code, 'E_FORBIDDEN');
  assert.match(r.error.message, /project_configuration:projects:read/);
  assert.match(r.error.hint, /project_configuration:projects:read.*-a REVENUECAT_FORBID_APIKEY --project-id <id>/);
});

test('project resolution is cached; a rotated key resolves again; the cache holds no key', async () => {
  const e = fresh({ REVENUECAT_ALPHA_APIKEY: KEY_ALPHA });
  await e.rcat('overview');
  await e.rcat('overview');
  assert.equal(projectCalls(), 1);
  const cacheFile = join(e.home, 'projects.json');
  const cache = readFileSync(cacheFile, 'utf8');
  assert.match(cache, /proj_a/);
  noKeys(cache);

  const rotated = { ...{ PATH: process.env.PATH ?? '' }, RCAT_CLI_HOME: e.home, RCAT_API_BASE: base, REVENUECAT_ALPHA_APIKEY: KEY_ROTATED };
  const again = fresh(rotated);
  const out = await again.json('accounts');
  assert.equal(out.results[0].project_id, 'proj_r');
  assert.equal(projectCalls(), 2);
});

test('a cache that cannot be written does not fail the command', async () => {
  const e = fresh({ REVENUECAT_ALPHA_APIKEY: KEY_ALPHA, RCAT_CLI_HOME: '/dev/null/nope' });
  const r = await e.rcat('overview');
  assert.equal(r.status, 0);
});

test('overview: text and JSON, currency passed through', async () => {
  const e = pair();
  const text = await e.rcat('overview', '--currency', 'eur');
  assert.equal(text.status, 0);
  assert.match(text.stdout, /^REVENUECAT_ALPHA_APIKEY \(Alpha App\)\n {2}MRR: 100\.00 EUR \[last 28 days\]\n {2}Active Subscriptions: 7 \[current\]/);
  assert.match(text.stdout, /REVENUECAT_BETA_APIKEY \(Beta App\)/);
  assert.equal(seen.find((s) => s.path.endsWith('/metrics/overview'))!.query.get('currency'), 'EUR');
  const out = await e.json('overview', '-a', B);
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].metrics[0].id, 'mrr');
});

test('revenue: range, type mapping, TOTAL', async () => {
  const e = pair();
  const text = await e.rcat('revenue', '--from', '2026-01-01', '--to', '2026-01-31', '--type', 'net');
  assert.equal(text.status, 0);
  assert.match(text.stdout, /REVENUECAT_ALPHA_APIKEY \(Alpha App\): 10\.50 USD \(revenue_net_of_taxes, 2026-01-01\.\.2026-01-31\)/);
  assert.match(text.stdout, /\nTOTAL: 14\.75 USD$/m);
  const req = seen.find((s) => s.path.endsWith('/metrics/revenue'))!;
  assert.equal(req.query.get('revenue_type'), 'revenue_net_of_taxes');
  const out = await e.json('revenue', '--from', '2026-01-01', '--to', '2026-01-31');
  assert.deepEqual(out.total, { currency: 'USD', value: 14.75 });
});

test('revenue: default is the last 28 days ending today, inclusive', async () => {
  const e = pair();
  await e.rcat('revenue', '-a', A);
  const q = seen.find((s) => s.path.endsWith('/metrics/revenue'))!.query;
  const days = (Date.parse(q.get('end_date')!) - Date.parse(q.get('start_date')!)) / 86400000;
  assert.equal(days, 27);
  const now = new Date();
  assert.equal(q.get('end_date'), `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
  assert.ok(!(await e.rcat('revenue', '-a', A)).stdout.includes('TOTAL'));
});

test('revenue: no TOTAL when currencies differ', async () => {
  const e = pair();
  custom = (req, res) => {
    if (!req.path.endsWith('/metrics/revenue')) return false;
    send(res, 200, { start_date: 'a', end_date: 'b', currency: req.path.includes('proj_a') ? 'USD' : 'EUR', revenue_type: 'revenue', value: 1 });
    return true;
  };
  const out = await e.json('revenue');
  assert.equal(out.total, undefined);
});

test('chart: text table, JSON passthrough and query parameters', async () => {
  const e = pair();
  const text = await e.rcat('chart', 'mrr', '-a', A, '--from', '2026-01-01', '--to', '2026-02-01', '--resolution', 'month', '--segment', 'country', '--filter', '[{"id":"platform","value":"ios"}]', '--selector', '{"a":1}', '--aggregate', 'average,total', '--no-realtime');
  assert.equal(text.status, 0);
  assert.match(text.stdout, /REVENUECAT_ALPHA_APIKEY \(Alpha App\): MRR \[month\]\n {2}2026-01-01 {2}12 {2}\(Total \/ MRR\)\n {2}2026-02-01 {2}15/);
  const q = seen.find((s) => s.path.endsWith('/charts/mrr'))!.query;
  assert.equal(q.get('realtime'), 'false');
  assert.equal(q.get('filters'), '[{"id":"platform","value":"ios"}]');
  assert.equal(q.get('selectors'), '{"a":1}');
  assert.equal(q.get('aggregate'), 'average,total');
  assert.equal(q.get('resolution'), 'month');
  assert.equal(q.get('segment'), 'country');
  assert.equal(q.get('start_date'), '2026-01-01');
  const out = await e.json('chart', 'mrr', '-a', A);
  assert.equal(out.results[0].data.values.length, 2);
  assert.equal(seen.at(-1)!.query.get('realtime'), 'true');
});

test('chart: unfamiliar value shapes fall back to pretty JSON', async () => {
  const e = pair();
  const text = await e.rcat('chart', 'arr', '-a', A);
  assert.match(text.stdout, /ARR\n\[\n {2}\[\n {4}1,/);
});

test('chart-options: text and JSON', async () => {
  const e = pair();
  const text = await e.rcat('chart-options', 'mrr', '-a', A);
  assert.match(text.stdout, /resolutions: day, month\n {2}segments: country\n {2}filter platform: ios/);
  const out = await e.json('chart-options', 'mrr', '-a', A);
  assert.equal(out.results[0].options.resolutions.length, 2);
});

test('partial failure prints every result and exits 1', async () => {
  const e = pair();
  custom = (req, res) => {
    if (!req.path.includes('proj_b/')) return false;
    send(res, 404, { message: 'project gone' });
    return true;
  };
  const text = await e.rcat('overview');
  assert.equal(text.status, 1);
  assert.match(text.stdout, /REVENUECAT_ALPHA_APIKEY \(Alpha App\)/);
  assert.match(text.stdout, /REVENUECAT_BETA_APIKEY: error: Not found \(404\).*project gone.*\[E_NOT_FOUND\]/);
  const out = await e.json('overview');
  assert.deepEqual(out.results.map((r: any) => r.ok), [true, false]);
  assert.equal(out.results[1].error.code, 'E_NOT_FOUND');
});

test('429 is retried honouring Retry-After; after 3 retries E_RATE_LIMITED', async () => {
  const e = pair();
  let hits = 0;
  custom = (req, res) => {
    if (!req.path.endsWith('/metrics/overview') || !req.path.includes('proj_a')) return false;
    if (++hits <= 2) return send(res, 429, { message: 'slow down' }, { 'retry-after': '0' }), true;
    return false;
  };
  const ok = await e.json('overview', '-a', A);
  assert.equal(ok.results[0].ok, true);
  assert.equal(hits, 3);

  custom = (req, res) => {
    if (!req.path.endsWith('/metrics/overview')) return false;
    hits++;
    return send(res, 429, {}, { 'retry-after': '0' }), true;
  };
  hits = 0;
  const out = await e.json('overview', '-a', B);
  assert.equal(out.results[0].error.code, 'E_RATE_LIMITED');
  assert.equal(hits, 4);
});

test('HTTP errors map to codes with the API message; network failure is E_NETWORK', async () => {
  const e = pair();
  const cases: [number, string][] = [[401, 'E_UNAUTHORIZED'], [403, 'E_FORBIDDEN'], [400, 'E_BAD_REQUEST'], [500, 'E_API']];
  for (const [status, code] of cases) {
    custom = (req, res) => (req.path.endsWith('/metrics/overview') ? (send(res, status, { message: `msg ${status}` }), true) : false);
    const r = (await e.json('overview', '-a', B)).results[0];
    assert.equal(r.error.code, code);
    assert.match(r.error.message, new RegExp(`msg ${status}`));
  }
  const down = fresh({ REVENUECAT_BETA_APIKEY: KEY_BETA, RCAT_API_BASE: 'http://127.0.0.1:1' });
  assert.equal((await down.json('overview', '-a', B, '--project-id', 'p')).results[0].error.code, 'E_NETWORK');
});

test('argument validation happens before any request', async () => {
  const e = pair();
  const cases: string[][] = [
    ['revenue', '--from', '2026-13-01', '--to', '2026-01-02'],
    ['revenue', '--from', 'yesterday', '--to', '2026-01-02'],
    ['revenue', '--from', '2026-02-01', '--to', '2026-01-02'],
    ['revenue', '--days', '0'],
    ['revenue', '--type', 'gross'],
    ['overview', '--currency', 'XYZ'],
    ['chart', 'nonsense'],
    ['chart-options', 'nonsense'],
    ['chart', 'mrr', '--filter', '{nope'],
    ['chart', 'mrr', '--filter', '{"a":1}'],
    ['chart', 'mrr', '--selector', '[1]'],
    ['chart', 'mrr', '--aggregate', 'median'],
    ['chart', 'mrr', '--from', '--json'],
  ];
  for (const args of cases) {
    const r = await e.rcat(...args, '--json');
    assert.equal(r.status, 1, args.join(' '));
    assert.equal(JSON.parse(r.stdout).error.code, 'E_BAD_ARGUMENT', args.join(' '));
  }
  const text = await e.rcat('overview', '--currency', 'XYZ');
  assert.match(text.stderr, /^error: Unknown currency "XYZ"\.\nUse one of: USD/);
  assert.equal(text.stdout, '');
  assert.equal(seen.length, 0);
});

test('an API key never appears in output, errors or the cache', async () => {
  const e = fresh({ REVENUECAT_ALPHA_APIKEY: KEY_ALPHA, REVENUECAT_BETA_APIKEY: KEY_BETA, REVENUECAT_FORBID_APIKEY: KEY_FORBID });
  const runs = [
    ['accounts'], ['overview'], ['revenue'], ['chart', 'mrr'], ['chart-options', 'mrr'], ['overview', '-a', KEY_ALPHA], ['overview', '--currency', KEY_ALPHA],
  ];
  for (const args of runs) {
    for (const flags of [[], ['--json']]) {
      const r = await e.rcat(...args, ...flags);
      noKeys(r.stdout, r.stderr);
    }
  }
  // Server errors that echo the Authorization header in their message are the server's doing; the CLI adds nothing.
  assert.ok(existsSync(join(e.home, 'projects.json')));
  noKeys(readFileSync(join(e.home, 'projects.json'), 'utf8'));
  custom = (req, res) => (send(res, 401, { message: 'invalid' }), true);
  const r = await e.rcat('overview');
  noKeys(r.stdout, r.stderr);
});

test('accounts resolving in parallel both end up in the cache', async () => {
  const e = pair();
  await e.rcat('accounts');
  const cache = JSON.parse(readFileSync(join(e.home, 'projects.json'), 'utf8'));
  assert.deepEqual(Object.keys(cache).map((k) => k.split(':')[0]).sort(), [A, B]);
  assert.equal(projectCalls(), 2);
  await e.rcat('accounts');
  assert.equal(projectCalls(), 2);
});

test('Retry-After may be an HTTP date', async () => {
  const e = pair();
  let hits = 0;
  custom = (req, res) => {
    if (!req.path.endsWith('/metrics/overview') || ++hits > 1) return false;
    return send(res, 429, {}, { 'retry-after': new Date(Date.now() - 5000).toUTCString() }), true;
  };
  const out = await e.json('overview', '-a', A);
  assert.equal(out.results[0].ok, true);
  assert.equal(hits, 2);
});

test('404 "App not found or not accessible" gets a permissions hint', async () => {
  const e = pair();
  custom = (req, res) => (req.path.includes('/charts/') ? (send(res, 404, { message: 'App not found or not accessible' }), true) : false);
  const r = (await e.json('chart', 'mrr', '-a', A)).results[0];
  assert.equal(r.error.code, 'E_NOT_FOUND');
  assert.match(r.error.hint, /charts_metrics:charts:read/);
});

test('an unset name among valid ones fails only that account', async () => {
  const e = fresh({ REVENUECAT_ALPHA_APIKEY: KEY_ALPHA, RCAT_ACCOUNTS: 'REVENUECAT_ALPHA_APIKEY,REVENUECAT_GONE_APIKEY' });
  const r = await e.rcat('overview', '--json');
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.results.map((x: any) => [x.account, x.ok]), [['REVENUECAT_ALPHA_APIKEY', true], ['REVENUECAT_GONE_APIKEY', false]]);
  assert.equal(out.results[1].error.code, 'E_UNKNOWN_ACCOUNT');
  const viaFlag = await e.rcat('overview', '-a', A, 'REVENUECAT_GONE_APIKEY');
  assert.equal(viaFlag.status, 1);
  assert.match(viaFlag.stdout, /REVENUECAT_ALPHA_APIKEY \(Alpha App\)/);
  assert.match(viaFlag.stdout, /REVENUECAT_GONE_APIKEY: error: .*not set or is empty/);
});

test('commander errors are E_BAD_ARGUMENT JSON with --json, plain stderr otherwise', async () => {
  const e = fresh();
  for (const args of [['overview', '--bogus'], ['chart'], ['nope'], ['revenue', '--from']]) {
    const j = await e.rcat(...args, '--json');
    assert.equal(j.status, 1, args.join(' '));
    assert.equal(j.stderr, '');
    assert.equal(JSON.parse(j.stdout).error.code, 'E_BAD_ARGUMENT', args.join(' '));
    const t = await e.rcat(...args);
    assert.equal(t.status, 1);
    assert.equal(t.stdout, '');
    assert.match(t.stderr, /^error: /);
  }
  assert.equal((await e.rcat('overview', '--help', '--json')).status, 0);
});

test('keys in non-pattern variables or typed as arguments never reach the output', async () => {
  const KEY = 'sk_FAKEKEY_custom_0123456789';
  const e = fresh({ MY_CUSTOM_KEY: KEY, REVENUECAT_ALPHA_APIKEY: KEY_ALPHA, RCAT_ACCOUNTS: 'MY_CUSTOM_KEY,REVENUECAT_ALPHA_APIKEY' });
  const runs = [
    ['overview', `--key=${KEY}`], ['overview', '-a', 'MY_CUSTOM_KEY', `--key=${KEY}`], [KEY], [`--${KEY}`], ['chart', KEY], ['overview', '--currency', KEY],
    ['overview', '-a', KEY], ['overview', '-a', 'MY_CUSTOM_KEY', '--currency', KEY], ['revenue', '--from', KEY, '--to', KEY],
  ];
  for (const args of runs) {
    for (const flags of [[], ['--json']]) {
      const r = await e.rcat(...args, ...flags);
      assert.ok(r.status !== null);
      for (const text of [r.stdout, r.stderr]) assert.ok(!text.includes(KEY) && !text.includes(KEY.slice(3)), `leak: ${args.join(' ')} ${flags.join('')}`);
      noKeys(r.stdout, r.stderr);
    }
  }
});

test('a key that is a prefix of another is redacted without leaving the longer one\'s tail', async () => {
  const SHORT = 'sk_FAKEPREFIX';
  const LONG = 'sk_FAKEPREFIX_tail_987654';
  const e = fresh({ P: SHORT, Q: LONG });
  const r = await e.rcat('overview', '-a', 'P', 'Q', '--currency', LONG);
  assert.equal(r.status, 1);
  assert.ok(!r.stderr.includes('tail_987654'), r.stderr);
  assert.match(r.stderr, /Unknown currency "\[redacted\]"/);
});

test('a placeholder value too short to be a key does not mangle output', async () => {
  const e = fresh({ REVENUECAT_X_APIKEY: 's' });
  const json = await e.json('charts');
  assert.ok(json.charts.includes('actives'));
  assert.ok(json.charts.includes('refund_request'));
});

test('help for an unknown command is a readable E_BAD_ARGUMENT with --json', async () => {
  const e = fresh();
  const r = await e.rcat('help', 'bogus', '--json');
  assert.equal(r.status, 1);
  const { error } = JSON.parse(r.stdout);
  assert.equal(error.code, 'E_BAD_ARGUMENT');
  assert.equal(error.message, "unknown command 'bogus'");
});
