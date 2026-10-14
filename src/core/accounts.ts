import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { apiGet } from './client.js';
import { RcatError } from './errors.js';

export interface Account {
  /** The full name of the environment variable holding the key; this is the account's identity everywhere. */
  name: string;
  /** From `--project-id`; skips discovery. */
  projectId?: string;
  /** The key. Only ever used as the Bearer token. */
  readonly apiKey: string;
  /** Set when the variable is unset or empty: reported as that account's own failure. */
  missing?: RcatError;
}

export interface Project {
  id: string;
  name: string | null;
}

export const DEFAULT_PATTERN = /^REVENUECAT_.+_APIKEY$/;
export const DEFAULT_ACCOUNTS_HELP = 'every set variable matching REVENUECAT_*_APIKEY, or the variables listed in RCAT_ACCOUNTS (comma-separated)';

/** Every key seen so far; `redact` removes them from anything printed. */
const secrets = new Set<string>();
const MIN_SECRET_LENGTH = 8;

function accountOf(name: string, env: NodeJS.ProcessEnv): Account {
  const value = env[name];
  const account = { name } as Account;
  if (!value) {
    account.missing = new RcatError(`Unknown account: environment variable ${name} is not set or is empty.`, { code: 'E_UNKNOWN_ACCOUNT', hint: 'Pass the full name of a variable that holds a RevenueCat v2 secret key.' });
    Object.defineProperty(account, 'apiKey', { value: '', enumerable: false });
    return account;
  }
  secrets.add(value);
  Object.defineProperty(account, 'apiKey', { value, enumerable: false });
  return account;
}

/** The variable names in the words of the command line after `-a`/`--account` (also `--account=X`, `-aX`). */
function accountNamesInArgv(argv: string[]): string[] {
  const names: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i]!;
    const inline = /^--account=(.+)$/.exec(word) ?? /^-a(.+)$/.exec(word);
    if (inline) names.push(inline[1]!);
    else if (word === '-a' || word === '--account') {
      while (i + 1 < argv.length && !argv[i + 1]!.startsWith('-')) names.push(argv[++i]!);
    }
  }
  return names;
}

/**
 * Registers every key that could be named on this run (pattern variables, RCAT_ACCOUNTS, `-a`) so `redact`
 * covers all output from the first byte, before any argument is validated.
 */
export function registerSecrets(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): void {
  const names = [...Object.keys(env).filter((n) => DEFAULT_PATTERN.test(n)), ...(env.RCAT_ACCOUNTS?.split(',').map((n) => n.trim()) ?? []), ...accountNamesInArgv(argv)];
  for (const name of names) if (name && env[name]) secrets.add(env[name]!);
}

/** Text with every known key replaced, for messages that echo what the user typed. */
export function redact(text: string, env: NodeJS.ProcessEnv = process.env): string {
  registerSecrets([], env);
  let out = text;
  // Longest first, so a key that is a prefix of another cannot leave the other's tail behind. Values shorter
  // than a real key (placeholders like "x") would mangle ordinary words and are not worth hiding.
  const known = [...secrets].filter((s) => s.length >= MIN_SECRET_LENGTH).sort((a, b) => b.length - a.length);
  for (const secret of known) out = out.split(secret).join('[redacted]');
  return out;
}

/** The accounts to work on: the variables named with `-a`, else the default set. */
export function selectAccounts(names: string[] | undefined, projectId?: string, env: NodeJS.ProcessEnv = process.env): Account[] {
  let chosen: string[];
  if (names && names.length > 0) {
    chosen = [...new Set(names)];
  } else {
    const listed = env.RCAT_ACCOUNTS?.split(',').map((n) => n.trim()).filter(Boolean);
    chosen = listed && listed.length > 0 ? [...new Set(listed)] : Object.keys(env).filter((n) => DEFAULT_PATTERN.test(n) && env[n]).sort();
    if (chosen.length === 0) {
      throw new RcatError('No RevenueCat accounts found.', { code: 'E_NO_ACCOUNTS', hint: 'Set one or more variables named REVENUECAT_<NAME>_APIKEY to RevenueCat v2 secret keys, or list variable names in RCAT_ACCOUNTS (comma-separated), or pass -a <VAR>.' });
    }
  }
  const accounts = chosen.map((n) => accountOf(n, env));
  // Unknown names are failures of their own; only when nothing usable is left does the command fail as a whole.
  if (accounts.every((a) => a.missing)) throw accounts[0]!.missing;
  if (projectId !== undefined) {
    if (accounts.length !== 1) throw new RcatError('--project-id needs exactly one account.', { code: 'E_BAD_ARGUMENT', hint: 'Select the account with -a <VAR>.' });
    accounts[0]!.projectId = projectId;
  }
  return accounts;
}

const cacheFile = (): string => join(process.env.RCAT_CLI_HOME || join(homedir(), '.rcat-cli'), 'projects.json');

/** Keyed by variable name and a short fingerprint of the key, so a rotated key resolves again. */
function cacheKey(account: Account): string {
  return `${account.name}:${createHash('sha256').update(account.apiKey).digest('hex').slice(0, 12)}`;
}

function readCache(): Record<string, Project> {
  try {
    const data = JSON.parse(readFileSync(cacheFile(), 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/** Re-reads the file and adds one entry, so accounts resolving in parallel do not overwrite each other. */
function writeCache(key: string, project: Project): void {
  try {
    const file = cacheFile();
    mkdirSync(join(file, '..'), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ ...readCache(), [key]: project }, null, 2) + '\n', { mode: 0o600 });
    renameSync(temp, file);
  } catch {
    // A cache that cannot be written only costs a request next time.
  }
}

async function listProjects(account: Account): Promise<{ id: string; name: string }[]> {
  const projects: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await apiGet(account.apiKey, '/projects', { limit: 100, starting_after: cursor });
    const items: { id: string; name: string }[] = Array.isArray(page?.items) ? page.items : [];
    projects.push(...items);
    if (!page?.next_page || items.length === 0) return projects;
    let next: string | null = null;
    try {
      next = new URL(String(page.next_page), 'http://localhost').searchParams.get('starting_after');
    } catch {
      // fall back to the last id
    }
    next ??= items[items.length - 1]!.id;
    if (seen.has(next)) return projects;
    seen.add(next);
    cursor = next;
  }
}

/** The project an account reads: the PROJECT_ID override, the cache, or the only project the key can see. */
export async function resolveProject(account: Account): Promise<Project> {
  if (account.projectId) return { id: account.projectId, name: null };
  const key = cacheKey(account);
  const cache = readCache();
  const hit = cache[key];
  if (hit && typeof hit.id === 'string') return { id: hit.id, name: hit.name ?? null };

  const useId = `-a ${account.name} --project-id <id>`;
  let projects: { id: string; name: string }[];
  try {
    projects = await listProjects(account);
  } catch (error) {
    if (error instanceof RcatError && error.code === 'E_FORBIDDEN') {
      throw new RcatError(error.message, { code: 'E_FORBIDDEN', hint: `The key lacks project_configuration:projects:read, so the project cannot be looked up. Run again with ${useId}.` });
    }
    throw error;
  }
  if (projects.length === 0) throw new RcatError(`The key of account "${account.name}" sees no projects.`, { code: 'E_NOT_FOUND', hint: `Run again with ${useId}.` });
  if (projects.length > 1) {
    throw new RcatError(`Account "${account.name}" can see several projects: ${projects.map((p) => `${p.id} (${p.name})`).join(', ')}.`, { code: 'E_AMBIGUOUS_PROJECT', hint: `Run again with ${useId}, using one of the ids above.` });
  }
  const project = { id: projects[0]!.id, name: projects[0]!.name ?? null };
  writeCache(key, project);
  return project;
}

export type AccountResult<T> = ({ account: string; ok: true } & T) | { account: string; ok: false; error: { code: string; message: string; hint: string | null } };

/**
 * Runs `work` once per account: accounts in parallel (they have separate rate limits), the calls of one account
 * in sequence (inside `work`). A failure is a result of its own; it does not stop the others.
 */
export async function forEachAccount<T extends object>(accounts: Account[], work: (account: Account, project: Project) => Promise<T>): Promise<AccountResult<T>[]> {
  return Promise.all(
    accounts.map(async (account): Promise<AccountResult<T>> => {
      try {
        if (account.missing) throw account.missing;
        const project = await resolveProject(account);
        return { account: account.name, ok: true, ...(await work(account, project)) };
      } catch (error) {
        const known = error instanceof RcatError;
        return { account: account.name, ok: false, error: { code: (known && error.code) || 'E_UNEXPECTED', message: redact(error instanceof Error ? error.message : String(error)), hint: (known && error.hint) || null } };
      }
    }),
  );
}
