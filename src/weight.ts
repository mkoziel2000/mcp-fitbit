import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerTool,
  CommonSchemas,
  listDataPoints,
  buildRangeFilter,
} from './utils.js';

/**
 * Registers the weight tool with the MCP server (Google Health `weight` data type).
 * @param server The McpServer instance.
 * @param getAccessTokenFn Function to retrieve the current access token.
 */
export function registerWeightTool(
  server: McpServer,
  getAccessTokenFn: () => Promise<string | null>
): void {
  registerTool(server, {
    name: 'get_weight',
    description:
      'Get the raw JSON response for weight data points from the Google Health API (data type "weight"), filtered by sample time. Requires a start timestamp (RFC 3339); the end is optional and exclusive. Supports pagination via pageToken.',
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
        'weight',
        getAccessTokenFn,
        {
          filter: buildRangeFilter(
            'weight.sample_time.physical_time',
            startTime,
            endTime
          ),
          pageSize,
          pageToken,
        },
        `weight from '${startTime}'${endTime ? ` to '${endTime}'` : ''}`
      ),
  });
}
