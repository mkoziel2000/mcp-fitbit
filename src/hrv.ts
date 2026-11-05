import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerTool,
  CommonSchemas,
  listDataPoints,
  buildRangeFilter,
  nextDate,
} from './utils.js';

export const HRV_DATA_TYPE = 'daily-heart-rate-variability';
export const HRV_DATE_FIELD = 'daily_heart_rate_variability.date';

/**
 * Registers Heart Rate Variability (HRV) tools with the MCP server.
 * @param server The McpServer instance.
 * @param getAccessTokenFn Function to retrieve the current access token.
 */
export function registerHrvTools(
  server: McpServer,
  getAccessTokenFn: () => Promise<string | null>
): void {
  // Tool 1: Get daily HRV for a single date
  registerTool(server, {
    name: 'get_hrv',
    description:
      'Get the raw JSON response for daily Heart Rate Variability (HRV) from the Google Health API (data type "daily-heart-rate-variability") for a single date.',
    parametersSchema: {
      date: CommonSchemas.date,
    },
    handler: async ({ date }: { date: string }) =>
      listDataPoints(
        HRV_DATA_TYPE,
        getAccessTokenFn,
        { filter: buildRangeFilter(HRV_DATE_FIELD, date, nextDate(date)) },
        `HRV data for ${date}`
      ),
  });

  // Tool 2: Get daily HRV over a date range
  registerTool(server, {
    name: 'get_hrv_by_date_range',
    description:
      'Get the raw JSON response for daily Heart Rate Variability (HRV) from the Google Health API (data type "daily-heart-rate-variability") over a date range. startDate is inclusive, endDate is exclusive. Supports pagination via pageToken.',
    parametersSchema: {
      startDate: CommonSchemas.startDate,
      endDate: CommonSchemas.endDate,
      pageSize: CommonSchemas.pageSize,
      pageToken: CommonSchemas.pageToken,
    },
    handler: async ({
      startDate,
      endDate,
      pageSize,
      pageToken,
    }: {
      startDate: string;
      endDate: string;
      pageSize?: number;
      pageToken?: string;
    }) =>
      listDataPoints(
        HRV_DATA_TYPE,
        getAccessTokenFn,
        {
          filter: buildRangeFilter(HRV_DATE_FIELD, startDate, endDate),
          pageSize,
          pageToken,
        },
        `HRV data from ${startDate} to ${endDate}`
      ),
  });
}
