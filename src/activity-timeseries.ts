import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { registerTool, CommonSchemas, dailyRollUp } from './utils.js';

export const ACTIVITY_DATA_TYPES = [
  'steps',
  'distance',
  'total-calories',
  'active-energy-burned',
  'floors',
  'active-minutes',
] as const;

/**
 * Registers an activity time series tool with the MCP server.
 * @param server The McpServer instance.
 * @param getAccessTokenFn Function to retrieve the current access token.
 */
export function registerActivityTimeSeriesTool(
  server: McpServer,
  getAccessTokenFn: () => Promise<string | null>
): void {
  registerTool(server, {
    name: 'get_activity_timeseries',
    description:
      "Get the raw JSON response for daily activity roll-ups from the Google Health API (dailyRollUp) over a civil date range. Supports data types 'steps', 'distance', 'total-calories', 'active-energy-burned', 'floors', 'active-minutes'. startDate is inclusive, endDate is exclusive. Note: The API allows at most 90 days per request (14 days for 'total-calories' and 'active-minutes').",
    parametersSchema: {
      dataType: z
        .enum(ACTIVITY_DATA_TYPES)
        .describe("Activity data type to roll up (e.g., 'steps', 'distance')"),
      startDate: CommonSchemas.startDate,
      endDate: CommonSchemas.endDate,
    },
    handler: async ({
      dataType,
      startDate,
      endDate,
    }: {
      dataType: (typeof ACTIVITY_DATA_TYPES)[number];
      startDate: string;
      endDate: string;
    }) =>
      dailyRollUp(
        dataType,
        getAccessTokenFn,
        { startDate, endDate },
        `data type '${dataType}' from ${startDate} to ${endDate}`
      ),
  });
}
