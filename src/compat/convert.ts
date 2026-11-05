/**
 * Pure conversion helpers for the Fitbit-compatible output mode.
 *
 * These map Google Health API response shapes and units onto the shapes and
 * units the legacy Fitbit Web API returned, so existing consumers (e.g. the
 * "Heather's Coach" project) keep working. No network access happens here.
 */

// === Google response shapes (only the fields we read) ===

export interface CivilDateTime {
  date?: { year?: number; month?: number; day?: number };
  time?: { hours?: number; minutes?: number; seconds?: number };
}

interface DataSource {
  platform?: string;
}

export interface WeightPoint {
  name?: string;
  dataSource?: DataSource;
  weight?: {
    weightGrams?: number;
    sampleTime?: {
      physicalTime?: string;
      utcOffset?: string;
      civilTime?: CivilDateTime;
    };
  };
}

interface SleepStage {
  type?: string;
  startTime?: string;
  endTime?: string;
  startUtcOffset?: string;
}

export interface SleepPoint {
  name?: string;
  sleep?: {
    type?: string;
    interval?: {
      startTime?: string;
      endTime?: string;
      startUtcOffset?: string;
      endUtcOffset?: string;
      civilStartTime?: CivilDateTime;
      civilEndTime?: CivilDateTime;
    };
    stages?: SleepStage[];
    summary?: {
      minutesAsleep?: string | number;
      minutesAwake?: string | number;
      minutesInSleepPeriod?: string | number;
      minutesToFallAsleep?: string | number;
      minutesAfterWakeUp?: string | number;
      stagesSummary?: {
        type?: string;
        minutes?: string | number;
        count?: string | number;
      }[];
    };
    metadata?: { mainSleep?: boolean; nap?: boolean };
  };
}

export interface HrvPoint {
  dailyHeartRateVariability?: {
    date?: { year?: number; month?: number; day?: number };
    averageHeartRateVariabilityMilliseconds?: number;
    deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds?: number;
  };
}

export interface RestingHrPoint {
  dailyRestingHeartRate?: {
    date?: { year?: number; month?: number; day?: number };
    beatsPerMinute?: string | number;
  };
}

/** One per-minute `activity-level` data point (list/reconcile only; no roll-up exists). */
export interface ActivityLevelPoint {
  activityLevel?: {
    interval?: { startTime?: string; endTime?: string };
    activityLevelType?: string;
  };
}

export interface RollupPoint {
  civilStartTime?: CivilDateTime;
  steps?: { countSum?: string | number };
  distance?: { millimetersSum?: string | number };
  totalCalories?: { kcalSum?: number };
  activeEnergyBurned?: { kcalSum?: number };
  floors?: { countSum?: string | number };
  activeZoneMinutes?: {
    sumInFatBurnHeartZone?: string | number;
    sumInCardioHeartZone?: string | number;
    sumInPeakHeartZone?: string | number;
  };
  nutritionLog?: {
    energy?: { kcalSum?: number };
    totalFat?: { gramsSum?: number };
    totalCarbohydrate?: { gramsSum?: number };
    nutrients?: { nutrient?: string; quantity?: { gramsSum?: number } }[];
  };
  hydrationLog?: { amountConsumed?: { millilitersSum?: number } };
  timeInHeartRateZone?: {
    timeInHeartRateZones?: { heartRateZone?: string; duration?: string }[];
  };
  caloriesInHeartRateZone?: {
    caloriesInHeartRateZones?: { heartRateZone?: string; kcal?: number }[];
  };
}

// === Small numeric / formatting helpers ===

/** int64 values arrive as strings; missing values become 0. */
export function num(value: string | number | undefined | null): number {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** "1800s" or "1800.5s" -> seconds. */
export function durationSeconds(value: string | undefined): number {
  if (!value) return 0;
  return num(value.replace(/s$/, ''));
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function civilDate(c?: CivilDateTime | { year?: number; month?: number; day?: number }): string | undefined {
  const date = c && 'date' in c ? c.date : (c as CivilDateTime['date']);
  if (!date?.year || !date.month || !date.day) return undefined;
  return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;
}

function civilTimeOfDay(c?: CivilDateTime): string {
  return `${pad(c?.time?.hours ?? 0)}:${pad(c?.time?.minutes ?? 0)}:${pad(c?.time?.seconds ?? 0)}`;
}

/** Local datetime as Fitbit formats it: 2026-11-03T22:15:30.000 */
export function civilLocalIso(c?: CivilDateTime): string | undefined {
  const date = civilDate(c);
  return date ? `${date}T${civilTimeOfDay(c)}.000` : undefined;
}

/** Applies a Google UTC offset ("-25200s") to a UTC instant and formats it as local time. */
export function utcToLocalIso(utcIso: string, offset?: string): string {
  const ms = Date.parse(utcIso) + durationSeconds(offset) * 1000;
  return new Date(ms).toISOString().slice(0, 23);
}

// === Date arithmetic (civil dates, YYYY-MM-DD) ===

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Inclusive number of days between two civil dates. */
export function inclusiveDays(start: string, end: string): number {
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/** All civil dates from start to end, inclusive. */
export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * First date of a Fitbit-style period ending on endDate (inclusive).
 * '1d' is just endDate, '7d'/'1w' is the 7 days ending endDate, '1m' is one calendar month, etc.
 */
export function periodStartDate(endDate: string, period: string): string {
  const match = /^(\d+)([dwmy])$/.exec(period);
  if (!match) throw new Error(`Unsupported period '${period}'`);
  const n = Number(match[1]);
  switch (match[2]) {
    case 'd':
      return addDays(endDate, -(n - 1));
    case 'w':
      return addDays(endDate, -(7 * n - 1));
    case 'm':
      return addDays(addMonths(endDate, -n), 1);
    default:
      return addDays(addMonths(endDate, -12 * n), 1);
  }
}

// === Time zones ===

function zoneOffsetMs(timeZone: string, utcMs: number): number {
  const whole = Math.floor(utcMs / 1000) * 1000;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(whole))
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - whole;
}

/** The UTC instant (ms) at which a civil date starts in the given IANA time zone. */
export function zonedMidnightMs(date: string, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - zoneOffsetMs(timeZone, guess);
  return guess - zoneOffsetMs(timeZone, first);
}

/** RFC 3339 timestamp at which a civil date starts in the given time zone. */
export function zonedMidnightIso(date: string, timeZone: string): string {
  return new Date(zonedMidnightMs(date, timeZone)).toISOString();
}

/** The current civil date in the given time zone. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// === Units ===

/** Weight in the user's configured unit (Fitbit followed the account unit; default pounds). */
export function convertWeight(grams: number, weightUnit?: string): number {
  const unit = weightUnit ?? '';
  if (unit.includes('KILOGRAM')) return round(grams / 1000, 1);
  if (unit.includes('STONE')) return round(grams / 6350.29318, 2);
  return round(grams / 453.59237, 1);
}

/** Distance in the user's configured unit (Fitbit followed the account unit; default miles). */
export function convertDistance(mm: number, distanceUnit?: string): number {
  if ((distanceUnit ?? '').includes('KILOMETER')) return round(mm / 1_000_000, 2);
  return round(mm / 1_609_344, 2);
}

/** Water volume in the user's configured unit (Fitbit default fl oz; ml when metric). */
export function convertWater(ml: number, waterUnit?: string): number {
  const unit = waterUnit ?? '';
  if (unit.includes('FL_OZ')) return round(ml / 29.5735, 1);
  if (unit.includes('CUP')) return round(ml / 236.588, 2);
  return Math.round(ml);
}

// === Weight ===

export interface FitbitWeightLog {
  date: string;
  logId: number | string;
  source: string;
  time: string;
  weight: number;
}

/** Fitbit log ids are plain numbers; Google ids can exceed 2^53, so those stay strings. */
function toLogId(name?: string): number | string {
  const tail = name?.split('/').pop() ?? '';
  return /^\d+$/.test(tail) && Number.isSafeInteger(Number(tail))
    ? Number(tail)
    : tail;
}

/** Lower is better: Fitbit-originated entries win over Health Connect copies. */
function sourcePriority(platform?: string): number {
  if (platform?.includes('FITBIT')) return 0;
  if (platform === 'GOOGLE_WEB_API') return 1;
  if (platform === 'HEALTH_CONNECT') return 3;
  return 2;
}

/**
 * One weigh-in is often stored several times (once per API client, plus Health Connect
 * copies that carry a UTC "civil" time). Entries with the same instant are collapsed into one,
 * preferring Fitbit-originated sources. Local date/time come from the instant and its UTC
 * offset because the civil time on copies can be wrong.
 */
export function mapWeight(
  points: WeightPoint[],
  weightUnit?: string
): { weight: FitbitWeightLog[] } {
  const best = new Map<string, WeightPoint>();
  for (const p of points) {
    const sample = p.weight?.sampleTime;
    if (p.weight?.weightGrams === undefined || !sample) continue;
    const key = sample.physicalTime ?? civilLocalIso(sample.civilTime) ?? '';
    if (!key) continue;
    const current = best.get(key);
    if (
      !current ||
      sourcePriority(p.dataSource?.platform) <
        sourcePriority(current.dataSource?.platform)
    ) {
      best.set(key, p);
    }
  }

  const logs: FitbitWeightLog[] = [];
  for (const p of best.values()) {
    const sample = p.weight!.sampleTime!;
    const local =
      sample.physicalTime && sample.utcOffset
        ? utcToLocalIso(sample.physicalTime, sample.utcOffset)
        : (civilLocalIso(sample.civilTime) ??
          (sample.physicalTime
            ? utcToLocalIso(sample.physicalTime)
            : undefined));
    if (!local) continue;
    logs.push({
      date: local.slice(0, 10),
      logId: toLogId(p.name),
      source: 'API',
      time: local.slice(11, 19),
      weight: convertWeight(p.weight!.weightGrams!, weightUnit),
    });
  }
  logs.sort((a, b) =>
    `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`)
  );
  return { weight: logs };
}

// === Sleep ===

const STAGES_LEVELS: Record<string, string> = {
  AWAKE: 'wake',
  LIGHT: 'light',
  DEEP: 'deep',
  REM: 'rem',
};
const CLASSIC_LEVELS: Record<string, string> = {
  AWAKE: 'awake',
  ASLEEP: 'asleep',
  RESTLESS: 'restless',
};

export interface FitbitSleepLog {
  logId: number | string;
  dateOfSleep: string;
  startTime?: string;
  endTime?: string;
  duration: number;
  minutesAsleep: number;
  minutesAwake: number;
  minutesToFallAsleep: number;
  minutesAfterWakeUp: number;
  timeInBed: number;
  isMainSleep: boolean;
  type: 'stages' | 'classic';
  levels: {
    summary: Record<string, { count: number; minutes: number }>;
    data: { dateTime: string; level: string; seconds: number }[];
  };
}

export function mapSleepPoint(point: SleepPoint): FitbitSleepLog | null {
  const sleep = point.sleep;
  const interval = sleep?.interval;
  // civil times are not always populated; derive the wake date from the end instant + offset
  const dateOfSleep =
    civilDate(interval?.civilEndTime) ??
    (interval?.endTime
      ? utcToLocalIso(interval.endTime, interval.endUtcOffset).slice(0, 10)
      : undefined);
  if (!sleep || !dateOfSleep) return null;

  const stageTypes = (sleep.summary?.stagesSummary ?? []).map((s) => s.type);
  const isStages =
    sleep.type === 'STAGES' ||
    (sleep.type !== 'CLASSIC' &&
      stageTypes.some((t) => t === 'DEEP' || t === 'LIGHT' || t === 'REM'));
  const levelNames = isStages ? STAGES_LEVELS : CLASSIC_LEVELS;

  const summary: Record<string, { count: number; minutes: number }> = {};
  for (const name of Object.values(levelNames)) {
    summary[name] = { count: 0, minutes: 0 };
  }
  for (const s of sleep.summary?.stagesSummary ?? []) {
    const name = levelNames[s.type ?? ''];
    if (name) summary[name] = { count: num(s.count), minutes: num(s.minutes) };
  }

  const data = (sleep.stages ?? [])
    .filter((s) => s.startTime && s.endTime && levelNames[s.type ?? ''])
    .map((s) => ({
      dateTime: utcToLocalIso(s.startTime!, s.startUtcOffset),
      level: levelNames[s.type!],
      seconds: Math.round((Date.parse(s.endTime!) - Date.parse(s.startTime!)) / 1000),
    }));

  const timeInBed =
    num(sleep.summary?.minutesInSleepPeriod) ||
    (interval?.startTime && interval.endTime
      ? Math.round((Date.parse(interval.endTime) - Date.parse(interval.startTime)) / 60_000)
      : 0);

  return {
    logId: toLogId(point.name),
    dateOfSleep,
    startTime:
      civilLocalIso(interval?.civilStartTime) ??
      (interval?.startTime ? utcToLocalIso(interval.startTime, interval.startUtcOffset) : undefined),
    endTime:
      civilLocalIso(interval?.civilEndTime) ??
      (interval?.endTime ? utcToLocalIso(interval.endTime, interval.endUtcOffset) : undefined),
    duration: timeInBed * 60_000,
    minutesAsleep: num(sleep.summary?.minutesAsleep),
    minutesAwake: num(sleep.summary?.minutesAwake),
    minutesToFallAsleep: num(sleep.summary?.minutesToFallAsleep),
    minutesAfterWakeUp: num(sleep.summary?.minutesAfterWakeUp),
    timeInBed,
    isMainSleep: sleep.metadata?.mainSleep ?? !sleep.metadata?.nap,
    type: isStages ? 'stages' : 'classic',
    levels: { summary, data },
  };
}

export function mapSleep(points: SleepPoint[]): { sleep: FitbitSleepLog[] } {
  const logs = points
    .map(mapSleepPoint)
    .filter((l): l is FitbitSleepLog => l !== null);
  logs.sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));
  return { sleep: logs };
}

// === HRV and resting heart rate ===

export function mapHrv(points: HrvPoint[]): {
  hrv: { value: { dailyRmssd?: number; deepRmssd?: number }; dateTime: string }[];
} {
  const rows = points
    .map((p) => {
      const d = p.dailyHeartRateVariability;
      const dateTime = civilDate(d?.date);
      if (!d || !dateTime) return null;
      const value: { dailyRmssd?: number; deepRmssd?: number } = {};
      if (d.averageHeartRateVariabilityMilliseconds !== undefined) {
        value.dailyRmssd = round(d.averageHeartRateVariabilityMilliseconds, 3);
      }
      if (d.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds !== undefined) {
        value.deepRmssd = round(
          d.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds,
          3
        );
      }
      return { value, dateTime };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  rows.sort((a, b) => a.dateTime.localeCompare(b.dateTime));
  return { hrv: rows };
}

/** date -> resting heart rate (bpm) */
export function restingHeartRateByDate(points: RestingHrPoint[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of points) {
    const d = p.dailyRestingHeartRate;
    const date = civilDate(d?.date);
    const bpm = num(d?.beatsPerMinute);
    if (date && bpm > 0) out.set(date, bpm);
  }
  return out;
}

// === Heart rate zones ===
//
// Fitbit's legacy "Out of Range / Fat Burn / Cardio / Peak" zones correspond to Google's
// LIGHT / MODERATE / VIGOROUS / PEAK zones. Verified against a known day (2026-01-25):
// Fat Burn 51 and Cardio 14 minutes equal Active Zone Minutes fat burn (1x) and cardio (2x, so /2).

export interface FitbitZone {
  name: 'Out of Range' | 'Fat Burn' | 'Cardio' | 'Peak';
  min?: number;
  max?: number;
  minutes: number;
  caloriesOut?: number;
}

export interface DailyZonesPoint {
  dailyHeartRateZones?: {
    date?: { year?: number; month?: number; day?: number };
    heartRateZones?: {
      heartRateZoneType?: string;
      minBeatsPerMinute?: string | number;
      maxBeatsPerMinute?: string | number;
    }[];
  };
}

const ZONE_MAP = [
  { name: 'Out of Range', google: 'LIGHT' },
  { name: 'Fat Burn', google: 'MODERATE' },
  { name: 'Cardio', google: 'VIGOROUS' },
  { name: 'Peak', google: 'PEAK' },
] as const;

/** date -> zone type -> bpm bounds, from the account's daily-heart-rate-zones data. */
export function zoneBoundsByDate(
  points: DailyZonesPoint[]
): Map<string, Record<string, { min: number; max: number }>> {
  const out = new Map<string, Record<string, { min: number; max: number }>>();
  for (const p of points) {
    const d = p.dailyHeartRateZones;
    const date = civilDate(d?.date);
    if (!date) continue;
    const bounds: Record<string, { min: number; max: number }> = {};
    for (const z of d?.heartRateZones ?? []) {
      if (z.heartRateZoneType) {
        bounds[z.heartRateZoneType] = {
          min: num(z.minBeatsPerMinute),
          max: num(z.maxBeatsPerMinute),
        };
      }
    }
    out.set(date, bounds);
  }
  return out;
}

/**
 * Builds Fitbit-style heartRateZones for one day.
 * Minutes prefer Active Zone Minutes (minute-granular, matches Fitbit's old counts) and fall
 * back to time-in-zone; Out of Range always comes from time-in-zone. Returns null when the
 * day has neither source.
 */
export function buildFitbitZones(day: {
  azm?: RollupPoint;
  timeInZone?: RollupPoint;
  calories?: RollupPoint;
  bounds?: Record<string, { min: number; max: number }>;
}): FitbitZone[] | null {
  const tizRows = day.timeInZone?.timeInHeartRateZone?.timeInHeartRateZones;
  const azm = day.azm?.activeZoneMinutes;
  if (!tizRows && !azm) return null;

  const seconds = (zone: string) =>
    (tizRows ?? [])
      .filter((r) => r.heartRateZone === zone)
      .reduce((sum, r) => sum + durationSeconds(r.duration), 0);
  const fromTime = (zone: string) => Math.round(seconds(zone) / 60);

  const minutes: Record<string, number> = {
    LIGHT: fromTime('LIGHT'),
    MODERATE: azm ? num(azm.sumInFatBurnHeartZone) : fromTime('MODERATE'),
    VIGOROUS: azm
      ? Math.round(num(azm.sumInCardioHeartZone) / 2)
      : fromTime('VIGOROUS'),
    PEAK: azm ? Math.round(num(azm.sumInPeakHeartZone) / 2) : fromTime('PEAK'),
  };
  const kcal = day.calories?.caloriesInHeartRateZone?.caloriesInHeartRateZones;

  return ZONE_MAP.map(({ name, google }) => {
    const bounds = day.bounds?.[google];
    const burned = kcal?.find((k) => k.heartRateZone === google)?.kcal;
    return {
      name,
      ...(bounds ? { min: bounds.min, max: bounds.max } : {}),
      minutes: minutes[google],
      ...(burned !== undefined ? { caloriesOut: Math.round(burned) } : {}),
    };
  });
}

// === Daily roll-ups ===

export function rollupDate(point: RollupPoint): string | undefined {
  return civilDate(point.civilStartTime);
}

/**
 * Fitbit activity-level minutes from raw `activity-level` data points.
 *
 * Google does not support dailyRollUp for this data type (only list/reconcile), so the
 * per-minute points of one day are summed here. Google leaves sleep and off-wrist time
 * untyped; Fitbit counts that as sedentary, so sedentary is the rest of the day.
 */
export function activityLevelMinutes(
  points: ActivityLevelPoint[],
  minutesInDay = 1440
): {
  sedentaryMinutes: number;
  lightlyActiveMinutes: number;
  fairlyActiveMinutes: number;
  veryActiveMinutes: number;
} | null {
  const totals: Record<string, number> = {};
  let seen = 0;
  for (const point of points) {
    const level = point.activityLevel;
    const start = Date.parse(level?.interval?.startTime ?? '');
    const end = Date.parse(level?.interval?.endTime ?? '');
    if (!level?.activityLevelType || Number.isNaN(start) || Number.isNaN(end)) continue;
    totals[level.activityLevelType] =
      (totals[level.activityLevelType] ?? 0) + (end - start) / 60000;
    seen++;
  }
  if (seen === 0) return null;
  const minutes = (type: string) => Math.round(totals[type] ?? 0);
  const lightly = minutes('LIGHTLY_ACTIVE');
  const fairly = minutes('MODERATELY_ACTIVE');
  const very = minutes('VERY_ACTIVE');
  return {
    sedentaryMinutes: Math.max(0, minutesInDay - lightly - fairly - very),
    lightlyActiveMinutes: lightly,
    fairlyActiveMinutes: fairly,
    veryActiveMinutes: very,
  };
}

export interface NutritionSummary {
  calories: number;
  carbs: number;
  fat: number;
  fiber: number;
  protein: number;
  sodium: number;
  water: number;
}

/** Fitbit's food-log summary (calories kcal; carbs/fat/fiber/protein g; sodium mg). */
export function nutritionSummary(
  point: RollupPoint | undefined
): Omit<NutritionSummary, 'water'> | null {
  const log = point?.nutritionLog;
  if (!log) return null;
  const grams = (nutrient: string) =>
    log.nutrients?.find((n) => n.nutrient === nutrient)?.quantity?.gramsSum ?? 0;
  return {
    calories: Math.round(log.energy?.kcalSum ?? 0),
    carbs: round(log.totalCarbohydrate?.gramsSum ?? grams('CARBOHYDRATES'), 1),
    fat: round(log.totalFat?.gramsSum ?? 0, 1),
    fiber: round(grams('DIETARY_FIBER'), 1),
    protein: round(grams('PROTEIN'), 1),
    sodium: Math.round(grams('SODIUM') * 1000),
  };
}
