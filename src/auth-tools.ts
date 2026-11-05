import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerTool,
  createSuccessResponse,
  createErrorResponse,
} from './utils.js';

export interface ReauthResult {
  tokenFileCleared: boolean;
  authUrl: string | null;
}

/**
 * Registers the re-authorization tool.
 * @param server The McpServer instance.
 * @param reauthenticate Clears the local tokens and starts a new OAuth flow.
 */
export function registerAuthTools(
  server: McpServer,
  reauthenticate: () => Promise<ReauthResult>
): void {
  registerTool(server, {
    name: 'reauthenticate',
    description:
      "Clear this MCP server's locally stored Google Health tokens (memory and .google-health-token.json) and start a new Google sign-in. A browser window opens for consent; once approved, new tokens are saved and the other tools work again without restarting the server. Use when the token has expired (testing-mode refresh tokens last 7 days), was revoked, or the wrong Google account is connected. Cancels any sign-in that is still pending. Verify afterwards with get_identity.",
    parametersSchema: {},
    handler: async () => {
      try {
        const { tokenFileCleared, authUrl } = await reauthenticate();
        if (!authUrl) {
          return createErrorResponse(
            'Local tokens were cleared, but the authorization flow could not start. Check GOOGLE_HEALTH_CLIENT_ID / GOOGLE_HEALTH_CLIENT_SECRET and that the OAuth callback port is free, then call reauthenticate again.'
          );
        }
        return createSuccessResponse({
          status: 'authorization_started',
          tokenFileCleared,
          authUrl,
          next: `Approve access in the browser window that opened (or open ${authUrl} manually). Tools will fail until you finish; then call get_identity to confirm.`,
        });
      } catch (error) {
        console.error('Re-authentication failed:', error);
        return createErrorResponse(
          `Re-authentication failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
  });
}
