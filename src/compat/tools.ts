/**
 * Fitbit-compatible tool set.
 *
 * Enabled with GOOGLE_HEALTH_OUTPUT_MODE=fitbit. These tools keep the legacy Fitbit tool
 * names, parameters (period / inclusive end dates) and response shapes/units, but are
 * served from the Google Health API. They deliberately deviate from the 1:1 proxy
 * philosophy of the default mode so that consumers written against the Fitbit Web API
 * (such as the "Heather's Coach" Claude project) need no changes.
 *
 * Differences that cannot be hidden are reported in a top-level `_compat.notes` array.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  registerTool,
  CommonSchemas,
  buildRangeFilter,
  createSuccessResponse,
  createErrorResponse,
  createNoDataResponse,
  type ToolResponseStructure,
} from '../utils.js';
import { DATE_REGEX, VALIDATION_MESSAGES } from '../config.js';
import {
  guard,
  listAll,
  rollUpAll,
  getUserContext,
  getZonesForRange,
  type TokenFn,
} from './api.js';
import {
  addDays,
  convertDistance,
  convertWater,
  eachDate,
  inclusiveDays,
  mapHrv,
  mapSleep,
  mapWeight,
  num,
  nutritionSummary,
  periodStartDate,
  restingHeartRateByDate,
  rollupDate,
  round,
  todayInZone,
  zonedMidnightIso,
  activityLevelMinutes,
  type ActivityLevelPoint,
  type HrvPoint,
  type RestingHrPoint,
  type RollupPoint,
  type SleepPoint,
  type WeightPoint,
  type FitbitZone,
} from './convert.js';

// === Shared helpers ===

const dateSchema = z
  .string()
  .regex(DATE_REGEX, VALIDATION_MESSAGES.DATE_FORMAT);

const startDateSchema = dateSchema.describe(
  'The start date of the range, inclusive (YYYY-MM-DD)'
);
const endDateSchema = dateSchema.describe(
  'The end date of the range, INCLUSIVE (YYYY-MM-DD), as in the Fitbit API'
);
const optionalDateSchema = dateSchema
  .optional()
  .describe('Optional end date of the period (YYYY-MM-DD). Defaults to today');

function withNotes<T extends object>(body: T, notes: string[]): T | (T & { _compat: { notes: string[] } }) {
  return notes.length > 0 ? { ...body, _compat: { notes } } : body;
}

function checkRange(start: string, end: string, maxDays: number): string | null {
  if (end < start) return `endDate ${end} is before startDate ${start}.`;
  if (inclusiveDays(start, end) > maxDays) {
    return `The date range is limited to ${maxDays} days.`;
  }
  return null;
}

const rangeParams = { startDate: startDateSchema, endDate: endDateSchema };

// === Tools ===

/**
 * Registers the Fitbit-compatible tools. Names, parameters and response shapes follow the
 * legacy Fitbit tools of this server.
 */
export function registerCompatTools(server: McpServer, getToken: TokenFn): void {
  registerWeight(server, getToken);
  registerSleep(server, getToken);
  registerDailySummary(server, getToken);
  registerHeartRate(server, getToken);
  registerHrv(server, getToken);
  registerActivityTimeSeries(server, getToken);
  registerAzm(server, getToken);
  registerNutrition(server, getToken);
}

// --- Weight ---

function registerWeight(server: McpServer, t: TokenFn): void {
  registerTool(server, {
    name: 'get_weight',
    description:
      "Fitbit-compatible weight log for a period ending today (or on 'date'). Returns { weight: [{ date, time, logId, source, weight }] } with weight in the account's unit (pounds by default), as the Fitbit API did. period is one of 1d, 7d, 30d, 3m, 6m, 1y.",
    parametersSchema: {
      period: z.enum(['1d', '7d', '30d', '3m', '6m', '1y']).describe('Period ending on date (default today)'),
      date: optionalDateSchema,
    },
    handler: async ({ period, date }: { period: string; date?: string }) =>
      guard(`weight for period '${period}'`, async () => {
        const ctx = await getUserContext(t);
        const end = date ?? todayInZone(ctx.timeZone);
        const start = periodStartDate(end, period);
        const points = await listAll<WeightPoint>('weight', t, {
          filter: buildRangeFilter(
            'weight.sample_time.physical_time',
            zonedMidnightIso(start, ctx.timeZone),
            zonedMidnightIso(addDays(end, 1), ctx.timeZone)
          ),
          pageSize: 10000,
        });
        const body = mapWeight(points, ctx.weightUnit);
        if (body.weight.length === 0) {
          return createNoDataResponse(`weight for ${start} to ${end}`);
        }
        return createSuccessResponse(
          withNotes(body, ['bmi and body fat are not included.'])
        );
      }),
  });
}

// --- Sleep ---

function registerSleep(server: McpServer, t: TokenFn): void {
  registerTool(server, {
    name: 'get_sleep_by_date_range',
    description:
      "Fitbit-compatible sleep logs by date of sleep (the wake date), start and end INCLUSIVE, max 100 days. Returns { sleep: [{ dateOfSleep, startTime, endTime, duration(ms), minutesAsleep, minutesAwake, timeInBed, isMainSleep, type, levels: { summary: { deep, light, rem, wake: { count, minutes } }, data } }] }. There is no sleep score or efficiency.",
    parametersSchema: rangeParams,
    handler: async ({ startDate, endDate }: { startDate: string; endDate: string }) =>
      guard(`sleep from ${startDate} to ${endDate}`, async () => {
        const problem = checkRange(startDate, endDate, 100);
        if (problem) return createErrorResponse(problem);
        const points = await listAll<SleepPoint>('sleep', t, {
          filter: buildRangeFilter(
            'sleep.interval.civil_end_time',
            startDate,
            addDays(endDate, 1)
          ),
          pageSize: 25,
          maxPages: 20,
        });
        const body = mapSleep(points);
        if (body.sleep.length === 0) {
          return createNoDataResponse(`sleep from ${startDate} to ${endDate}`);
        }
        return createSuccessResponse(body);
      }),
  });
}

// --- Daily summary ---

function registerDailySummary(server: McpServer, t: TokenFn): void {
  registerTool(server, {
    name: 'get_daily_activity_summary',
    description:
      "Fitbit-compatible daily activity summary for one date: { activities: [], goals: {}, summary: { caloriesOut, steps, distances, floors, sedentary/lightlyActive/fairlyActive/veryActiveMinutes, restingHeartRate, heartRateZones } }. Distance uses the account's unit (miles by default). heartRateZones are Fitbit's Out of Range / Fat Burn / Cardio / Peak zones with minutes and calories (Google's Light / Moderate / Vigorous / Peak). Exercise sessions and goals are not included.",
    parametersSchema: { date: CommonSchemas.date },
    handler: async ({ date }: { date: string }) =>
      guard(`daily summary for ${date}`, async () => {
        const next = addDays(date, 1);
        const ctx = await getUserContext(t);
        const notes: string[] = [];

        const [steps, distance, calories] = await Promise.all([
          rollUpAll('steps', t, date, next),
          rollUpAll('distance', t, date, next),
          rollUpAll('total-calories', t, date, next),
        ]);
        if (!steps.length && !distance.length && !calories.length) {
          return createNoDataResponse(`daily activity for ${date}`);
        }

        const [floors, level, resting, zoneResult] = await Promise.all([
          rollUpAll('floors', t, date, next).catch(() => []),
          // activity-level has no dailyRollUp (list/reconcile only): sum the minute points
          listAll<ActivityLevelPoint>('activity-level', t, {
            filter: buildRangeFilter(
              'activity_level.interval.civil_start_time',
              `${date}T00:00:00`,
              `${next}T00:00:00`
            ),
            pageSize: 10000,
          }).catch((error: unknown) => {
            notes.push(
              `activity minutes unavailable: ${error instanceof Error ? error.message : String(error)}`
            );
            return [] as ActivityLevelPoint[];
          }),
          listAll<RestingHrPoint>('daily-resting-heart-rate', t, {
            filter: buildRangeFilter('daily_resting_heart_rate.date', date, next),
          }).catch(() => [] as RestingHrPoint[]),
          getZonesForRange(t, date, next).catch((error: unknown) => {
            notes.push(
              `heartRateZones unavailable: ${error instanceof Error ? error.message : String(error)}`
            );
            return null;
          }),
        ]);
        const zones = zoneResult?.zones.get(date);
        notes.push(...(zoneResult?.notes ?? []));

        const summary: Record<string, unknown> = {
          caloriesOut: Math.round(calories[0]?.totalCalories?.kcalSum ?? 0),
          steps: num(steps[0]?.steps?.countSum),
          distances: [
            {
              activity: 'total',
              distance: convertDistance(num(distance[0]?.distance?.millimetersSum), ctx.distanceUnit),
            },
          ],
          floors: num(floors[0]?.floors?.countSum),
          ...(activityLevelMinutes(level) ?? {}),
        };
        const restingHr = restingHeartRateByDate(resting).get(date);
        if (restingHr !== undefined) summary.restingHeartRate = restingHr;
        if (zones) summary.heartRateZones = zones;

        return createSuccessResponse(
          withNotes({ activities: [], goals: {}, summary }, notes)
        );
      }),
  });
}

// --- Heart rate ---

async function buildHeartDays(
  t: TokenFn,
  start: string,
  end: string
): Promise<ToolResponseStructure> {
  const notes: string[] = [];
  const next = addDays(end, 1);

  const [restingPoints, zoneResult] = await Promise.all([
    listAll<RestingHrPoint>('daily-resting-heart-rate', t, {
      filter: buildRangeFilter('daily_resting_heart_rate.date', start, next),
      pageSize: 10000,
    }),
    getZonesForRange(t, start, next).catch((error: unknown) => {
      notes.push(
        `heartRateZones unavailable: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }),
  ]);
  const resting = restingHeartRateByDate(restingPoints);
  const zoneByDate = zoneResult?.zones ?? new Map<string, FitbitZone[]>();
  notes.push(...(zoneResult?.notes ?? []));

  const days = eachDate(start, end)
    .filter((d) => resting.has(d) || zoneByDate.has(d))
    .map((d) => ({
      dateTime: d,
      value: {
        customHeartRateZones: [],
        ...(zoneByDate.has(d) ? { heartRateZones: zoneByDate.get(d) } : {}),
        ...(resting.has(d) ? { restingHeartRate: resting.get(d) } : {}),
      },
    }));

  if (days.length === 0) {
    return createNoDataResponse(`heart rate from ${start} to ${end}`);
  }
  return createSuccessResponse(withNotes({ 'activities-heart': days }, notes));
}

function registerHeartRate(server: McpServer, t: TokenFn): void {
  registerTool(server, {
    name: 'get_heart_rate',
    description:
      "Fitbit-compatible daily heart rate for a period ending today (or on 'date'): { 'activities-heart': [{ dateTime, value: { restingHeartRate, heartRateZones: [{ name, min, max, minutes, caloriesOut }] } }] }. Zones are Fitbit's Out of Range / Fat Burn / Cardio / Peak (Google's Light / Moderate / Vigorous / Peak) with the account's own bpm bounds. period is one of 1d, 7d, 30d, 1w, 1m.",
    parametersSchema: {
      period: z.enum(['1d', '7d', '30d', '1w', '1m']).describe('Period ending on date (default today)'),
      date: optionalDateSchema,
    },
    handler: async ({ period, date }: { period: string; date?: string }) =>
      guard(`heart rate for period '${period}'`, async () => {
        const ctx = await getUserContext(t);
        const end = date ?? todayInZone(ctx.timeZone);
        return buildHeartDays(t, periodStartDate(end, period), end);
      }),
  });

  registerTool(server, {
    name: 'get_heart_rate_by_date_range',
    description:
      'Fitbit-compatible daily heart rate for a date range, start and end INCLUSIVE, max 365 days. Same shape as get_heart_rate.',
    parametersSchema: rangeParams,
    handler: async ({ startDate, endDate }: { startDate: string; endDate: string }) =>
      guard(`heart rate from ${startDate} to ${endDate}`, async () => {
        const problem = checkRange(startDate, endDate, 365);
        if (problem) return createErrorResponse(problem);
        return buildHeartDays(t, startDate, endDate);
      }),
  });
}

// --- HRV ---

function registerHrv(server: McpServer, t: TokenFn): void {
  const fetchHrv = async (start: string, end: string): Promise<ToolResponseStructure> => {
    const points = await listAll<HrvPoint>('daily-heart-rate-variability', t, {
      filter: buildRangeFilter('daily_heart_rate_variability.date', start, addDays(end, 1)),
      pageSize: 10000,
    });
    const body = mapHrv(points);
    if (body.hrv.length === 0) return createNoDataResponse(`HRV from ${start} to ${end}`);
    return createSuccessResponse(body);
  };

  registerTool(server, {
    name: 'get_hrv',
    description:
      'Fitbit-compatible daily HRV for one date: { hrv: [{ dateTime, value: { dailyRmssd, deepRmssd } }] } in milliseconds.',
    parametersSchema: { date: CommonSchemas.date },
    handler: async ({ date }: { date: string }) =>
      guard(`HRV for ${date}`, () => fetchHrv(date, date)),
  });

  registerTool(server, {
    name: 'get_hrv_by_date_range',
    description:
      'Fitbit-compatible daily HRV for a date range, start and end INCLUSIVE, max 30 days. Same shape as get_hrv.',
    parametersSchema: rangeParams,
    handler: async ({ startDate, endDate }: { startDate: string; endDate: string }) =>
      guard(`HRV from ${startDate} to ${endDate}`, async () => {
        const problem = checkRange(startDate, endDate, 30);
        if (problem) return createErrorResponse(problem);
        return fetchHrv(startDate, endDate);
      }),
  });
}

// --- Activity time series ---

const ACTIVITY_RESOURCES = [
  'steps',
  'distance',
  'calories',
  'activityCalories',
  'caloriesBMR',
  'tracker/activityCalories',
  'tracker/calories',
  'tracker/distance',
] as const;

function registerActivityTimeSeries(server: McpServer, t: TokenFn): void {
  registerTool(server, {
    name: 'get_activity_timeseries',
    description:
      "Fitbit-compatible daily activity time series over a date range (start and end INCLUSIVE, max 30 days): { 'activities-<resource>': [{ dateTime, value: '<string>' }] }. Supports steps, distance (account unit, miles by default), calories (total kcal), activityCalories (active kcal) and the tracker/ variants. caloriesBMR is not available.",
    parametersSchema: {
      resourcePath: z.enum(ACTIVITY_RESOURCES).describe("Activity resource to retrieve (e.g. 'steps', 'distance', 'calories')"),
      ...rangeParams,
    },
    handler: async ({
      resourcePath,
      startDate,
      endDate,
    }: {
      resourcePath: (typeof ACTIVITY_RESOURCES)[number];
      startDate: string;
      endDate: string;
    }) =>
      guard(`${resourcePath} from ${startDate} to ${endDate}`, async () => {
        const problem = checkRange(startDate, endDate, 30);
        if (problem) return createErrorResponse(problem);
        const resource = resourcePath.replace('tracker/', '');
        if (resource === 'caloriesBMR') {
          return createErrorResponse(
            'caloriesBMR is not available from the Google Health API.'
          );
        }

        const ctx = await getUserContext(t);
        const dataType =
          resource === 'steps'
            ? 'steps'
            : resource === 'distance'
              ? 'distance'
              : resource === 'calories'
                ? 'total-calories'
                : 'active-energy-burned';
        const extract = (p: RollupPoint): number | undefined => {
          switch (dataType) {
            case 'steps':
              return p.steps ? num(p.steps.countSum) : undefined;
            case 'distance':
              return p.distance
                ? convertDistance(num(p.distance.millimetersSum), ctx.distanceUnit)
                : undefined;
            case 'total-calories':
              return p.totalCalories ? Math.round(p.totalCalories.kcalSum ?? 0) : undefined;
            default:
              return p.activeEnergyBurned ? Math.round(p.activeEnergyBurned.kcalSum ?? 0) : undefined;
          }
        };

        const points = await rollUpAll(dataType, t, startDate, addDays(endDate, 1));
        const byDate = new Map<string, number>();
        for (const p of points) {
          const d = rollupDate(p);
          const v = extract(p);
          if (d && v !== undefined) byDate.set(d, v);
        }
        if (byDate.size === 0) {
          return createNoDataResponse(`${resourcePath} from ${startDate} to ${endDate}`);
        }
        const series = eachDate(startDate, endDate).map((d) => ({
          dateTime: d,
          value: String(byDate.get(d) ?? 0),
        }));
        return createSuccessResponse({
          [`activities-${resourcePath.replace('/', '-')}`]: series,
        });
      }),
  });
}

// --- Active Zone Minutes ---

function registerAzm(server: McpServer, t: TokenFn): void {
  registerTool(server, {
    name: 'get_azm_timeseries',
    description:
      "Fitbit-compatible Active Zone Minutes by day (start and end INCLUSIVE, max 1095 days): { 'activities-active-zone-minutes': [{ dateTime, value: { activeZoneMinutes, fatBurnActiveZoneMinutes, cardioActiveZoneMinutes, peakActiveZoneMinutes } }] }. Only days with data are returned.",
    parametersSchema: rangeParams,
    handler: async ({ startDate, endDate }: { startDate: string; endDate: string }) =>
      guard(`active zone minutes from ${startDate} to ${endDate}`, async () => {
        const problem = checkRange(startDate, endDate, 1095);
        if (problem) return createErrorResponse(problem);
        const points = await rollUpAll('active-zone-minutes', t, startDate, addDays(endDate, 1), 60);
        const series = points
          .map((p) => {
            const date = rollupDate(p);
            const azm = p.activeZoneMinutes;
            if (!date || !azm) return null;
            const fat = num(azm.sumInFatBurnHeartZone);
            const cardio = num(azm.sumInCardioHeartZone);
            const peak = num(azm.sumInPeakHeartZone);
            return {
              dateTime: date,
              value: {
                activeZoneMinutes: fat + cardio + peak,
                fatBurnActiveZoneMinutes: fat,
                cardioActiveZoneMinutes: cardio,
                peakActiveZoneMinutes: peak,
              },
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null)
          .sort((a, b) => a.dateTime.localeCompare(b.dateTime));
        if (series.length === 0) {
          return createNoDataResponse(`active zone minutes from ${startDate} to ${endDate}`);
        }
        return createSuccessResponse({ 'activities-active-zone-minutes': series });
      }),
  });
}

// --- Nutrition ---

const NUTRITION_RESOURCES = ['caloriesIn', 'water'] as const;

function registerNutrition(server: McpServer, t: TokenFn): void {
  registerTool(server, {
    name: 'get_food_log',
    description:
      "Fitbit-compatible food log summary for one date: { foods: [], goals: {}, summary: { calories, carbs, fat, fiber, protein, sodium, water } } (kcal; g; sodium in mg; water in the account's unit). Individual food entries and goals are not included.",
    parametersSchema: { date: CommonSchemas.date },
    handler: async ({ date }: { date: string }) =>
      guard(`food log for ${date}`, async () => {
        const next = addDays(date, 1);
        const ctx = await getUserContext(t);
        const [nutrition, hydration] = await Promise.all([
          rollUpAll('nutrition-log', t, date, next),
          rollUpAll('hydration-log', t, date, next).catch(() => []),
        ]);
        const summary = nutritionSummary(nutrition[0]);
        if (!summary) return createNoDataResponse(`food log for ${date}`);
        const water = convertWater(
          hydration[0]?.hydrationLog?.amountConsumed?.millilitersSum ?? 0,
          ctx.waterUnit
        );
        return createSuccessResponse(
          withNotes({ foods: [], goals: {}, summary: { ...summary, water } }, [
            'Individual foods and goals are not included.',
          ])
        );
      }),
  });

  const fetchSeries = async (
    resource: (typeof NUTRITION_RESOURCES)[number],
    start: string,
    end: string
  ): Promise<ToolResponseStructure> => {
    const problem = checkRange(start, end, 1095);
    if (problem) return createErrorResponse(problem);
    const ctx = await getUserContext(t);
    const dataType = resource === 'caloriesIn' ? 'nutrition-log' : 'hydration-log';
    const points = await rollUpAll(dataType, t, start, addDays(end, 1), 60);
    const byDate = new Map<string, number>();
    for (const p of points) {
      const d = rollupDate(p);
      if (!d) continue;
      if (resource === 'caloriesIn' && p.nutritionLog) {
        byDate.set(d, Math.round(p.nutritionLog.energy?.kcalSum ?? 0));
      } else if (resource === 'water' && p.hydrationLog) {
        byDate.set(
          d,
          convertWater(p.hydrationLog.amountConsumed?.millilitersSum ?? 0, ctx.waterUnit)
        );
      }
    }
    if (byDate.size === 0) {
      return createNoDataResponse(`${resource} from ${start} to ${end}`);
    }
    return createSuccessResponse({
      [`foods-log-${resource}`]: eachDate(start, end).map((d) => ({
        dateTime: d,
        value: String(round(byDate.get(d) ?? 0, 1)),
      })),
    });
  };

  registerTool(server, {
    name: 'get_nutrition',
    description:
      "Fitbit-compatible nutrition time series for a period ending today (or on 'date'): { 'foods-log-<resource>': [{ dateTime, value: '<string>' }] }. resource is caloriesIn (kcal) or water (account unit). period is one of 1d, 7d, 30d, 1w, 1m, 3m, 6m, 1y.",
    parametersSchema: {
      resource: z.enum(NUTRITION_RESOURCES).describe('The nutrition resource to retrieve'),
      period: z.enum(['1d', '7d', '30d', '1w', '1m', '3m', '6m', '1y']).describe('Period ending on date (default today)'),
      date: optionalDateSchema,
    },
    handler: async ({
      resource,
      period,
      date,
    }: {
      resource: (typeof NUTRITION_RESOURCES)[number];
      period: string;
      date?: string;
    }) =>
      guard(`${resource} for period '${period}'`, async () => {
        const ctx = await getUserContext(t);
        const end = date ?? todayInZone(ctx.timeZone);
        return fetchSeries(resource, periodStartDate(end, period), end);
      }),
  });

  registerTool(server, {
    name: 'get_nutrition_by_date_range',
    description:
      "Fitbit-compatible nutrition time series for a date range (start and end INCLUSIVE, max 1095 days). resource is caloriesIn (kcal) or water (account unit). Same shape as get_nutrition.",
    parametersSchema: {
      resource: z.enum(NUTRITION_RESOURCES).describe('The nutrition resource to retrieve'),
      ...rangeParams,
    },
    handler: async ({
      resource,
      startDate,
      endDate,
    }: {
      resource: (typeof NUTRITION_RESOURCES)[number];
      startDate: string;
      endDate: string;
    }) =>
      guard(`${resource} from ${startDate} to ${endDate}`, () =>
        fetchSeries(resource, startDate, endDate)
      ),
  });
}
