import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerTool,
  CommonSchemas,
  createErrorResponse,
  createSuccessResponse,
  makeGoogleHealthRequest,
  dataPointsPath,
  buildDailyRollUpBody,
  nextDate,
  GoogleHealthApiError,
  type RollUpResponse,
} from './utils.js';
import { ERROR_MESSAGES } from './config.js';

// The Google Health API has no single "daily summary" endpoint, so the summary
// is the daily roll-up of each of these data types for the requested date.
export const DAILY_SUMMARY_DATA_TYPES = [
  'steps',
  'distance',
  'total-calories',
  'active-zone-minutes',
  'floors',
] as const;

/**
 * Registers a daily activity summary tool with the MCP server.
 * @param server The McpServer instance.
 * @param getAccessTokenFn Function to retrieve the current access token.
 */
export function registerDailyActivityTool(
  server: McpServer,
  getAccessTokenFn: () => Promise<string | null>
): void {
  registerTool(server, {
    name: 'get_daily_activity_summary',
    description: `Get the raw JSON daily roll-ups from the Google Health API for a single date, one dailyRollUp call per data type (${DAILY_SUMMARY_DATA_TYPES.join(', ')}), returned together keyed by data type. A data type that fails is reported under its key as an error.`,
    parametersSchema: {
      date: CommonSchemas.date,
    },
    handler: async ({ date }: { date: string }) => {
      const body = buildDailyRollUpBody(date, nextDate(date));

      const entries = await Promise.all(
        DAILY_SUMMARY_DATA_TYPES.map(async (dataType) => {
          try {
            const result = await makeGoogleHealthRequest<RollUpResponse>(
              dataPointsPath(dataType, ':dailyRollUp'),
              getAccessTokenFn,
              { method: 'POST', body }
            );
            return [
              dataType,
              result ?? { error: ERROR_MESSAGES.NO_ACCESS_TOKEN },
            ] as const;
          } catch (error) {
            const message =
              error instanceof GoogleHealthApiError
                ? `HTTP ${error.status}: ${error.body}`
                : String(error);
            return [dataType, { error: message }] as const;
          }
        })
      );

      const summary = Object.fromEntries(entries);
      const allFailed = entries.every(([, value]) => 'error' in value);
      if (allFailed) {
        return createErrorResponse(
          `${ERROR_MESSAGES.API_REQUEST_FAILED} for date '${date}': ${JSON.stringify(summary)}`
        );
      }
      return createSuccessResponse(summary);
    },
  });
}
