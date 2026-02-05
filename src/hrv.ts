import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerTool,
  CommonSchemas,
  handleFitbitApiCall,
  type CommonParams,
} from './utils.js';

interface HrvValue {
  dailyRmssd: number;
  deepRmssd: number;
}

interface HrvEntry {
  dateTime: string;
  value: HrvValue;
}

interface HrvResponse {
  hrv: HrvEntry[];
}

/**
 * Registers Heart Rate Variability (HRV) tools with the MCP server.
 * @param server The McpServer instance.
 * @param getAccessTokenFn Function to retrieve the current access token.
 */
export function registerHrvTools(
  server: McpServer,
  getAccessTokenFn: () => Promise<string | null>
): void {
  // Tool 1: Get HRV summary by single date
  type HrvDateParams = Pick<CommonParams, 'date'>;

  registerTool(server, {
    name: 'get_hrv',
    description:
      'Get the raw JSON response for Heart Rate Variability (HRV) summary data from Fitbit for a single date. Returns daily RMSSD and deep sleep RMSSD values.',
    parametersSchema: {
      date: CommonSchemas.date,
    },
    handler: async ({ date }: HrvDateParams) => {
      const endpoint = `hrv/date/${date}.json`;

      return handleFitbitApiCall<HrvResponse, HrvDateParams>(
        endpoint,
        { date },
        getAccessTokenFn,
        {
          errorContext: `HRV data for ${date}`,
        }
      );
    },
  });

  // Tool 2: Get HRV summary by date range
  type HrvDateRangeParams = Pick<CommonParams, 'startDate' | 'endDate'>;

  registerTool(server, {
    name: 'get_hrv_by_date_range',
    description:
      'Get the raw JSON response for Heart Rate Variability (HRV) summary data from Fitbit over a date range (max 30 days). Returns daily RMSSD and deep sleep RMSSD values for each day.',
    parametersSchema: {
      startDate: CommonSchemas.startDate,
      endDate: CommonSchemas.endDate,
    },
    handler: async ({ startDate, endDate }: HrvDateRangeParams) => {
      const endpoint = `hrv/date/${startDate}/${endDate}.json`;

      return handleFitbitApiCall<HrvResponse, HrvDateRangeParams>(
        endpoint,
        { startDate, endDate },
        getAccessTokenFn,
        {
          errorContext: `HRV data from ${startDate} to ${endDate}`,
        }
      );
    },
  });
}
