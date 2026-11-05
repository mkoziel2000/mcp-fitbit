/**
 * Shared utility functions for Google Health API integration
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  HTTP_CONFIG,
  ERROR_MESSAGES,
  GOOGLE_HEALTH_API_BASE,
  DATE_REGEX,
  CIVIL_TIME_REGEX,
  CIVIL_TIME_FORMAT_ERROR,
  RFC3339_REGEX,
  RFC3339_FORMAT_ERROR,
  VALIDATION_MESSAGES,
  DATA_SOURCE_FAMILIES,
} from './config.js';

// Common response structures for MCP tools
export type TextContent = { type: 'text'; text: string };

export type ToolResponseStructure = {
  content: TextContent[];
  isError?: boolean;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * Error thrown when the Google Health API returns a non-success status.
 */
export class GoogleHealthApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string, url: string) {
    super(
      `Google Health API Error! Status: ${status}, URL: ${url}, Body: ${body}`
    );
    this.name = 'GoogleHealthApiError';
    this.status = status;
    this.body = body;
  }
}

export interface GoogleHealthRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Query string parameters; undefined values are skipped. */
  query?: Record<string, string | number | undefined>;
  /** JSON request body (POST/PATCH). */
  body?: unknown;
  /** Base delay for exponential backoff on 429/504. Defaults to HTTP_CONFIG.RETRY_BASE_DELAY_MS. */
  retryBaseDelayMs?: number;
}

function buildQueryString(query?: GoogleHealthRequestOptions['query']): string {
  if (!query) return '';
  const parts = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
    );
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Makes a request to the Google Health API.
 * @param path Path relative to the API base, e.g. 'users/me/dataTypes/steps/dataPoints'
 * @param getAccessTokenFn A function that returns the current valid access token or null.
 * @param options Method, query parameters and JSON body.
 * @returns The parsed JSON response, or null when no access token is available.
 * @throws GoogleHealthApiError for non-success responses (after retrying 429/504),
 *         or the underlying error for network failures.
 */
export async function makeGoogleHealthRequest<T>(
  path: string,
  getAccessTokenFn: () => Promise<string | null>,
  options: GoogleHealthRequestOptions = {}
): Promise<T | null> {
  const currentAccessToken = await getAccessTokenFn();
  if (!currentAccessToken) {
    console.error(`Error: ${ERROR_MESSAGES.NO_ACCESS_TOKEN}`);
    return null;
  }

  const { method = 'GET', query, body } = options;
  const retryBaseDelayMs =
    options.retryBaseDelayMs ?? HTTP_CONFIG.RETRY_BASE_DELAY_MS;
  const cleanPath = path.startsWith('/') ? path.substring(1) : path;
  const url = `${GOOGLE_HEALTH_API_BASE}/${cleanPath}${buildQueryString(query)}`;
  console.error(`Attempting Google Health API request: ${method} ${url}`);

  const headers: Record<string, string> = {
    'User-Agent': HTTP_CONFIG.USER_AGENT,
    Authorization: `Bearer ${currentAccessToken}`,
    Accept: 'application/json',
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      console.error(`Error making Google Health request to ${url}:`, error);
      throw error;
    }

    if (response.ok) {
      // Handle potential empty response body (e.g., 204 No Content)
      if (response.status === 204) {
        return {} as T;
      }
      return (await response.json()) as T;
    }

    const errorBody = await response.text();
    const retryable = (
      HTTP_CONFIG.RETRYABLE_STATUSES as readonly number[]
    ).includes(response.status);
    if (retryable && attempt < HTTP_CONFIG.MAX_RETRIES) {
      await sleep(retryBaseDelayMs * 2 ** attempt);
      continue;
    }

    console.error(
      `Google Health API Error! Status: ${response.status}, URL: ${url}, Body: ${errorBody}`
    );
    if (response.status === 401) {
      console.error(ERROR_MESSAGES.TOKEN_EXPIRED);
    }
    throw new GoogleHealthApiError(response.status, errorBody, url);
  }
}

// === Filter / path / range helpers ===

/** Path for the data points collection of a data type (kebab-case). */
export function dataPointsPath(dataType: string, suffix = ''): string {
  return `users/me/dataTypes/${dataType}/dataPoints${suffix}`;
}

/** Filters use snake_case data type names, URLs use kebab-case. */
export function toFilterName(dataType: string): string {
  return dataType.replace(/-/g, '_');
}

/**
 * Builds an AIP-160 style range filter on a field.
 * Start is inclusive; end (optional) is exclusive.
 */
export function buildRangeFilter(
  field: string,
  start: string,
  end?: string
): string {
  const clauses = [`${field} >= "${start}"`];
  if (end) {
    clauses.push(`${field} < "${end}"`);
  }
  return clauses.join(' AND ');
}

/** Returns the calendar day after a YYYY-MM-DD date. */
export function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().substring(0, 10);
}

interface CivilDateTime {
  date: { year: number; month: number; day: number };
  time: Record<string, never>;
}

function toCivilDateTime(date: string): CivilDateTime {
  const [year, month, day] = date.split('-').map(Number);
  return { date: { year, month, day }, time: {} };
}

/** Body for POST dataPoints:dailyRollUp over a closed-open civil date range. */
export function buildDailyRollUpBody(
  startDate: string,
  endDate: string,
  extra: { windowSizeDays?: number; dataSourceFamily?: string } = {}
): Record<string, unknown> {
  return {
    range: {
      start: toCivilDateTime(startDate),
      end: toCivilDateTime(endDate),
    },
    windowSizeDays: extra.windowSizeDays ?? 1,
    ...(extra.dataSourceFamily
      ? { dataSourceFamily: extra.dataSourceFamily }
      : {}),
  };
}

// === Parameter Validation Schemas ===

export const CommonSchemas = {
  date: z
    .string()
    .regex(DATE_REGEX, VALIDATION_MESSAGES.DATE_FORMAT)
    .describe('The date for which to retrieve data (YYYY-MM-DD)'),

  startDate: z
    .string()
    .regex(DATE_REGEX, VALIDATION_MESSAGES.DATE_FORMAT)
    .describe(VALIDATION_MESSAGES.START_DATE_REQUIRED),

  endDate: z
    .string()
    .regex(DATE_REGEX, VALIDATION_MESSAGES.DATE_FORMAT)
    .describe(VALIDATION_MESSAGES.END_DATE_REQUIRED),

  civilStartTime: z
    .string()
    .regex(CIVIL_TIME_REGEX, CIVIL_TIME_FORMAT_ERROR)
    .describe(
      "Start of the range, inclusive, as civil time ('YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM:SS', user's local time)"
    ),

  civilEndTime: z
    .string()
    .regex(CIVIL_TIME_REGEX, CIVIL_TIME_FORMAT_ERROR)
    .optional()
    .describe(
      "Optional end of the range, EXCLUSIVE, as civil time ('YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM:SS')"
    ),

  physicalStartTime: z
    .string()
    .regex(RFC3339_REGEX, RFC3339_FORMAT_ERROR)
    .describe(
      "Start of the range, inclusive, as an RFC 3339 timestamp (e.g. '2026-03-04T00:00:00Z')"
    ),

  physicalEndTime: z
    .string()
    .regex(RFC3339_REGEX, RFC3339_FORMAT_ERROR)
    .optional()
    .describe(
      "Optional end of the range, EXCLUSIVE, as an RFC 3339 timestamp (e.g. '2026-03-05T00:00:00Z')"
    ),

  pageSize: z
    .number()
    .int()
    .min(1)
    .max(10000)
    .optional()
    .describe(
      'Maximum number of data points to return. Most data types allow up to 10000; sleep and exercise are capped at 25'
    ),

  pageToken: z
    .string()
    .optional()
    .describe(`Page token for pagination. ${VALIDATION_MESSAGES.PAGINATION}`),

  dataSourceFamily: z
    .enum(DATA_SOURCE_FAMILIES)
    .optional()
    .describe(
      'Optional data source family. Defaults to all sources (Google/Fitbit wearables plus third-party)'
    ),
} as const;

// === Common Parameter Types ===

export type CommonParams = {
  date: string;
  startDate: string;
  endDate: string;
  civilStartTime: string;
  civilEndTime?: string;
  physicalStartTime: string;
  physicalEndTime?: string;
  pageSize?: number;
  pageToken?: string;
  dataSourceFamily?: (typeof DATA_SOURCE_FAMILIES)[number];
};

// === Tool Response Helpers ===

export function createErrorResponse(message: string): ToolResponseStructure {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

export function createSuccessResponse(data: unknown): ToolResponseStructure {
  const rawJsonResponse = JSON.stringify(data, null, 2);
  return {
    content: [{ type: 'text', text: rawJsonResponse }],
  };
}

export function createNoDataResponse(context: string): ToolResponseStructure {
  return {
    content: [
      { type: 'text', text: `${ERROR_MESSAGES.NO_DATA_FOUND} ${context}.` },
    ],
  };
}

// === Tool Registration Helper ===

export interface ToolConfig {
  name: string;
  description: string;
  parametersSchema: Record<string, z.ZodTypeAny>;
  // Using 'any' here is necessary because different handlers expect different parameter types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (params: any) => Promise<ToolResponseStructure>;
}

export function registerTool(server: McpServer, config: ToolConfig): void {
  server.tool(
    config.name,
    config.description,
    config.parametersSchema,
    config.handler
  );
}

// === Google Health-Specific Tool Helpers ===

export async function handleGoogleHealthCall<TResponse>(
  path: string,
  getAccessTokenFn: () => Promise<string | null>,
  options: {
    method?: GoogleHealthRequestOptions['method'];
    query?: GoogleHealthRequestOptions['query'];
    body?: unknown;
    retryBaseDelayMs?: number;
    successDataExtractor?: (data: TResponse) => unknown[] | null | undefined;
    noDataMessage?: string;
    errorContext?: string;
  } = {}
): Promise<ToolResponseStructure> {
  const {
    successDataExtractor,
    noDataMessage,
    errorContext = path,
    ...requestOptions
  } = options;

  let responseData: TResponse | null;
  try {
    responseData = await makeGoogleHealthRequest<TResponse>(
      path,
      getAccessTokenFn,
      requestOptions
    );
  } catch (error) {
    if (error instanceof GoogleHealthApiError) {
      if (error.status === 400 && error.body.includes('ACCOUNT_NOT_LINKED')) {
        return createErrorResponse(ERROR_MESSAGES.ACCOUNT_NOT_LINKED);
      }
      return createErrorResponse(
        `${ERROR_MESSAGES.API_REQUEST_FAILED} for ${errorContext} (HTTP ${error.status}): ${error.body}`
      );
    }
    return createErrorResponse(
      `${ERROR_MESSAGES.API_REQUEST_FAILED} for ${errorContext}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!responseData) {
    return createErrorResponse(
      `${ERROR_MESSAGES.API_REQUEST_FAILED} for ${errorContext}. ${ERROR_MESSAGES.CHECK_TOKEN_PERMISSIONS}.`
    );
  }

  // Check for empty data if extractor provided
  if (successDataExtractor) {
    const extractedData = successDataExtractor(responseData);
    if (!extractedData || extractedData.length === 0) {
      return createNoDataResponse(noDataMessage || errorContext);
    }
  }

  return createSuccessResponse(responseData);
}

// Shared response shapes
export interface DataPointsResponse {
  dataPoints?: unknown[];
  nextPageToken?: string;
}

export interface RollUpResponse {
  rollupDataPoints?: unknown[];
  nextPageToken?: string;
}

/**
 * Lists data points of a data type with a filter (GET .../dataPoints).
 */
export function listDataPoints(
  dataType: string,
  getAccessTokenFn: () => Promise<string | null>,
  params: { filter?: string; pageSize?: number; pageToken?: string },
  errorContext: string,
  suffix = ''
): Promise<ToolResponseStructure> {
  return handleGoogleHealthCall<DataPointsResponse>(
    dataPointsPath(dataType, suffix),
    getAccessTokenFn,
    {
      query: {
        filter: params.filter,
        pageSize: params.pageSize,
        pageToken: params.pageToken,
      },
      successDataExtractor: (data) => data.dataPoints,
      errorContext,
    }
  );
}

/**
 * Rolls up data points of a data type per civil day (POST .../dataPoints:dailyRollUp).
 * endDate is exclusive (closed-open range), as in the Google Health API.
 */
export function dailyRollUp(
  dataType: string,
  getAccessTokenFn: () => Promise<string | null>,
  params: {
    startDate: string;
    endDate: string;
    pageSize?: number;
    pageToken?: string;
    dataSourceFamily?: string;
  },
  errorContext: string
): Promise<ToolResponseStructure> {
  const body = {
    ...buildDailyRollUpBody(params.startDate, params.endDate, {
      dataSourceFamily: params.dataSourceFamily,
    }),
    ...(params.pageSize ? { pageSize: params.pageSize } : {}),
    ...(params.pageToken ? { pageToken: params.pageToken } : {}),
  };
  return handleGoogleHealthCall<RollUpResponse>(
    dataPointsPath(dataType, ':dailyRollUp'),
    getAccessTokenFn,
    {
      method: 'POST',
      body,
      successDataExtractor: (data) => data.rollupDataPoints,
      errorContext,
    }
  );
}
