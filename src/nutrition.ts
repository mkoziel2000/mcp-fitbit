import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  registerTool,
  CommonSchemas,
  listDataPoints,
  dailyRollUp,
  buildRangeFilter,
  nextDate,
} from './utils.js';

// Nutrition-related data types that support roll-ups
export const NUTRITION_DATA_TYPES = ['nutrition-log', 'hydration-log'] as const;

const dataTypeSchema = z
  .enum(NUTRITION_DATA_TYPES)
  .describe(
    "Data type to roll up: 'nutrition-log' (calories and macronutrients) or 'hydration-log' (water)"
  );

/**
 * Registers nutrition tools with the MCP server.
 * @param server The McpServer instance.
 * @param getAccessTokenFn Function to retrieve the current access token.
 */
export function registerNutritionTools(
  server: McpServer,
  getAccessTokenFn: () => Promise<string | null>
): void {
  // --- Food Log Tool ---
  registerTool(server, {
    name: 'get_food_log',
    description:
      'Get the raw JSON response for logged nutrition entries from the Google Health API (data type "nutrition-log"), filtered by civil start time. Requires a start civil time; the end is optional and exclusive. Supports pagination via pageToken.',
    parametersSchema: {
      startTime: CommonSchemas.civilStartTime,
      endTime: CommonSchemas.civilEndTime,
      pageSize: CommonSchemas.pageSize,
      pageToken: CommonSchemas.pageToken,
    },
    handler: async ({
      startTime,
      endTime,
      pageSize,
      pageToken,
    }: {
      startTime: string;
      endTime?: string;
      pageSize?: number;
      pageToken?: string;
    }) =>
      listDataPoints(
        'nutrition-log',
        getAccessTokenFn,
        {
          filter: buildRangeFilter(
            'nutrition_log.interval.civil_start_time',
            startTime,
            endTime
          ),
          pageSize,
          pageToken,
        },
        `food log from '${startTime}'${endTime ? ` to '${endTime}'` : ''}`
      ),
  });

  // --- Nutrition for a single date ---
  registerTool(server, {
    name: 'get_nutrition',
    description:
      'Get the raw JSON response for the daily nutrition roll-up from the Google Health API (dailyRollUp) for a single date.',
    parametersSchema: {
      dataType: dataTypeSchema,
      date: CommonSchemas.date,
    },
    handler: async ({
      dataType,
      date,
    }: {
      dataType: (typeof NUTRITION_DATA_TYPES)[number];
      date: string;
    }) =>
      dailyRollUp(
        dataType,
        getAccessTokenFn,
        { startDate: date, endDate: nextDate(date) },
        `${dataType} for ${date}`
      ),
  });

  // --- Nutrition by date range ---
  registerTool(server, {
    name: 'get_nutrition_by_date_range',
    description:
      'Get the raw JSON response for daily nutrition roll-ups from the Google Health API (dailyRollUp) over a civil date range. startDate is inclusive, endDate is exclusive. Note: The API allows at most 90 days per request.',
    parametersSchema: {
      dataType: dataTypeSchema,
      startDate: CommonSchemas.startDate,
      endDate: CommonSchemas.endDate,
    },
    handler: async ({
      dataType,
      startDate,
      endDate,
    }: {
      dataType: (typeof NUTRITION_DATA_TYPES)[number];
      startDate: string;
      endDate: string;
    }) =>
      dailyRollUp(
        dataType,
        getAccessTokenFn,
        { startDate, endDate },
        `${dataType} from ${startDate} to ${endDate}`
      ),
  });
}
