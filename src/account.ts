import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool, handleGoogleHealthCall } from './utils.js';

/**
 * Registers account-level tools: identity, settings and paired devices.
 * @param server The McpServer instance.
 * @param getAccessTokenFn Function to retrieve the current access token.
 */
export function registerAccountTools(
  server: McpServer,
  getAccessTokenFn: () => Promise<string | null>
): void {
  registerTool(server, {
    name: 'get_identity',
    description:
      "Get the raw JSON response for the user's Google Health identity (legacyUserId and healthUserId). Returns an error if the Google Account is not linked to Google Health.",
    parametersSchema: {},
    handler: async () =>
      handleGoogleHealthCall('users/me/identity', getAccessTokenFn, {
        errorContext: 'identity',
      }),
  });

  registerTool(server, {
    name: 'get_settings',
    description:
      "Get the raw JSON response for the user's Google Health settings (units, locale, time zone, stride settings).",
    parametersSchema: {},
    handler: async () =>
      handleGoogleHealthCall('users/me/settings', getAccessTokenFn, {
        errorContext: 'settings',
      }),
  });

  registerTool(server, {
    name: 'list_paired_devices',
    description:
      'Get the raw JSON response listing the trackers and smartwatches paired to the user (device version and type, battery level, last sync time, features).',
    parametersSchema: {},
    handler: async () =>
      handleGoogleHealthCall('users/me/pairedDevices', getAccessTokenFn, {
        errorContext: 'paired devices',
      }),
  });
}
