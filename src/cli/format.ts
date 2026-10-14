import type { AccountResult } from '../core/accounts.js';

const dateOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function failureText(result: Extract<AccountResult<object>, { ok: false }>): string {
  const { code, message, hint } = result.error;
  return `${result.account}: error: ${message} [${code}]${hint ? `\n  ${hint}` : ''}`;
}

export function money(value: number, currency: string): string {
  return `${value.toFixed(2)} ${currency}`;
}

export function metricValue(metric: any, currency: string): string {
  const value = metric.value;
  if (typeof value !== 'number') return String(value ?? '-');
  if (metric.unit === '$') return money(value, currency);
  if (metric.unit === '%') return `${value}%`;
  return metric.unit && metric.unit !== '#' ? `${value} ${metric.unit}` : String(value);
}

export function periodText(period: unknown): string {
  if (period === 'P0D') return 'current';
  const days = /^P(\d+)D$/.exec(String(period));
  return days ? `last ${days[1]} days` : String(period ?? '');
}

/** A time key of a chart value: seconds or milliseconds since the epoch, or already a string. */
function timeOf(row: Record<string, unknown>): string | undefined {
  for (const key of ['cohort', 'date', 'x', 'timestamp', 'time']) {
    const t = row[key];
    if (typeof t === 'string') return t;
    if (typeof t === 'number') return dateOf(t < 1e11 ? t * 1000 : t);
  }
  return undefined;
}

/** Date, value and segment/measure per row when the values look like time series; pretty JSON otherwise. */
export function chartValuesText(data: any): string {
  const values: unknown = data?.values;
  const rows = Array.isArray(values) ? values : [];
  const isSeries = rows.length > 0 && rows.every((r) => r && typeof r === 'object' && timeOf(r) !== undefined && ('value' in r || 'y' in r));
  if (!isSeries) return JSON.stringify(values ?? null, null, 2);
  const label = (list: unknown, index: unknown): string | undefined => {
    const entry = Array.isArray(list) && typeof index === 'number' ? list[index] : undefined;
    return entry?.display_name;
  };
  return rows
    .map((r: Record<string, unknown>) => {
      const tags = [label(data.segments, r.segment), label(data.measures, r.measure)].filter(Boolean).join(' / ');
      return `  ${timeOf(r)}  ${String(r.value ?? r.y)}${tags ? `  (${tags})` : ''}`;
    })
    .join('\n');
}
