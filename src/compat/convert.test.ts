import { describe, it, expect } from 'vitest';
import {
  addDays,
  activityLevelMinutes,
  buildFitbitZones,
  convertDistance,
  convertWater,
  convertWeight,
  eachDate,
  inclusiveDays,
  mapHrv,
  mapSleep,
  mapWeight,
  nutritionSummary,
  periodStartDate,
  restingHeartRateByDate,
  todayInZone,
  utcToLocalIso,
  zoneBoundsByDate,
  zonedMidnightIso,
  type SleepPoint,
} from './convert.js';

describe('units', () => {
  it('converts grams to pounds like Fitbit (one decimal)', () => {
    expect(convertWeight(98430, 'WEIGHT_UNIT_POUNDS')).toBe(217);
    expect(convertWeight(84500, 'WEIGHT_UNIT_POUNDS')).toBe(186.3);
  });

  it('honours kilogram and stone settings, defaulting to pounds', () => {
    expect(convertWeight(84500, 'WEIGHT_UNIT_KILOGRAMS')).toBe(84.5);
    expect(convertWeight(63502.93, 'WEIGHT_UNIT_STONE')).toBe(10);
    expect(convertWeight(84500)).toBe(186.3);
  });

  it('converts millimetres to miles (two decimals) or kilometres', () => {
    expect(convertDistance(8_046_720, 'DISTANCE_UNIT_MILES')).toBe(5);
    expect(convertDistance(5_000_000, 'DISTANCE_UNIT_KILOMETERS')).toBe(5);
  });

  it('converts millilitres to fluid ounces by default account unit', () => {
    expect(convertWater(2000, 'WATER_UNIT_FL_OZ')).toBe(67.6);
    expect(convertWater(2000, 'WATER_UNIT_MILLILITERS')).toBe(2000);
  });
});

describe('dates', () => {
  it('adds days and lists inclusive ranges', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(inclusiveDays('2026-11-01', '2026-11-03')).toBe(3);
    expect(eachDate('2026-11-01', '2026-11-03')).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
    ]);
  });

  it('computes Fitbit-style periods ending on a date (inclusive)', () => {
    expect(periodStartDate('2026-11-04', '1d')).toBe('2026-11-04');
    expect(periodStartDate('2026-11-04', '7d')).toBe('2026-10-29');
    expect(periodStartDate('2026-11-04', '1w')).toBe('2026-10-29');
    expect(periodStartDate('2026-11-04', '30d')).toBe('2026-10-06');
    expect(periodStartDate('2026-11-04', '1m')).toBe('2026-10-05');
    expect(periodStartDate('2026-11-04', '1y')).toBe('2025-11-05');
    expect(() => periodStartDate('2026-11-04', 'abc')).toThrow();
  });

  it('finds local midnight in a time zone, including DST', () => {
    expect(zonedMidnightIso('2026-11-04', 'America/Denver')).toBe('2026-11-04T07:00:00.000Z');
    expect(zonedMidnightIso('2026-07-04', 'America/Denver')).toBe('2026-07-04T06:00:00.000Z');
    // DST ends 2026-11-01 in the US
    expect(zonedMidnightIso('2026-11-01', 'America/Denver')).toBe('2026-11-01T06:00:00.000Z');
    expect(zonedMidnightIso('2026-11-02', 'America/Denver')).toBe('2026-11-02T07:00:00.000Z');
  });

  it("gives today's civil date in the user's zone", () => {
    const now = new Date('2026-11-05T03:30:00Z'); // still Nov 4 in Denver
    expect(todayInZone('America/Denver', now)).toBe('2026-11-04');
    expect(todayInZone('UTC', now)).toBe('2026-11-05');
  });

  it('applies UTC offsets to produce local time', () => {
    expect(utcToLocalIso('2026-11-04T05:15:30Z', '-25200s')).toBe('2026-11-03T22:15:30.000');
  });

});

describe('mapWeight', () => {
  it('maps weight points to a Fitbit weight log in pounds', () => {
    const body = mapWeight(
      [
        {
          name: 'users/1/dataTypes/weight/dataPoints/1747612799000',
          weight: {
            weightGrams: 84500,
            sampleTime: {
              physicalTime: '2026-11-04T13:00:00Z',
              civilTime: {
                date: { year: 2026, month: 11, day: 4 },
                time: { hours: 6, minutes: 5, seconds: 9 },
              },
            },
          },
        },
        {
          name: 'users/1/dataTypes/weight/dataPoints/1',
          weight: {
            weightGrams: 85000,
            sampleTime: {
              civilTime: {
                date: { year: 2026, month: 11, day: 3 },
                time: { hours: 6 },
              },
            },
          },
        },
      ],
      'WEIGHT_UNIT_POUNDS'
    );
    expect(body.weight).toEqual([
      { date: '2026-11-03', logId: 1, source: 'API', time: '06:00:00', weight: 187.4 },
      { date: '2026-11-04', logId: 1747612799000, source: 'API', time: '06:05:09', weight: 186.3 },
    ]);
  });

  it('collapses duplicate weigh-ins, preferring non-Health-Connect copies and local time from the offset', () => {
    const point = (
      id: string,
      platform: string,
      grams: number,
      offset: string,
      civilHour: number
    ) => ({
      name: `users/1/dataTypes/weight/dataPoints/${id}`,
      dataSource: { platform },
      weight: {
        weightGrams: grams,
        sampleTime: {
          physicalTime: '2026-11-04T13:39:53Z',
          utcOffset: offset,
          civilTime: {
            date: { year: 2026, month: 11, day: 4 },
            time: { hours: civilHour, minutes: 39, seconds: 53 },
          },
        },
      },
    });
    const body = mapWeight(
      [
        point('7206544662721262320', 'HEALTH_CONNECT', 89721, '0s', 13),
        point('4546282274585110376', 'GOOGLE_WEB_API', 89720, '-25200s', 6),
        point('6976750944940895425', 'GOOGLE_WEB_API', 89720, '-25200s', 6),
      ],
      'WEIGHT_UNIT_POUNDS'
    );
    expect(body.weight).toEqual([
      {
        date: '2026-11-04',
        logId: '4546282274585110376', // beyond Number.MAX_SAFE_INTEGER, kept as a string
        source: 'API',
        time: '06:39:53',
        weight: 197.8,
      },
    ]);
  });

  it('skips points without a weight or date', () => {
    expect(mapWeight([{}, { weight: {} }]).weight).toEqual([]);
  });
});

describe('mapSleep', () => {
  const stagesSleep: SleepPoint = {
    name: 'users/1/dataTypes/sleep/dataPoints/42',
    sleep: {
      type: 'STAGES',
      interval: {
        startTime: '2026-11-04T05:00:00Z',
        endTime: '2026-11-04T13:00:00Z',
        startUtcOffset: '-25200s',
        endUtcOffset: '-25200s',
        civilStartTime: {
          date: { year: 2026, month: 11, day: 3 },
          time: { hours: 22, minutes: 0 },
        },
        civilEndTime: {
          date: { year: 2026, month: 11, day: 4 },
          time: { hours: 6, minutes: 0 },
        },
      },
      stages: [
        { type: 'LIGHT', startTime: '2026-11-04T05:00:00Z', endTime: '2026-11-04T05:30:00Z', startUtcOffset: '-25200s' },
        { type: 'DEEP', startTime: '2026-11-04T05:30:00Z', endTime: '2026-11-04T06:30:00Z', startUtcOffset: '-25200s' },
      ],
      summary: {
        minutesAsleep: '450',
        minutesAwake: '30',
        minutesInSleepPeriod: '480',
        minutesToFallAsleep: '8',
        stagesSummary: [
          { type: 'DEEP', minutes: '90', count: '3' },
          { type: 'LIGHT', minutes: '250', count: '20' },
          { type: 'REM', minutes: '110', count: '5' },
          { type: 'AWAKE', minutes: '30', count: '12' },
        ],
      },
      metadata: { mainSleep: true },
    },
  };

  it('maps a stages sleep session to a Fitbit sleep log', () => {
    const [log] = mapSleep([stagesSleep]).sleep;
    expect(log).toMatchObject({
      logId: 42,
      dateOfSleep: '2026-11-04',
      startTime: '2026-11-03T22:00:00.000',
      endTime: '2026-11-04T06:00:00.000',
      duration: 480 * 60_000,
      minutesAsleep: 450,
      minutesAwake: 30,
      minutesToFallAsleep: 8,
      timeInBed: 480,
      isMainSleep: true,
      type: 'stages',
    });
    expect(log.levels.summary).toEqual({
      deep: { count: 3, minutes: 90 },
      light: { count: 20, minutes: 250 },
      rem: { count: 5, minutes: 110 },
      wake: { count: 12, minutes: 30 },
    });
    expect(log.levels.data).toEqual([
      { dateTime: '2026-11-03T22:00:00.000', level: 'light', seconds: 1800 },
      { dateTime: '2026-11-03T22:30:00.000', level: 'deep', seconds: 3600 },
    ]);
  });

  it('maps classic sleep and zero-fills missing stages', () => {
    const [log] = mapSleep([
      {
        sleep: {
          type: 'CLASSIC',
          interval: {
            civilEndTime: { date: { year: 2026, month: 11, day: 4 }, time: {} },
          },
          summary: {
            minutesInSleepPeriod: '60',
            stagesSummary: [{ type: 'ASLEEP', minutes: '55', count: '1' }],
          },
          metadata: { nap: true },
        },
      },
    ]).sleep;
    expect(log.type).toBe('classic');
    expect(log.isMainSleep).toBe(false);
    expect(log.levels.summary).toEqual({
      awake: { count: 0, minutes: 0 },
      asleep: { count: 1, minutes: 55 },
      restless: { count: 0, minutes: 0 },
    });
  });

  it('derives the wake date and local times from instants when civil times are absent', () => {
    const [log] = mapSleep([
      {
        name: 'users/1/dataTypes/sleep/dataPoints/4719381134148517880',
        sleep: {
          type: 'STAGES',
          interval: {
            startTime: '2026-11-04T05:53:00Z',
            startUtcOffset: '-25200s',
            endTime: '2026-11-04T12:43:00Z',
            endUtcOffset: '-25200s',
          },
          summary: { minutesInSleepPeriod: '410', minutesAsleep: '390' },
        },
      },
    ]).sleep;
    expect(log.dateOfSleep).toBe('2026-11-04');
    expect(log.startTime).toBe('2026-11-03T22:53:00.000');
    expect(log.endTime).toBe('2026-11-04T05:43:00.000');
    expect(log.logId).toBe('4719381134148517880');
  });

  it('orders logs chronologically and drops points with no end date', () => {
    const later: SleepPoint = JSON.parse(JSON.stringify(stagesSleep));
    later.sleep!.interval!.civilStartTime = { date: { year: 2026, month: 11, day: 4 }, time: { hours: 14 } };
    later.sleep!.interval!.civilEndTime = { date: { year: 2026, month: 11, day: 4 }, time: { hours: 15 } };
    const logs = mapSleep([later, stagesSleep, {}]).sleep;
    expect(logs).toHaveLength(2);
    expect(logs[0].startTime).toBe('2026-11-03T22:00:00.000');
  });
});

describe('mapHrv and resting heart rate', () => {
  it('maps daily HRV to Fitbit dailyRmssd/deepRmssd', () => {
    const body = mapHrv([
      {
        dailyHeartRateVariability: {
          date: { year: 2026, month: 11, day: 4 },
          averageHeartRateVariabilityMilliseconds: 18.123456,
          deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds: 21.5,
        },
      },
      {
        dailyHeartRateVariability: {
          date: { year: 2026, month: 11, day: 3 },
          averageHeartRateVariabilityMilliseconds: 14,
        },
      },
    ]);
    expect(body.hrv).toEqual([
      { dateTime: '2026-11-03', value: { dailyRmssd: 14 } },
      { dateTime: '2026-11-04', value: { dailyRmssd: 18.123, deepRmssd: 21.5 } },
    ]);
  });

  it('indexes resting heart rate by date', () => {
    const map = restingHeartRateByDate([
      { dailyRestingHeartRate: { date: { year: 2026, month: 11, day: 4 }, beatsPerMinute: '76' } },
      { dailyRestingHeartRate: { date: { year: 2026, month: 11, day: 3 }, beatsPerMinute: '0' } },
    ]);
    expect([...map]).toEqual([['2026-11-04', 76]]);
  });
});

describe('Fitbit heart-rate zones', () => {
  // Known day 2026-01-25: the coach stored Fat Burn 51 and Cardio 14 minutes.
  const azm = {
    activeZoneMinutes: {
      sumInFatBurnHeartZone: '51',
      sumInCardioHeartZone: '28',
      sumInPeakHeartZone: '0',
    },
  };
  const timeInZone = {
    timeInHeartRateZone: {
      timeInHeartRateZones: [
        { heartRateZone: 'LIGHT', duration: '76920s' },
        { heartRateZone: 'MODERATE', duration: '3000s' },
        { heartRateZone: 'VIGOROUS', duration: '840s' },
      ],
    },
  };
  const calories = {
    caloriesInHeartRateZone: {
      caloriesInHeartRateZones: [
        { heartRateZone: 'VIGOROUS', kcal: 43.38 },
        { heartRateZone: 'MODERATE', kcal: 182.24 },
        { heartRateZone: 'LIGHT', kcal: 2208.31 },
      ],
    },
  };
  const bounds = zoneBoundsByDate([
    {
      dailyHeartRateZones: {
        date: { year: 2026, month: 1, day: 25 },
        heartRateZones: [
          { heartRateZoneType: 'LIGHT', minBeatsPerMinute: '30', maxBeatsPerMinute: '114' },
          { heartRateZoneType: 'MODERATE', minBeatsPerMinute: '115', maxBeatsPerMinute: '131' },
          { heartRateZoneType: 'VIGOROUS', minBeatsPerMinute: '132', maxBeatsPerMinute: '153' },
          { heartRateZoneType: 'PEAK', minBeatsPerMinute: '154', maxBeatsPerMinute: '220' },
        ],
      },
    },
  ]).get('2026-01-25');

  it('maps Light/Moderate/Vigorous/Peak to Out of Range/Fat Burn/Cardio/Peak', () => {
    expect(buildFitbitZones({ azm, timeInZone, calories, bounds })).toEqual([
      { name: 'Out of Range', min: 30, max: 114, minutes: 1282, caloriesOut: 2208 },
      { name: 'Fat Burn', min: 115, max: 131, minutes: 51, caloriesOut: 182 },
      { name: 'Cardio', min: 132, max: 153, minutes: 14, caloriesOut: 43 },
      { name: 'Peak', min: 154, max: 220, minutes: 0 },
    ]);
  });

  it('falls back to time-in-zone minutes when Active Zone Minutes are missing', () => {
    const zones = buildFitbitZones({ timeInZone })!;
    expect(zones.map((z) => z.minutes)).toEqual([1282, 50, 14, 0]);
    expect(zones[0].min).toBeUndefined();
  });

  it('returns null when the day has no zone data', () => {
    expect(buildFitbitZones({ calories })).toBeNull();
  });
});

describe('daily rollup helpers', () => {
  it('sums per-minute activity levels into Fitbit minute fields', () => {
    const point = (type: string, from: string, to: string) => ({
      activityLevel: {
        interval: { startTime: `2026-11-03T${from}:00Z`, endTime: `2026-11-03T${to}:00Z` },
        activityLevelType: type,
      },
    });
    expect(
      activityLevelMinutes([
        point('SEDENTARY', '07:00', '08:00'),
        point('LIGHTLY_ACTIVE', '08:00', '08:30'),
        point('LIGHTLY_ACTIVE', '09:00', '09:15'),
        point('MODERATELY_ACTIVE', '08:30', '08:50'),
        point('VERY_ACTIVE', '08:50', '09:00'),
      ])
    ).toEqual({
      // sedentary is the rest of the day, as Fitbit counts sleep and off-wrist time
      sedentaryMinutes: 1440 - 45 - 20 - 10,
      lightlyActiveMinutes: 45,
      fairlyActiveMinutes: 20,
      veryActiveMinutes: 10,
    });
  });

  it('returns null without usable activity-level points', () => {
    expect(activityLevelMinutes([])).toBeNull();
    expect(activityLevelMinutes([{ activityLevel: { activityLevelType: 'SEDENTARY' } }])).toBeNull();
  });

  it('builds the Fitbit food summary with sodium in mg', () => {
    expect(
      nutritionSummary({
        nutritionLog: {
          energy: { kcalSum: 1801.6 },
          totalFat: { gramsSum: 60.04 },
          totalCarbohydrate: { gramsSum: 200 },
          nutrients: [
            { nutrient: 'PROTEIN', quantity: { gramsSum: 120.26 } },
            { nutrient: 'DIETARY_FIBER', quantity: { gramsSum: 31 } },
            { nutrient: 'SODIUM', quantity: { gramsSum: 2.1 } },
          ],
        },
      })
    ).toEqual({ calories: 1802, carbs: 200, fat: 60, fiber: 31, protein: 120.3, sodium: 2100 });
    expect(nutritionSummary({})).toBeNull();
  });
});
