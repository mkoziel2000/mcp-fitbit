import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerTool,
  CommonSchemas,
  listDataPoints,
  dailyRollUp,
  buildRangeFilter,
} from './utils.js';
import { VALIDATION_MESSAGES } from './config.js';

/**
 * Registers heart rate tools with the MCP server.
 * @param server The McpServer instance.
 * @param getAccessTokenFn Function to retrieve the current access token.
 */
export function registerHeartRateTools(
  server: McpServer,
  getAccessTokenFn: () => Promise<string | null>
): void {
  // Raw heart rate samples
  registerTool(server, {
    name: 'get_heart_rate',
    description:
      'Get the raw JSON response for heart rate samples from the Google Health API (data type "heart-rate"), filtered by sample time. Requires a start timestamp (RFC 3339); the end is optional and exclusive. Supports pagination via pageToken.',
    parametersSchema: {
      startTime: CommonSchemas.physicalStartTime,
      endTime: CommonSchemas.physicalEndTime,
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
        'heart-rate',
        getAccessTokenFn,
        {
          filter: buildRangeFilter(
            'heart_rate.sample_time.physical_time',
            startTime,
            endTime
          ),
          pageSize,
          pageToken,
        },
        `heart rate from '${startTime}'${endTime ? ` to '${endTime}'` : ''}`
      ),
  });

  // Daily heart rate roll-up
  registerTool(server, {
    name: 'get_heart_rate_by_date_range',
    description: `Get the raw JSON response for daily heart rate roll-ups from the Google Health API (dailyRollUp of "heart-rate") over a civil date range. startDate is inclusive, endDate is exclusive. ${VALIDATION_MESSAGES.MAX_RANGE_14_DAYS}.`,
    parametersSchema: {
      startDate: CommonSchemas.startDate,
      endDate: CommonSchemas.endDate,
      dataSourceFamily: CommonSchemas.dataSourceFamily,
    },
    handler: async ({
      startDate,
      endDate,
      dataSourceFamily,
    }: {
      startDate: string;
      endDate: string;
      dataSourceFamily?: string;
    }) =>
      dailyRollUp(
        'heart-rate',
        getAccessTokenFn,
        { startDate, endDate, dataSourceFamily },
        `heart rate from ${startDate} to ${endDate}`
      ),
  });
}
