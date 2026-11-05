import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  registerTool,
  CommonSchemas,
  listDataPoints,
  handleGoogleHealthCall,
  dataPointsPath,
  type DataPointsResponse,
} from './utils.js';
import { DATA_TYPES } from './config.js';

const dataTypeSchema = z
  .enum(DATA_TYPES)
  .describe('Google Health data type (kebab-case), e.g. "steps", "body-fat"');

const filterSchema = z
  .string()
  .optional()
  .describe(
    'Optional filter, e.g. steps.interval.civil_start_time >= "2026-03-04T00:00:00". Data type names are snake_case inside filters'
  );

/**
 * Registers generic data point tools (escape hatches for any data type).
 * @param server The McpServer instance.
 * @param getAccessTokenFn Function to retrieve the current access token.
 */
export function registerDataPointTools(
  server: McpServer,
  getAccessTokenFn: () => Promise<string | null>
): void {
  registerTool(server, {
    name: 'list_data_points',
    description:
      'Get the raw JSON response for data points of any Google Health data type (GET users/me/dataTypes/{type}/dataPoints), with an optional raw filter. Use this for data types not covered by the named tools.',
    parametersSchema: {
      dataType: dataTypeSchema,
      filter: filterSchema,
      pageSize: CommonSchemas.pageSize,
      pageToken: CommonSchemas.pageToken,
    },
    handler: async ({
      dataType,
      filter,
      pageSize,
      pageToken,
    }: {
      dataType: (typeof DATA_TYPES)[number];
      filter?: string;
      pageSize?: number;
      pageToken?: string;
    }) =>
      listDataPoints(
        dataType,
        getAccessTokenFn,
        { filter, pageSize, pageToken },
        `data type '${dataType}'`
      ),
  });

  registerTool(server, {
    name: 'reconcile_data_points',
    description:
      'Get the raw JSON response for reconciled data points of any Google Health data type (GET .../dataPoints:reconcile). Reconciling removes overlapping intervals across devices and sync batches, so use it for timelines and durations.',
    parametersSchema: {
      dataType: dataTypeSchema,
      filter: filterSchema,
      dataSourceFamily: CommonSchemas.dataSourceFamily,
      pageSize: CommonSchemas.pageSize,
      pageToken: CommonSchemas.pageToken,
    },
    handler: async ({
      dataType,
      filter,
      dataSourceFamily,
      pageSize,
      pageToken,
    }: {
      dataType: (typeof DATA_TYPES)[number];
      filter?: string;
      dataSourceFamily?: string;
      pageSize?: number;
      pageToken?: string;
    }) =>
      handleGoogleHealthCall<DataPointsResponse>(
        dataPointsPath(dataType, ':reconcile'),
        getAccessTokenFn,
        {
          query: { filter, dataSourceFamily, pageSize, pageToken },
          successDataExtractor: (data) => data.dataPoints,
          errorContext: `reconciled data type '${dataType}'`,
        }
      ),
  });
}
