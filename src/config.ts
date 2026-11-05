/**
 * Centralized configuration for the Google Health MCP server
 * Contains all constants, API URLs, and shared configurations
 */

// === API Configuration ===

export const GOOGLE_HEALTH_API_BASE = 'https://health.googleapis.com/v4';

const SCOPE_PREFIX = 'https://www.googleapis.com/auth/googlehealth';

export const GOOGLE_OAUTH_CONFIG = {
  TOKEN_HOST: 'https://oauth2.googleapis.com',
  TOKEN_PATH: '/token',
  AUTHORIZE_HOST: 'https://accounts.google.com',
  AUTHORIZE_PATH: '/o/oauth2/v2/auth',
  CALLBACK_URI: 'http://localhost:3000/callback',
  SCOPES: [
    `${SCOPE_PREFIX}.activity_and_fitness.readonly`,
    `${SCOPE_PREFIX}.health_metrics_and_measurements.readonly`,
    `${SCOPE_PREFIX}.sleep.readonly`,
    `${SCOPE_PREFIX}.nutrition.readonly`,
    `${SCOPE_PREFIX}.profile.readonly`,
    `${SCOPE_PREFIX}.settings.readonly`,
  ].join(' '),
} as const;

/**
 * Resolves OAuth client credentials from the environment.
 * GOOGLE_HEALTH_* is preferred; the legacy FITBIT_* names are accepted as a fallback.
 */
export function resolveClientCredentials(): { id: string; secret: string } {
  return {
    id:
      process.env.GOOGLE_HEALTH_CLIENT_ID || process.env.FITBIT_CLIENT_ID || '',
    secret:
      process.env.GOOGLE_HEALTH_CLIENT_SECRET ||
      process.env.FITBIT_CLIENT_SECRET ||
      '',
  };
}

/**
 * Output mode. 'google' (default) is the 1:1 JSON proxy. 'fitbit' registers tools that keep the
 * legacy Fitbit tool names, parameters, response shapes and units (see src/compat/tools.ts).
 */
export type OutputMode = 'google' | 'fitbit';

export function resolveOutputMode(): OutputMode {
  const value = (process.env.GOOGLE_HEALTH_OUTPUT_MODE || 'google').toLowerCase();
  return value === 'fitbit' ? 'fitbit' : 'google';
}

// === Data Types ===

// All data types exposed by the Google Health API (kebab-case, as used in URL paths)
export const DATA_TYPES = [
  'active-energy-burned',
  'active-minutes',
  'active-zone-minutes',
  'activity-level',
  'altitude',
  'blood-glucose',
  'body-fat',
  'calories-in-heart-rate-zone',
  'core-body-temperature',
  'daily-heart-rate-variability',
  'daily-heart-rate-zones',
  'daily-oxygen-saturation',
  'daily-respiratory-rate',
  'daily-resting-heart-rate',
  'daily-sleep-temperature-derivations',
  'daily-vo2-max',
  'distance',
  'electrocardiogram',
  'exercise',
  'floors',
  'food',
  'food-measurement-unit',
  'heart-rate',
  'heart-rate-variability',
  'height',
  'hydration-log',
  'irregular-rhythm-notification',
  'nutrition-log',
  'oxygen-saturation',
  'respiratory-rate-sleep-summary',
  'run-vo2-max',
  'sedentary-period',
  'sleep',
  'steps',
  'swim-lengths-data',
  'time-in-heart-rate-zone',
  'total-calories',
  'vo2-max',
  'weight',
] as const;
export type DataType = (typeof DATA_TYPES)[number];

export const DATA_SOURCE_FAMILIES = [
  'users/me/dataSourceFamilies/all-sources',
  'users/me/dataSourceFamilies/google-wearables',
  'users/me/dataSourceFamilies/google-sources',
] as const;

// === Common Validation ===

// YYYY-MM-DD
export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const DATE_FORMAT_ERROR = 'Date must be in YYYY-MM-DD format';

// Civil time: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS (no UTC offset)
export const CIVIL_TIME_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?$/;
export const CIVIL_TIME_FORMAT_ERROR =
  "Must be a civil time: 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM:SS' (no UTC offset)";

// RFC 3339 timestamp with offset, e.g. 2026-03-04T00:00:00Z
export const RFC3339_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
export const RFC3339_FORMAT_ERROR =
  "Must be an RFC 3339 timestamp, e.g. '2026-03-04T00:00:00Z'";

export const VALIDATION_MESSAGES = {
  DATE_FORMAT: DATE_FORMAT_ERROR,
  START_DATE_REQUIRED: 'The first date of the range, inclusive (YYYY-MM-DD)',
  END_DATE_REQUIRED:
    'The end of the range, EXCLUSIVE (YYYY-MM-DD). To include a day, pass the following day',
  MAX_RANGE_90_DAYS: 'Note: The API allows at most 90 days per request',
  MAX_RANGE_14_DAYS:
    'Note: The API allows at most 14 days per request for this data type',
  PAGINATION:
    'Use nextPageToken from the response as pageToken to fetch the next page',
} as const;

// === HTTP Configuration ===

export const HTTP_CONFIG = {
  USER_AGENT: 'mcp-google-health-server/2.0',
  TIMEOUT_MS: 30000,
  MAX_RETRIES: 3,
  RETRY_BASE_DELAY_MS: 500,
  // Status codes the Google Health docs recommend retrying with exponential backoff
  RETRYABLE_STATUSES: [429, 504],
} as const;

// === File Paths ===

export const FILE_PATHS = {
  TOKEN_STORAGE: '.google-health-token.json',
} as const;

// === Error Messages ===

export const ERROR_MESSAGES = {
  NO_ACCESS_TOKEN:
    'No Google Health access token available. Please authorize first.',
  API_REQUEST_FAILED: 'Failed to retrieve data from Google Health API',
  TOKEN_EXPIRED:
    'Access token might be expired or invalid. Re-authorization may be needed.',
  NO_DATA_FOUND: 'No data found for the specified period/range',
  CHECK_TOKEN_PERMISSIONS: 'Check token and permissions',
  ACCOUNT_NOT_LINKED:
    'This Google Account is not linked to Google Health. Open the Google Health mobile app, choose "Sign in with Google" with this account, then authorize again.',
} as const;
