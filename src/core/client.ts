import { RcatError } from './errors.js';

export const DEFAULT_BASE = 'https://api.revenuecat.com/v2';
const MAX_RETRIES = 3;
const MAX_WAIT_SECONDS = 60;

export type Query = Record<string, string | number | boolean | undefined>;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function apiMessage(body: unknown): string | undefined {
  const message = (body as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : undefined;
}

/** Seconds to wait from a `Retry-After` header (seconds or an HTTP date), capped; 1 when absent or unreadable. */
function retryDelay(header: string | null): number {
  const text = header?.trim() ?? '';
  let seconds = NaN;
  if (/^\d+(\.\d+)?$/.test(text)) seconds = Number(text);
  else if (text) {
    const at = Date.parse(text);
    if (!Number.isNaN(at)) seconds = Math.max(0, (at - Date.now()) / 1000);
  }
  return Math.min(Number.isFinite(seconds) ? seconds : 1, MAX_WAIT_SECONDS);
}

/** GET `path` (e.g. `/projects`) with the project's key. The key goes into the Authorization header and nowhere else. */
export async function apiGet<T = any>(apiKey: string, path: string, query: Query = {}): Promise<T> {
  const base = (process.env.RCAT_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
  const url = new URL(base + path);
  for (const [name, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(name, String(value));

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
    } catch (error) {
      const code = (error as { cause?: { code?: string } }).cause?.code;
      throw new RcatError(`Could not reach RevenueCat${code ? ` (${code})` : ''}.`, { code: 'E_NETWORK', hint: 'Check the network connection and RCAT_API_BASE.' });
    }
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    if (response.ok) return body as T;

    const detail = apiMessage(body);
    const status = response.status;
    if (status === 429) {
      if (attempt >= MAX_RETRIES) throw new RcatError('RevenueCat rate limit hit; gave up after 3 retries.', { code: 'E_RATE_LIMITED', hint: 'Charts and metrics allow 25 requests per minute per project. Wait a minute and retry.' });
      await sleep(retryDelay(response.headers.get('retry-after')) * 1000);
      continue;
    }
    const withDetail = (text: string) => (detail ? `${text}: ${detail}` : text);
    if (status === 401) throw new RcatError(withDetail('RevenueCat rejected the API key (401)'), { code: 'E_UNAUTHORIZED', hint: 'Check that the key in the environment variable is a valid, unrevoked v2 secret key.' });
    if (status === 403) throw new RcatError(withDetail('RevenueCat denied access (403)'), { code: 'E_FORBIDDEN', hint: 'The key lacks a permission this command needs.' });
    if (status === 404) {
      const hint = detail?.includes('App not found or not accessible')
        ? "RevenueCat refused chart/revenue data for this key; check that the v2 secret key has the Charts & Metrics read permissions (charts_metrics:charts:read, charts_metrics:overview:read) and access to the project's apps."
        : undefined;
      throw new RcatError(withDetail(`Not found (404) for ${path}`), { code: 'E_NOT_FOUND', hint });
    }
    if (status === 400) throw new RcatError(withDetail('Bad request (400)'), { code: 'E_BAD_REQUEST' });
    throw new RcatError(withDetail(`RevenueCat API error (${status})`), { code: 'E_API' });
  }
}
