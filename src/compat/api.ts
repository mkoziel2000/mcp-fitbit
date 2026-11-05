/**
 * Google Health API access helpers for the Fitbit-compatible output mode.
 * Unlike the proxy tools these fetch *all* pages and return typed arrays, because the
 * compat tools aggregate several calls into one Fitbit-shaped response.
 */

import {
  makeGoogleHealthRequest,
  dataPointsPath,
  buildDailyRollUpBody,
  buildRangeFilter,
  createErrorResponse,
  GoogleHealthApiError,
  type ToolResponseStructure,
  type DataPointsResponse,
  type RollUpResponse,
} from '../utils.js';
import { ERROR_MESSAGES } from '../config.js';
import {
  buildFitbitZones,
  rollupDate,
  zoneBoundsByDate,
  type DailyZonesPoint,
  type FitbitZone,
  type RollupPoint,
} from './convert.js';

export type TokenFn = () => Promise<string | null>;

// === Error handling ===

/** Runs a compat handler and converts failures into MCP error responses. */
export async function guard(
  context: string,
  fn: () => Promise<ToolResponseStructure>
): Promise<ToolResponseStructure> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof GoogleHealthApiError) {
      if (error.status === 400 && error.body.includes('ACCOUNT_NOT_LINKED')) {
        return createErrorResponse(ERROR_MESSAGES.ACCOUNT_NOT_LINKED);
      }
      return createErrorResponse(
        `${ERROR_MESSAGES.API_REQUEST_FAILED} for ${context} (HTTP ${error.status}): ${error.body}`
      );
    }
    return createErrorResponse(
      `${ERROR_MESSAGES.API_REQUEST_FAILED} for ${context}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function request<T>(
  path: string,
  getToken: TokenFn,
  options: Parameters<typeof makeGoogleHealthRequest>[2] = {}
): Promise<T> {
  const result = await makeGoogleHealthRequest<T>(path, getToken, options);
  if (result === null) throw new Error(ERROR_MESSAGES.NO_ACCESS_TOKEN);
  return result;
}

// === Paging helpers ===

/** Lists every data point matching a filter, following nextPageToken. */
export async function listAll<T>(
  dataType: string,
  getToken: TokenFn,
  params: { filter?: string; pageSize?: number; maxPages?: number }
): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < (params.maxPages ?? 20); page++) {
    const res = await request<DataPointsResponse>(dataPointsPath(dataType), getToken, {
      query: { filter: params.filter, pageSize: params.pageSize, pageToken },
    });
    out.push(...((res.dataPoints ?? []) as T[]));
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/** Daily roll-up of a data type over [startDate, endDateExclusive), following nextPageToken. */
export async function rollUpAll(
  dataType: string,
  getToken: TokenFn,
  startDate: string,
  endDateExclusive: string,
  maxPages = 20
): Promise<RollupPoint[]> {
  const out: RollupPoint[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const res = await request<RollUpResponse>(dataPointsPath(dataType, ':dailyRollUp'), getToken, {
      method: 'POST',
      body: {
        ...buildDailyRollUpBody(startDate, endDateExclusive),
        ...(pageToken ? { pageToken } : {}),
      },
    });
    out.push(...((res.rollupDataPoints ?? []) as RollupPoint[]));
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

// === User context (units + time zone) ===

export interface UserContext {
  timeZone: string;
  weightUnit?: string;
  distanceUnit?: string;
  waterUnit?: string;
}

const CONTEXT_TTL_MS = 60 * 60 * 1000;
let cachedContext: { value: UserContext; at: number } | null = null;

export function resetCompatCaches(): void {
  cachedContext = null;
}

/** The account's time zone and display units, from Google Health settings (cached for an hour). */
export async function getUserContext(getToken: TokenFn): Promise<UserContext> {
  if (cachedContext && Date.now() - cachedContext.at < CONTEXT_TTL_MS) {
    return cachedContext.value;
  }
  let value: UserContext;
  try {
    const settings = await request<{
      timeZone?: string;
      weightUnit?: string;
      distanceUnit?: string;
      waterUnit?: string;
    }>('users/me/settings', getToken);
    value = {
      timeZone: process.env.COMPAT_TIME_ZONE || settings.timeZone || 'UTC',
      weightUnit: settings.weightUnit,
      distanceUnit: settings.distanceUnit,
      waterUnit: settings.waterUnit,
    };
  } catch (error) {
    console.error('Could not load Google Health settings, using defaults:', error);
    return { timeZone: process.env.COMPAT_TIME_ZONE || 'UTC' };
  }
  cachedContext = { value, at: Date.now() };
  return value;
}

// === Heart-rate zones ===

/**
 * Fitbit-style zones per civil date over [startDate, endDateExclusive), built from Google's own
 * zone data: Active Zone Minutes / time-in-zone for minutes, calories-in-zone for kcal and
 * daily-heart-rate-zones for the bpm bounds. Individual source failures degrade to missing
 * fields (reported in `notes`); if every minutes source fails the first error is thrown.
 */
export async function getZonesForRange(
  getToken: TokenFn,
  startDate: string,
  endDateExclusive: string
): Promise<{ zones: Map<string, FitbitZone[]>; notes: string[] }> {
  const [azm, tiz, kcal, bounds] = await Promise.allSettled([
    rollUpAll('active-zone-minutes', getToken, startDate, endDateExclusive, 60),
    rollUpAll('time-in-heart-rate-zone', getToken, startDate, endDateExclusive, 60),
    rollUpAll('calories-in-heart-rate-zone', getToken, startDate, endDateExclusive, 60),
    listAll<DailyZonesPoint>('daily-heart-rate-zones', getToken, {
      filter: buildRangeFilter('daily_heart_rate_zones.date', startDate, endDateExclusive),
      pageSize: 10000,
    }),
  ]);

  if (azm.status === 'rejected' && tiz.status === 'rejected') throw azm.reason;

  const notes: string[] = [];
  const value = <T>(r: PromiseSettledResult<T[]>, what: string): T[] => {
    if (r.status === 'fulfilled') return r.value;
    notes.push(`${what} unavailable: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
    return [];
  };

  const byDate = (points: RollupPoint[]) =>
    new Map(points.flatMap((p) => (rollupDate(p) ? [[rollupDate(p)!, p] as const] : [])));
  const azmByDate = byDate(value(azm, 'Active Zone Minutes'));
  const tizByDate = byDate(value(tiz, 'time-in-heart-rate-zone'));
  const kcalByDate = byDate(value(kcal, 'calories-in-heart-rate-zone'));
  const boundsByDate = zoneBoundsByDate(value(bounds, 'daily-heart-rate-zones'));

  const zones = new Map<string, FitbitZone[]>();
  for (const date of new Set([...azmByDate.keys(), ...tizByDate.keys()])) {
    const built = buildFitbitZones({
      azm: azmByDate.get(date),
      timeInZone: tizByDate.get(date),
      calories: kcalByDate.get(date),
      bounds: boundsByDate.get(date),
    });
    if (built) zones.set(date, built);
  }
  return { zones, notes };
}
