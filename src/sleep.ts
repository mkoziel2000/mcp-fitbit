import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerTool,
  CommonSchemas,
  listDataPoints,
  buildRangeFilter,
} from './utils.js';

/**
 * Registers the sleep tool with the MCP server (Google Health `sleep` data type).
 * @param server The McpServer instance.
 * @param getAccessTokenFn Function to retrieve the current access token.
 */
export function registerSleepTool(
  server: McpServer,
  getAccessTokenFn: () => Promise<string | null>
): void {
  registerTool(server, {
    name: 'get_sleep_by_date_range',
    description:
      'Get the raw JSON response for sleep sessions from the Google Health API (data type "sleep"), filtered by the civil end time of the sleep. Requires a start civil time; the end is optional and exclusive. Note: the API returns at most 25 sleep sessions per page; use pageToken to continue.',
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
        'sleep',
        getAccessTokenFn,
        {
          filter: buildRangeFilter(
            'sleep.interval.civil_end_time',
            startTime,
            endTime
          ),
          pageSize,
          pageToken,
        },
        `sleep from '${startTime}'${endTime ? ` to '${endTime}'` : ''}`
      ),
  });
}
