import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCompatTools } from './tools.js';
import { resetCompatCaches } from './api.js';

global.fetch = vi.fn();
const fetchMock = () => fetch as ReturnType<typeof vi.fn>;

type Handler = (params: Record<string, unknown>) => Promise<{
  content: { text: string }[];
  isError?: boolean;
}>;

function setup() {
  const handlers: Record<string, Handler> = {};
  const server = {
    tool: (name: string, _d: string, _s: unknown, h: Handler) => {
      handlers[name] = h;
    },
  } as unknown as McpServer;
  registerCompatTools(server, async () => 'tok');
  return handlers;
}

const SETTINGS = {
  timeZone: 'America/Denver',
  weightUnit: 'WEIGHT_UNIT_POUNDS',
  distanceUnit: 'DISTANCE_UNIT_MILES',
  waterUnit: 'WATER_UNIT_FL_OZ',
};

type Route = (url: string, init?: RequestInit) => unknown | undefined;

/** Routes fetch calls by decoded URL; settings are always served. Unrouted calls return {}. */
function route(...routes: Route[]) {
  fetchMock().mockImplementation(async (rawUrl: string, init?: RequestInit) => {
    const url = decodeURIComponent(rawUrl);
    let body: unknown = url.includes('/users/me/settings') ? SETTINGS : undefined;
    for (const r of routes) {
      if (body !== undefined) break;
      body = r(url, init);
    }
    return { ok: true, status: 200, json: async () => body ?? {} };
  });
}

const calls = () => fetchMock().mock.calls.map((c) => decodeURIComponent(c[0] as string));
const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body));
const text = async (p: Promise<{ content: { text: string }[] }>) => (await p).content[0].text;
const json = async (p: Promise<{ content: { text: string }[] }>) => JSON.parse(await text(p));

const rollup = (date: string, value: Record<string, unknown>) => {
  const [year, month, day] = date.split('-').map(Number);
  return { civilStartTime: { date: { year, month, day }, time: {} }, ...value };
};

beforeEach(() => {
  fetchMock().mockReset();
  resetCompatCaches();
  delete process.env.COMPAT_TIME_ZONE;
});

afterEach(() => {
  delete process.env.COMPAT_TIME_ZONE;
});

describe('registerCompatTools', () => {
  it('registers every legacy Fitbit tool name the coach depends on', () => {
    expect(Object.keys(setup()).sort()).toEqual(
      [
        'get_weight',
        'get_sleep_by_date_range',
        'get_daily_activity_summary',
        'get_heart_rate',
        'get_heart_rate_by_date_range',
        'get_hrv',
        'get_hrv_by_date_range',
        'get_activity_timeseries',
        'get_azm_timeseries',
        'get_food_log',
        'get_nutrition',
        'get_nutrition_by_date_range',
      ].sort()
    );
  });
});

describe('get_weight', () => {
  it('queries the local-day window for the period and returns pounds', async () => {
    route((url) =>
      url.includes('/dataTypes/weight/dataPoints')
        ? {
            dataPoints: [
              {
                name: 'users/1/dataTypes/weight/dataPoints/9',
                weight: {
                  weightGrams: 84500,
                  sampleTime: {
                    civilTime: {
                      date: { year: 2026, month: 11, day: 4 },
                      time: { hours: 6, minutes: 30 },
                    },
                  },
                },
              },
            ],
          }
        : undefined
    );
    const res = await json(setup().get_weight({ period: '7d', date: '2026-11-04' }));
    expect(res.weight).toEqual([
      { date: '2026-11-04', logId: 9, source: 'API', time: '06:30:00', weight: 186.3 },
    ]);
    const weightCall = calls().find((u) => u.includes('/weight/dataPoints'))!;
    expect(weightCall).toContain('weight.sample_time.physical_time >= "2026-10-29T06:00:00.000Z"');
    expect(weightCall).toContain('weight.sample_time.physical_time < "2026-11-05T07:00:00.000Z"');
  });

  it('reports no data instead of an empty log', async () => {
    route();
    expect(await text(setup().get_weight({ period: '1d', date: '2026-11-04' }))).toContain(
      'No data found'
    );
  });
});

describe('get_sleep_by_date_range', () => {
  it('filters on civil end time with an inclusive end date and maps logs', async () => {
    route((url) =>
      url.includes('/dataTypes/sleep/dataPoints')
        ? {
            dataPoints: [
              {
                name: 'users/1/dataTypes/sleep/dataPoints/5',
                sleep: {
                  type: 'STAGES',
                  interval: {
                    civilEndTime: { date: { year: 2026, month: 11, day: 4 }, time: { hours: 6 } },
                  },
                  summary: {
                    minutesAsleep: '400',
                    minutesInSleepPeriod: '430',
                    stagesSummary: [{ type: 'DEEP', minutes: '80', count: '2' }],
                  },
                },
              },
            ],
          }
        : undefined
    );
    const res = await json(
      setup().get_sleep_by_date_range({ startDate: '2026-11-01', endDate: '2026-11-04' })
    );
    expect(res.sleep[0]).toMatchObject({
      dateOfSleep: '2026-11-04',
      minutesAsleep: 400,
      type: 'stages',
    });
    expect(res.sleep[0].levels.summary.deep).toEqual({ count: 2, minutes: 80 });
    const sleepCall = calls().find((u) => u.includes('/sleep/dataPoints'))!;
    expect(sleepCall).toContain('sleep.interval.civil_end_time >= "2026-11-01"');
    expect(sleepCall).toContain('sleep.interval.civil_end_time < "2026-11-05"');
    expect(sleepCall).toContain('pageSize=25');
  });

  it('rejects ranges over 100 days', async () => {
    route();
    const res = await setup().get_sleep_by_date_range({
      startDate: '2026-01-01',
      endDate: '2026-06-01',
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('100 days');
  });
});

const zoneRoutes: Route = (url) => {
  if (url.includes('/active-zone-minutes/dataPoints:dailyRollUp'))
    return {
      rollupDataPoints: [
        rollup('2026-11-03', {
          activeZoneMinutes: {
            sumInFatBurnHeartZone: '51',
            sumInCardioHeartZone: '28',
            sumInPeakHeartZone: '0',
          },
        }),
      ],
    };
  if (url.includes('/time-in-heart-rate-zone/dataPoints:dailyRollUp'))
    return {
      rollupDataPoints: [
        rollup('2026-11-03', {
          timeInHeartRateZone: {
            timeInHeartRateZones: [{ heartRateZone: 'LIGHT', duration: '76920s' }],
          },
        }),
      ],
    };
  if (url.includes('/calories-in-heart-rate-zone/dataPoints:dailyRollUp'))
    return {
      rollupDataPoints: [
        rollup('2026-11-03', {
          caloriesInHeartRateZone: {
            caloriesInHeartRateZones: [{ heartRateZone: 'MODERATE', kcal: 182.2 }],
          },
        }),
      ],
    };
  if (url.includes('/daily-heart-rate-zones/dataPoints'))
    return {
      dataPoints: [
        {
          dailyHeartRateZones: {
            date: { year: 2026, month: 11, day: 3 },
            heartRateZones: [
              { heartRateZoneType: 'MODERATE', minBeatsPerMinute: '115', maxBeatsPerMinute: '131' },
            ],
          },
        },
      ],
    };
  return undefined;
};

/** `count` consecutive one-minute activity-level points of one type. */
const minutePoints = (type: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    activityLevel: {
      interval: {
        startTime: new Date(Date.UTC(2026, 10, 3, 7, 0) + i * 60000).toISOString(),
        endTime: new Date(Date.UTC(2026, 10, 3, 7, 1) + i * 60000).toISOString(),
      },
      activityLevelType: type,
    },
  }));

describe('get_daily_activity_summary', () => {
  it('assembles a Fitbit-shaped summary with miles and Fitbit zones', async () => {
    route((url) => {
      if (url.includes('/steps/dataPoints:dailyRollUp'))
        return { rollupDataPoints: [rollup('2026-11-03', { steps: { countSum: '9500' } })] };
      if (url.includes('/distance/dataPoints:dailyRollUp'))
        return { rollupDataPoints: [rollup('2026-11-03', { distance: { millimetersSum: '8046720' } })] };
      if (url.includes('/total-calories/dataPoints:dailyRollUp'))
        return { rollupDataPoints: [rollup('2026-11-03', { totalCalories: { kcalSum: 2301.6 } })] };
      if (url.includes('/floors/dataPoints:dailyRollUp'))
        return { rollupDataPoints: [rollup('2026-11-03', { floors: { countSum: '12' } })] };
      if (url.includes('/activity-level/dataPoints?'))
        return {
          dataPoints: [
            ...minutePoints('SEDENTARY', 600),
            ...minutePoints('LIGHTLY_ACTIVE', 200),
            ...minutePoints('MODERATELY_ACTIVE', 30),
            ...minutePoints('VERY_ACTIVE', 10),
          ],
        };
      if (url.includes('/daily-resting-heart-rate/dataPoints'))
        return {
          dataPoints: [
            { dailyRestingHeartRate: { date: { year: 2026, month: 11, day: 3 }, beatsPerMinute: '76' } },
          ],
        };
      return zoneRoutes(url);
    });

    const res = await json(setup().get_daily_activity_summary({ date: '2026-11-03' }));
    expect(res.activities).toEqual([]);
    expect(res.summary).toMatchObject({
      caloriesOut: 2302,
      steps: 9500,
      distances: [{ activity: 'total', distance: 5 }],
      floors: 12,
      sedentaryMinutes: 1200,
      lightlyActiveMinutes: 200,
      fairlyActiveMinutes: 30,
      veryActiveMinutes: 10,
      restingHeartRate: 76,
    });
    // activity-level has no dailyRollUp: it must be listed with a civil-day filter instead
    const urls = fetchMock().mock.calls.map((c) => decodeURIComponent(String(c[0])));
    expect(urls.some((u) => u.includes('/activity-level/dataPoints:dailyRollUp'))).toBe(false);
    const list = urls.find((u) => u.includes('/activity-level/dataPoints?'))!;
    expect(list).toContain('activity_level.interval.civil_start_time >= "2026-11-03T00:00:00"');
    expect(list).toContain('activity_level.interval.civil_start_time < "2026-11-04T00:00:00"');
    expect(res.summary.heartRateZones).toEqual([
      { name: 'Out of Range', minutes: 1282 },
      { name: 'Fat Burn', min: 115, max: 131, minutes: 51, caloriesOut: 182 },
      { name: 'Cardio', minutes: 14 },
      { name: 'Peak', minutes: 0 },
    ]);
    // zone data is fetched for the requested day only, with an exclusive end
    const azm = fetchMock().mock.calls.find((c) => String(c[0]).includes('/active-zone-minutes/'))!;
    expect(bodyOf(azm[1]).range.end.date).toEqual({ year: 2026, month: 11, day: 4 });
  });

  it('adds a note instead of silently dropping activity minutes when listing fails', async () => {
    fetchMock().mockImplementation(async (rawUrl: string) => {
      const url = decodeURIComponent(rawUrl);
      if (url.includes('/activity-level/')) {
        return { ok: false, status: 500, text: async () => 'boom' };
      }
      const body = url.includes('/steps/dataPoints:dailyRollUp')
        ? { rollupDataPoints: [rollup('2026-11-03', { steps: { countSum: '100' } })] }
        : url.includes('/users/me/settings')
          ? SETTINGS
          : {};
      return { ok: true, status: 200, json: async () => body };
    });
    const res = await json(setup().get_daily_activity_summary({ date: '2026-11-03' }));
    expect(res.summary.steps).toBe(100);
    expect(res.summary.fairlyActiveMinutes).toBeUndefined();
    expect(res._compat.notes.join(' ')).toContain('activity minutes unavailable');
  });

  it('reports no data when steps, distance and calories are all empty', async () => {
    route();
    expect(await text(setup().get_daily_activity_summary({ date: '2026-11-03' }))).toContain(
      'No data found'
    );
  });

  it('still returns the summary, with a note, when zone sources fail', async () => {
    fetchMock().mockImplementation(async (rawUrl: string) => {
      const url = decodeURIComponent(rawUrl);
      if (url.includes('/active-zone-minutes/') || url.includes('/time-in-heart-rate-zone/')) {
        return { ok: false, status: 500, text: async () => 'boom' };
      }
      const body = url.includes('/steps/dataPoints:dailyRollUp')
        ? { rollupDataPoints: [rollup('2026-11-03', { steps: { countSum: '100' } })] }
        : url.includes('/users/me/settings')
          ? SETTINGS
          : {};
      return { ok: true, status: 200, json: async () => body };
    });
    const res = await json(setup().get_daily_activity_summary({ date: '2026-11-03' }));
    expect(res.summary.steps).toBe(100);
    expect(res.summary.heartRateZones).toBeUndefined();
    expect(res._compat.notes[0]).toContain('heartRateZones unavailable');
  });
});

describe('heart rate tools', () => {
  const resting = (day: number, bpm: number) => ({
    dailyRestingHeartRate: { date: { year: 2026, month: 11, day }, beatsPerMinute: String(bpm) },
  });

  it('returns Fitbit activities-heart entries for a period', async () => {
    route((url) => {
      if (url.includes('/daily-resting-heart-rate/dataPoints'))
        return { dataPoints: [resting(3, 77), resting(4, 76)] };
      return undefined;
    });
    const res = await json(setup().get_heart_rate({ period: '7d', date: '2026-11-04' }));
    expect(res['activities-heart']).toHaveLength(2);
    expect(res['activities-heart'][1]).toEqual({
      dateTime: '2026-11-04',
      value: { customHeartRateZones: [], restingHeartRate: 76 },
    });
    const restCall = calls().find((u) => u.includes('/daily-resting-heart-rate/dataPoints'))!;
    expect(restCall).toContain('daily_resting_heart_rate.date >= "2026-10-29"');
    expect(restCall).toContain('daily_resting_heart_rate.date < "2026-11-05"');
  });

  it('includes Fitbit zones alongside resting heart rate, for any range length', async () => {
    route((url) =>
      url.includes('/daily-resting-heart-rate/dataPoints') ? { dataPoints: [resting(3, 80)] } : zoneRoutes(url)
    );
    const res = await json(
      setup().get_heart_rate_by_date_range({ startDate: '2026-10-01', endDate: '2026-11-04' })
    );
    expect(res['activities-heart']).toHaveLength(1);
    const [day] = res['activities-heart'];
    expect(day.dateTime).toBe('2026-11-03');
    expect(day.value.restingHeartRate).toBe(80);
    expect(day.value.heartRateZones[1]).toMatchObject({ name: 'Fat Burn', minutes: 51 });
    expect(res._compat).toBeUndefined();
  });

  it('reports no data when there is nothing for the range', async () => {
    route();
    expect(
      await text(setup().get_heart_rate_by_date_range({ startDate: '2026-11-04', endDate: '2026-11-04' }))
    ).toContain('No data found');
  });
});

describe('HRV tools', () => {
  it('returns Fitbit hrv entries with an inclusive end date', async () => {
    route((url) =>
      url.includes('/daily-heart-rate-variability/dataPoints')
        ? {
            dataPoints: [
              {
                dailyHeartRateVariability: {
                  date: { year: 2026, month: 11, day: 4 },
                  averageHeartRateVariabilityMilliseconds: 17.5,
                  deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds: 20,
                },
              },
            ],
          }
        : undefined
    );
    const res = await json(setup().get_hrv_by_date_range({ startDate: '2026-11-01', endDate: '2026-11-04' }));
    expect(res.hrv).toEqual([{ dateTime: '2026-11-04', value: { dailyRmssd: 17.5, deepRmssd: 20 } }]);
    const call = calls().find((u) => u.includes('/daily-heart-rate-variability/dataPoints'))!;
    expect(call).toContain('daily_heart_rate_variability.date < "2026-11-05"');
  });

  it('get_hrv queries a single day', async () => {
    route();
    await setup().get_hrv({ date: '2026-11-04' });
    const call = calls().find((u) => u.includes('/daily-heart-rate-variability/dataPoints'))!;
    expect(call).toContain('>= "2026-11-04"');
    expect(call).toContain('< "2026-11-05"');
  });

  it('rejects ranges over 30 days', async () => {
    route();
    const res = await setup().get_hrv_by_date_range({ startDate: '2026-09-01', endDate: '2026-11-04' });
    expect(res.isError).toBe(true);
  });
});

describe('get_activity_timeseries', () => {
  it('zero-fills missing days and returns string values in miles', async () => {
    route((url) =>
      url.includes('/distance/dataPoints:dailyRollUp')
        ? { rollupDataPoints: [rollup('2026-11-02', { distance: { millimetersSum: '1609344' } })] }
        : undefined
    );
    const res = await json(
      setup().get_activity_timeseries({
        resourcePath: 'tracker/distance',
        startDate: '2026-11-01',
        endDate: '2026-11-03',
      })
    );
    expect(res['activities-tracker-distance']).toEqual([
      { dateTime: '2026-11-01', value: '0' },
      { dateTime: '2026-11-02', value: '1' },
      { dateTime: '2026-11-03', value: '0' },
    ]);
  });

  it('maps calories to total-calories and rejects caloriesBMR', async () => {
    route((url) =>
      url.includes('/total-calories/dataPoints:dailyRollUp')
        ? { rollupDataPoints: [rollup('2026-11-01', { totalCalories: { kcalSum: 2000.4 } })] }
        : undefined
    );
    const handlers = setup();
    const res = await json(
      handlers.get_activity_timeseries({ resourcePath: 'calories', startDate: '2026-11-01', endDate: '2026-11-01' })
    );
    expect(res['activities-calories']).toEqual([{ dateTime: '2026-11-01', value: '2000' }]);

    const bmr = await handlers.get_activity_timeseries({
      resourcePath: 'caloriesBMR',
      startDate: '2026-11-01',
      endDate: '2026-11-01',
    });
    expect(bmr.isError).toBe(true);
  });

  it('POSTs an exclusive end date to the roll-up', async () => {
    route();
    await setup().get_activity_timeseries({
      resourcePath: 'steps',
      startDate: '2026-11-01',
      endDate: '2026-11-03',
    });
    const call = fetchMock().mock.calls.find((c) => String(c[0]).includes('/steps/dataPoints:dailyRollUp'))!;
    expect(bodyOf(call[1]).range.end.date).toEqual({ year: 2026, month: 11, day: 4 });
  });
});

describe('get_azm_timeseries', () => {
  it('returns Fitbit-shaped Active Zone Minutes with a total', async () => {
    route((url) =>
      url.includes('/active-zone-minutes/dataPoints:dailyRollUp')
        ? {
            rollupDataPoints: [
              rollup('2026-11-02', {
                activeZoneMinutes: {
                  sumInFatBurnHeartZone: '20',
                  sumInCardioHeartZone: '10',
                  sumInPeakHeartZone: '4',
                },
              }),
            ],
          }
        : undefined
    );
    const res = await json(setup().get_azm_timeseries({ startDate: '2026-11-01', endDate: '2026-11-03' }));
    expect(res['activities-active-zone-minutes']).toEqual([
      {
        dateTime: '2026-11-02',
        value: {
          activeZoneMinutes: 34,
          fatBurnActiveZoneMinutes: 20,
          cardioActiveZoneMinutes: 10,
          peakActiveZoneMinutes: 4,
        },
      },
    ]);
  });
});

describe('nutrition tools', () => {
  const nutritionRollup = rollup('2026-11-03', {
    nutritionLog: {
      energy: { kcalSum: 1850 },
      totalFat: { gramsSum: 60 },
      totalCarbohydrate: { gramsSum: 210 },
      nutrients: [{ nutrient: 'PROTEIN', quantity: { gramsSum: 130 } }],
    },
  });

  it('get_food_log returns a Fitbit summary', async () => {
    route((url) =>
      url.includes('/nutrition-log/dataPoints:dailyRollUp') ? { rollupDataPoints: [nutritionRollup] } : undefined
    );
    const res = await json(setup().get_food_log({ date: '2026-11-03' }));
    expect(res.foods).toEqual([]);
    expect(res.summary).toMatchObject({ calories: 1850, fat: 60, carbs: 210, protein: 130, water: 0 });
  });

  it('get_nutrition returns foods-log-caloriesIn as strings, zero-filled', async () => {
    route((url) =>
      url.includes('/nutrition-log/dataPoints:dailyRollUp') ? { rollupDataPoints: [nutritionRollup] } : undefined
    );
    const res = await json(
      setup().get_nutrition({ resource: 'caloriesIn', period: '7d', date: '2026-11-03' })
    );
    const series = res['foods-log-caloriesIn'];
    expect(series).toHaveLength(7);
    expect(series.at(-1)).toEqual({ dateTime: '2026-11-03', value: '1850' });
    expect(series[0]).toEqual({ dateTime: '2026-10-28', value: '0' });
  });

  it('get_nutrition_by_date_range supports water in the account unit', async () => {
    route((url) =>
      url.includes('/hydration-log/dataPoints:dailyRollUp')
        ? {
            rollupDataPoints: [
              rollup('2026-11-03', { hydrationLog: { amountConsumed: { millilitersSum: 2000 } } }),
            ],
          }
        : undefined
    );
    const res = await json(
      setup().get_nutrition_by_date_range({ resource: 'water', startDate: '2026-11-03', endDate: '2026-11-03' })
    );
    expect(res['foods-log-water']).toEqual([{ dateTime: '2026-11-03', value: '67.6' }]);
  });
});

describe('error handling', () => {
  it('turns HTTP failures into tool errors', async () => {
    fetchMock().mockImplementation(async (rawUrl: string) => {
      if (String(rawUrl).includes('/settings')) {
        return { ok: true, status: 200, json: async () => SETTINGS };
      }
      return { ok: false, status: 403, text: async () => 'forbidden' };
    });
    const res = await setup().get_weight({ period: '1d', date: '2026-11-04' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('HTTP 403');
  });

  it('reports ACCOUNT_NOT_LINKED with the friendly message', async () => {
    fetchMock().mockImplementation(async (rawUrl: string) => {
      if (String(rawUrl).includes('/settings')) {
        return { ok: true, status: 200, json: async () => SETTINGS };
      }
      return { ok: false, status: 400, text: async () => '{"reason":"ACCOUNT_NOT_LINKED"}' };
    });
    const res = await setup().get_hrv({ date: '2026-11-04' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('not linked to Google Health');
  });
});
