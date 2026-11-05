import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool, handleGoogleHealthCall } from './utils.js';

/**
 * Registers the profile tool with the MCP server.
 * @param server The McpServer instance.
 * @param getAccessTokenFn Function to retrieve the current access token.
 */
export function registerProfileTool(
  server: McpServer,
  getAccessTokenFn: () => Promise<string | null>
): void {
  registerTool(server, {
    name: 'get_profile',
    description:
      "Get the raw JSON response for the user's Google Health profile (age, membership start date, stride lengths).",
    parametersSchema: {},
    handler: async () =>
      handleGoogleHealthCall('users/me/profile', getAccessTokenFn, {
        errorContext: 'profile data',
      }),
  });
}
