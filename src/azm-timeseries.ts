import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool, CommonSchemas, dailyRollUp } from './utils.js';
import { VALIDATION_MESSAGES } from './config.js';

/**
 * Registers an Active Zone Minutes time series tool with the MCP server.
 * @param server The McpServer instance.
 * @param getAccessTokenFn Function to retrieve the current access token.
 */
export function registerAzmTimeSeriesTool(
  server: McpServer,
  getAccessTokenFn: () => Promise<string | null>
): void {
  registerTool(server, {
    name: 'get_azm_timeseries',
    description: `Get the raw JSON response for daily Active Zone Minutes (AZM) roll-ups from the Google Health API (dailyRollUp of "active-zone-minutes") over a civil date range. startDate is inclusive, endDate is exclusive. ${VALIDATION_MESSAGES.MAX_RANGE_90_DAYS}.`,
    parametersSchema: {
      startDate: CommonSchemas.startDate,
      endDate: CommonSchemas.endDate,
    },
    handler: async ({
      startDate,
      endDate,
    }: {
      startDate: string;
      endDate: string;
    }) =>
      dailyRollUp(
        'active-zone-minutes',
        getAccessTokenFn,
        { startDate, endDate },
        `AZM data from ${startDate} to ${endDate}`
      ),
  });
}
