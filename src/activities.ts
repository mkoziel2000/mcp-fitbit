import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerTool,
  CommonSchemas,
  listDataPoints,
  buildRangeFilter,
} from './utils.js';

/**
 * Registers the exercise tool with the MCP server (Google Health `exercise` data type).
 * @param server The McpServer instance.
 * @param getAccessTokenFn Function to retrieve the current access token.
 */
export function registerActivitiesTool(
  server: McpServer,
  getAccessTokenFn: () => Promise<string | null>
): void {
  registerTool(server, {
    name: 'get_exercises',
    description:
      'Get the raw JSON response for exercise sessions from the Google Health API (data type "exercise"), filtered by the civil start time. Requires a start civil time; the end is optional and exclusive. Note: the API returns at most 25 exercises per page; use pageToken to continue.',
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
        'exercise',
        getAccessTokenFn,
        {
          filter: buildRangeFilter(
            'exercise.interval.civil_start_time',
            startTime,
            endTime
          ),
          pageSize,
          pageToken,
        },
        `exercise from '${startTime}'${endTime ? ` to '${endTime}'` : ''}`
      ),
  });
}
