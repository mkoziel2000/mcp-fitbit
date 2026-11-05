import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GOOGLE_HEALTH_API_BASE } from './config.js';
import { registerWeightTool } from './weight.js';
import { registerSleepTool } from './sleep.js';
import { registerActivitiesTool } from './activities.js';
import { registerHeartRateTools } from './heart-rate.js';
import { registerHrvTools } from './hrv.js';
import { registerNutritionTools } from './nutrition.js';
import { registerProfileTool } from './profile.js';
import { registerAccountTools } from './account.js';
import {
  registerDailyActivityTool,
  DAILY_SUMMARY_DATA_TYPES,
} from './daily-activity.js';
import { registerActivityTimeSeriesTool } from './activity-timeseries.js';
import { registerAzmTimeSeriesTool } from './azm-timeseries.js';
import { registerDataPointTools } from './data-points.js';

global.fetch = vi.fn();
const fetchMock = () => fetch as ReturnType<typeof vi.fn>;

type Handler = (params: Record<string, unknown>) => Promise<{
  content: { text: string }[];
  isError?: boolean;
}>;

function setup(
  register: (s: McpServer, t: () => Promise<string | null>) => void
) {
  const handlers: Record<string, Handler> = {};
  const schemas: Record<string, Record<string, unknown>> = {};
  const server = {
    tool: (
      name: string,
      _d: string,
      schema: Record<string, unknown>,
      h: Handler
    ) => {
      handlers[name] = h;
      schemas[name] = schema;
    },
  } as unknown as McpServer;
  register(server, async () => 'tok');
  return { handlers, schemas };
}

function ok(body: unknown) {
  fetchMock().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  });
}

const lastUrl = () =>
  decodeURIComponent(fetchMock().mock.calls.at(-1)![0] as string);
const lastInit = () => fetchMock().mock.calls.at(-1)![1];
const base = GOOGLE_HEALTH_API_BASE;

describe('Named tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('get_weight filters on physical sample time', async () => {
    ok({ dataPoints: [{ w: 1 }] });
    const { handlers } = setup(registerWeightTool);
    await handlers.get_weight({
      startTime: '2026-03-01T00:00:00Z',
      endTime: '2026-03-08T00:00:00Z',
      pageSize: 10,
    });
    expect(lastUrl()).toBe(
      `${base}/users/me/dataTypes/weight/dataPoints?filter=weight.sample_time.physical_time >= "2026-03-01T00:00:00Z" AND weight.sample_time.physical_time < "2026-03-08T00:00:00Z"&pageSize=10`
    );
  });

  it('get_sleep_by_date_range filters on civil end time', async () => {
    ok({ dataPoints: [{}] });
    const { handlers } = setup(registerSleepTool);
    await handlers.get_sleep_by_date_range({ startTime: '2026-03-03' });
    expect(lastUrl()).toBe(
      `${base}/users/me/dataTypes/sleep/dataPoints?filter=sleep.interval.civil_end_time >= "2026-03-03"`
    );
  });

  it('get_exercises filters on civil start time', async () => {
    ok({ dataPoints: [{}] });
    const { handlers } = setup(registerActivitiesTool);
    await handlers.get_exercises({
      startTime: '2026-02-22T00:00:00',
      pageToken: 'next',
    });
    expect(lastUrl()).toBe(
      `${base}/users/me/dataTypes/exercise/dataPoints?filter=exercise.interval.civil_start_time >= "2026-02-22T00:00:00"&pageToken=next`
    );
  });

  it('heart rate tools list samples and roll up daily', async () => {
    ok({ dataPoints: [{}], rollupDataPoints: [{}] });
    const { handlers } = setup(registerHeartRateTools);
    await handlers.get_heart_rate({ startTime: '2026-03-01T00:00:00Z' });
    expect(lastUrl()).toContain(
      '/dataTypes/heart-rate/dataPoints?filter=heart_rate.sample_time.physical_time >= "2026-03-01T00:00:00Z"'
    );

    await handlers.get_heart_rate_by_date_range({
      startDate: '2026-03-01',
      endDate: '2026-03-08',
    });
    expect(lastUrl()).toBe(
      `${base}/users/me/dataTypes/heart-rate/dataPoints:dailyRollUp`
    );
    expect(lastInit().method).toBe('POST');
    expect(JSON.parse(lastInit().body).range.end.date).toEqual({
      year: 2026,
      month: 3,
      day: 8,
    });
  });

  it('HRV tools filter on the daily date', async () => {
    ok({ dataPoints: [{}] });
    const { handlers } = setup(registerHrvTools);
    await handlers.get_hrv({ date: '2026-03-04' });
    expect(lastUrl()).toBe(
      `${base}/users/me/dataTypes/daily-heart-rate-variability/dataPoints?filter=daily_heart_rate_variability.date >= "2026-03-04" AND daily_heart_rate_variability.date < "2026-03-05"`
    );

    await handlers.get_hrv_by_date_range({
      startDate: '2026-03-01',
      endDate: '2026-03-08',
    });
    expect(lastUrl()).toContain(
      'daily_heart_rate_variability.date >= "2026-03-01" AND daily_heart_rate_variability.date < "2026-03-08"'
    );
  });

  it('nutrition tools list the food log and roll up', async () => {
    ok({ dataPoints: [{}], rollupDataPoints: [{}] });
    const { handlers } = setup(registerNutritionTools);
    await handlers.get_food_log({ startTime: '2026-03-04' });
    expect(lastUrl()).toContain(
      '/dataTypes/nutrition-log/dataPoints?filter=nutrition_log.interval.civil_start_time >= "2026-03-04"'
    );

    await handlers.get_nutrition({
      dataType: 'hydration-log',
      date: '2026-03-04',
    });
    expect(lastUrl()).toBe(
      `${base}/users/me/dataTypes/hydration-log/dataPoints:dailyRollUp`
    );
    expect(JSON.parse(lastInit().body).range.end.date.day).toBe(5);

    await handlers.get_nutrition_by_date_range({
      dataType: 'nutrition-log',
      startDate: '2026-03-01',
      endDate: '2026-03-08',
    });
    expect(lastUrl()).toContain(
      '/dataTypes/nutrition-log/dataPoints:dailyRollUp'
    );
  });

  it('account tools call identity, settings, devices and profile', async () => {
    ok({ x: 1 });
    const { handlers } = setup(registerAccountTools);
    await handlers.get_identity({});
    expect(lastUrl()).toBe(`${base}/users/me/identity`);
    await handlers.get_settings({});
    expect(lastUrl()).toBe(`${base}/users/me/settings`);
    await handlers.list_paired_devices({});
    expect(lastUrl()).toBe(`${base}/users/me/pairedDevices`);

    const profile = setup(registerProfileTool);
    await profile.handlers.get_profile({});
    expect(lastUrl()).toBe(`${base}/users/me/profile`);
  });

  it('activity and AZM tools roll up per day', async () => {
    ok({ rollupDataPoints: [{}] });
    const ts = setup(registerActivityTimeSeriesTool);
    await ts.handlers.get_activity_timeseries({
      dataType: 'steps',
      startDate: '2026-03-01',
      endDate: '2026-03-08',
    });
    expect(lastUrl()).toBe(
      `${base}/users/me/dataTypes/steps/dataPoints:dailyRollUp`
    );

    const azm = setup(registerAzmTimeSeriesTool);
    await azm.handlers.get_azm_timeseries({
      startDate: '2026-03-01',
      endDate: '2026-03-08',
    });
    expect(lastUrl()).toBe(
      `${base}/users/me/dataTypes/active-zone-minutes/dataPoints:dailyRollUp`
    );
  });

  it('daily summary fans out one roll-up per data type', async () => {
    ok({ rollupDataPoints: [{}] });
    const { handlers } = setup(registerDailyActivityTool);
    const result = await handlers.get_daily_activity_summary({
      date: '2026-03-04',
    });
    expect(fetchMock()).toHaveBeenCalledTimes(DAILY_SUMMARY_DATA_TYPES.length);
    const parsed = JSON.parse(result.content[0].text);
    expect(Object.keys(parsed)).toEqual([...DAILY_SUMMARY_DATA_TYPES]);
  });

  it('daily summary reports partial failures per key', async () => {
    fetchMock().mockImplementation(async (url: string) =>
      url.includes('/steps/')
        ? { ok: false, status: 403, text: async () => 'denied' }
        : {
            ok: true,
            status: 200,
            json: async () => ({ rollupDataPoints: [{}] }),
          }
    );
    const { handlers } = setup(registerDailyActivityTool);
    const result = await handlers.get_daily_activity_summary({
      date: '2026-03-04',
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.steps.error).toContain('HTTP 403');
    expect(parsed.distance.rollupDataPoints).toBeDefined();
  });

  it('daily summary is an error when every call fails', async () => {
    fetchMock().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'bad',
    });
    const { handlers } = setup(registerDailyActivityTool);
    const result = await handlers.get_daily_activity_summary({
      date: '2026-03-04',
    });
    expect(result.isError).toBe(true);
  });

  it('generic data point tools pass the raw filter through', async () => {
    ok({ dataPoints: [{}] });
    const { handlers } = setup(registerDataPointTools);
    await handlers.list_data_points({
      dataType: 'body-fat',
      filter: 'f',
      pageSize: 3,
    });
    expect(lastUrl()).toBe(
      `${base}/users/me/dataTypes/body-fat/dataPoints?filter=f&pageSize=3`
    );

    await handlers.reconcile_data_points({
      dataType: 'sleep',
      dataSourceFamily: 'users/me/dataSourceFamilies/google-wearables',
    });
    expect(lastUrl()).toBe(
      `${base}/users/me/dataTypes/sleep/dataPoints:reconcile?dataSourceFamily=users/me/dataSourceFamilies/google-wearables`
    );
  });

  it('reports API failures as error responses', async () => {
    fetchMock().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'nope',
    });
    const { handlers } = setup(registerWeightTool);
    const result = await handlers.get_weight({
      startTime: '2026-03-01T00:00:00Z',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('HTTP 403');
  });

  it('validates time formats in tool schemas', () => {
    const { schemas } = setup(registerSleepTool);
    const startTime = schemas.get_sleep_by_date_range.startTime as {
      safeParse: (v: string) => { success: boolean };
    };
    expect(startTime.safeParse('2026-03-04').success).toBe(true);
    expect(startTime.safeParse('2026-03-04T10:00:00').success).toBe(true);
    expect(startTime.safeParse('2026-03-04T10:00:00Z').success).toBe(false);

    const weight = setup(registerWeightTool).schemas.get_weight.startTime as {
      safeParse: (v: string) => { success: boolean };
    };
    expect(weight.safeParse('2026-03-04T00:00:00Z').success).toBe(true);
    expect(weight.safeParse('2026-03-04').success).toBe(false);
  });
});
