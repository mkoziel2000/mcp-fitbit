import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import http from 'http';
import crypto from 'crypto';
import open from 'open';
import path from 'path';
import { AuthorizationCode, Token } from 'simple-oauth2';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import {
  GOOGLE_OAUTH_CONFIG,
  GOOGLE_HEALTH_API_BASE,
  FILE_PATHS,
  ERROR_MESSAGES,
  HTTP_CONFIG,
  resolveClientCredentials,
} from './config.js';

// TypeScript interfaces for token data structures
// The Token interface from simple-oauth2 uses this structure
interface GoogleTokenData extends Token {
  access_token: string;
  // Google only returns a refresh token on the first consent (or with prompt=consent)
  refresh_token?: string;
  expires_in?: number;
  expires_at?: string | Date;
  refresh_token_expires_in?: number;
  scope?: string;
  token_type?: string;
}

interface GoogleOAuthError extends Error {
  message: string;
  response?: {
    text: () => Promise<string>;
    status?: number;
  };
  context?: unknown;
}

// Determine the directory of the current module (build/auth.js)
const currentFilename = fileURLToPath(import.meta.url);
const currentDirname = path.dirname(currentFilename);

// Load environment variables from .env file located in the project root
const envPath = path.resolve(currentDirname, '..', '.env');
dotenv.config({ path: envPath });

// Google OAuth2 Configuration
const clientCredentials = resolveClientCredentials();
const googleConfig = {
  client: {
    id: clientCredentials.id,
    secret: clientCredentials.secret,
  },
  auth: {
    tokenHost: GOOGLE_OAUTH_CONFIG.TOKEN_HOST,
    tokenPath: GOOGLE_OAUTH_CONFIG.TOKEN_PATH,
    authorizeHost: GOOGLE_OAUTH_CONFIG.AUTHORIZE_HOST,
    authorizePath: GOOGLE_OAUTH_CONFIG.AUTHORIZE_PATH,
  },
  options: {
    // Google expects client_id/client_secret in the form body of token requests
    authorizationMethod: 'body' as const,
  },
};

// OAuth2 Redirect URI and local server port
const REDIRECT_URI = GOOGLE_OAUTH_CONFIG.CALLBACK_URI;
const PORT = Number(new URL(REDIRECT_URI).port) || 3000;

// --- State Management ---
// Storage for the access token and token data
let accessToken: string | null = null;
let tokenData: GoogleTokenData | null = null;
// Holds the temporary HTTP server instance used for the OAuth callback
let oauthServer: http.Server | null = null;

// --- File paths for token persistence ---
const TOKEN_FILE_PATH = path.resolve(
  currentDirname,
  '..',
  FILE_PATHS.TOKEN_STORAGE
);

// --- OAuth Client Initialization ---
const oauthClient = new AuthorizationCode(googleConfig);

/**
 * Saves the token data to a file for persistence
 */
async function saveTokenToFile(data: GoogleTokenData): Promise<void> {
  try {
    await fs.writeFile(TOKEN_FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
    console.error(`Token saved to ${TOKEN_FILE_PATH}`);
  } catch (error) {
    console.error(`Error saving token to file: ${error}`);
  }
}

/**
 * Loads the token data from file
 * @returns The token data or null if not found
 */
async function loadTokenFromFile(): Promise<GoogleTokenData | null> {
  try {
    if (!existsSync(TOKEN_FILE_PATH)) {
      console.error(`Token file not found at ${TOKEN_FILE_PATH}`);
      return null;
    }

    const data = await fs.readFile(TOKEN_FILE_PATH, 'utf8');
    const parsedData = JSON.parse(data);
    console.error('Token loaded from file successfully');
    return parsedData;
  } catch (error) {
    console.error(`Error loading token from file: ${error}`);
    return null;
  }
}

/**
 * Checks that the authorized Google Account is linked to Google Health.
 * @returns true when linked (or when the check could not decide), false when
 *          the API reports ACCOUNT_NOT_LINKED.
 */
async function verifyAccountLinked(token: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${GOOGLE_HEALTH_API_BASE}/users/me/identity`,
      {
        headers: {
          'User-Agent': HTTP_CONFIG.USER_AGENT,
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      }
    );
    if (response.ok) {
      console.error('Google Health identity verified.');
      return true;
    }
    const body = await response.text();
    if (response.status === 400 && body.includes('ACCOUNT_NOT_LINKED')) {
      console.error(ERROR_MESSAGES.ACCOUNT_NOT_LINKED);
      return false;
    }
    console.error(
      `Identity check returned HTTP ${response.status}: ${body}. Continuing.`
    );
    return true;
  } catch (error) {
    console.error('Identity check failed, continuing:', error);
    return true;
  }
}

function isExpired(data: GoogleTokenData): boolean {
  if (!data.expires_at) return false;
  // Refresh a minute early to avoid racing the expiry
  return new Date(data.expires_at).getTime() - 60_000 < Date.now();
}

/**
 * Refreshes the access token if it has expired. Google does not return a new
 * refresh token on refresh, so the existing one is carried over.
 */
async function refreshTokenIfNeeded(): Promise<void> {
  if (!tokenData || !isExpired(tokenData)) {
    return;
  }

  const refreshToken = tokenData.refresh_token;
  if (!refreshToken) {
    console.error('Token is expired and no refresh token is available.');
    accessToken = null;
    tokenData = null;
    return;
  }

  console.error('Token is expired. Attempting to refresh...');
  try {
    const accessTokenObj = oauthClient.createToken(tokenData);
    const refreshed = await accessTokenObj.refresh();
    const refreshedData = refreshed.token as GoogleTokenData;
    if (!refreshedData.refresh_token) {
      refreshedData.refresh_token = refreshToken;
    }
    tokenData = refreshedData;
    accessToken = refreshedData.access_token;
    await saveTokenToFile(refreshedData);
    console.error('Token refreshed and saved successfully.');
  } catch (refreshError) {
    console.error('Failed to refresh token:', refreshError);
    accessToken = null;
    tokenData = null;
  }
}

// --- Google Authorization Flow ---

/**
 * Initiates the Google OAuth2 authorization code flow.
 * Starts a temporary local web server to handle the redirect callback.
 * Opens the user's browser to the Google consent page.
 */
export function startAuthorizationFlow(): void {
  // Prevent multiple authorization flows from running simultaneously
  if (oauthServer) {
    console.error('OAuth server is already running.');
    return;
  }
  // Ensure Client ID and Secret are loaded before starting
  if (!googleConfig.client.id || !googleConfig.client.secret) {
    console.error(
      'Error: Google Health Client ID or Secret not found. Check environment variables.'
    );
    return;
  }

  const app = express();

  // CSRF protection: the callback must echo this value
  const expectedState = crypto.randomBytes(16).toString('hex');

  // Generate the Google authorization URL
  const baseAuthorizationUri = new URL(
    oauthClient.authorizeURL({
      redirect_uri: REDIRECT_URI,
      scope: GOOGLE_OAUTH_CONFIG.SCOPES,
      state: expectedState,
    })
  );
  // Request a refresh token, and force the consent screen so one is issued
  baseAuthorizationUri.searchParams.set('access_type', 'offline');
  baseAuthorizationUri.searchParams.set('prompt', 'consent');
  const authorizationUri = baseAuthorizationUri.toString();

  const shutdownServer = (reason: string) => {
    if (oauthServer) {
      oauthServer.close(() => {
        console.error(reason);
      });
      oauthServer = null;
    }
  };

  // Route to initiate the authorization flow by redirecting the user to Google
  app.get('/auth', (req: Request, res: Response) => {
    console.error('Redirecting to Google for authorization...');
    res.redirect(authorizationUri);
  });

  // Callback route that Google redirects to after user authorization
  app.get('/callback', async (req: Request, res: Response) => {
    const code = req.query.code as string;
    const state = req.query.state as string;

    if (req.query.error) {
      console.error(`Authorization denied or failed: ${req.query.error}`);
      res.status(400).send(`Authorization failed: ${req.query.error}`);
      shutdownServer('OAuth server closed after authorization error.');
      return;
    }

    if (state !== expectedState) {
      console.error('OAuth state mismatch in callback.');
      res.status(400).send('Error: Invalid state parameter.');
      shutdownServer('OAuth server closed due to state mismatch.');
      return;
    }

    // Handle cases where the authorization code is missing
    if (!code) {
      console.error('Authorization code missing in callback.');
      res.status(400).send('Error: Authorization code missing.');
      shutdownServer('OAuth server closed due to missing code.');
      return;
    }

    console.error('Received authorization code. Exchanging for token...');
    const tokenParams = { code: code, redirect_uri: REDIRECT_URI };

    try {
      // Exchange the authorization code for an access token
      const tokenResult = await oauthClient.getToken(tokenParams);
      const newToken = tokenResult.token as GoogleTokenData;
      console.error('Access Token received successfully!');

      // Only treat the account as connected once Google Health recognises it
      const linked = await verifyAccountLinked(newToken.access_token);
      if (!linked) {
        res.status(400).send(ERROR_MESSAGES.ACCOUNT_NOT_LINKED);
        return;
      }

      accessToken = newToken.access_token;
      tokenData = newToken;
      await saveTokenToFile(newToken);
      console.error('Token data has been persisted to file');

      res.send(
        'Authorization successful! You can close this window. The MCP Server is now authenticated.'
      );
    } catch (error: unknown) {
      // Handle errors during token exchange
      const typedError = error as GoogleOAuthError;
      console.error(
        'Error obtaining access token:',
        typedError.message || typedError
      );
      if (typedError.response) {
        try {
          const errorDetails = await typedError.response.text();
          console.error('Error details:', errorDetails);
        } catch {
          console.error('Could not parse error response body.');
        }
      }
      res
        .status(500)
        .send('Error obtaining access token. Check MCP server logs.');
    } finally {
      // Ensure the temporary server is always shut down after handling the callback
      shutdownServer('OAuth server closed.');
    }
  });

  // Start the temporary local server
  oauthServer = app.listen(PORT, async () => {
    const authUrl = `http://localhost:${PORT}/auth`;
    console.error(
      `--------------------------------------------------------------------`
    );
    console.error(`ACTION REQUIRED: Google Health Authorization Needed`);
    console.error(`Attempting to open authorization page in your browser:`);
    console.error(authUrl);
    console.error(
      `If the browser doesn't open, please navigate there manually.`
    );
    console.error(`Waiting for authorization callback...`);
    console.error(
      `--------------------------------------------------------------------`
    );
    // Attempt to automatically open the authorization URL in the default browser
    try {
      await open(authUrl);
      console.error(`Browser opened (or attempted).`);
    } catch (err) {
      console.error(`Failed to open browser automatically:`, err);
    }
  });

  // Handle potential errors during server startup
  oauthServer.on('error', (err) => {
    console.error('Error starting temporary OAuth server:', err);
    oauthServer = null;
  });
}

/**
 * Stops a pending authorization callback server (if any) and waits until its
 * port is free, so a new flow can bind to it.
 */
async function stopAuthorizationServer(): Promise<void> {
  const server = oauthServer;
  if (!server) return;
  oauthServer = null;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    // Drop keep-alive connections (e.g. an open browser tab) so close() completes
    (server as { closeAllConnections?: () => void }).closeAllConnections?.();
  });
}

/**
 * Forgets the current token: clears it from memory and deletes the token file.
 * @returns true when a token file was deleted, false when there was none.
 */
export async function clearStoredToken(): Promise<boolean> {
  accessToken = null;
  tokenData = null;
  try {
    await fs.unlink(TOKEN_FILE_PATH);
    console.error(`Token file deleted: ${TOKEN_FILE_PATH}`);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Clears the local tokens and starts a fresh authorization flow. Any flow that
 * is still waiting for a callback is cancelled first. The new token is stored
 * (in memory and on disk) once the user finishes consent in the browser.
 * @returns whether a token file was removed, and the URL that starts consent
 *          (null when the flow could not start, e.g. missing client credentials).
 */
export async function reauthenticate(): Promise<{
  tokenFileCleared: boolean;
  authUrl: string | null;
}> {
  await stopAuthorizationServer();
  const tokenFileCleared = await clearStoredToken();
  startAuthorizationFlow();
  return {
    tokenFileCleared,
    authUrl: oauthServer ? `http://localhost:${PORT}/auth` : null,
  };
}

/**
 * Retrieves the current Google Health access token.
 * Automatically checks for token expiry and refreshes if necessary.
 * @returns The access token string or null if not available.
 */
export async function getAccessToken(): Promise<string | null> {
  if (!tokenData || !accessToken) {
    console.error('No valid access token found.');
    return null;
  }

  await refreshTokenIfNeeded();
  return accessToken;
}

/**
 * Initializes the authentication module.
 * Loads persisted token from file storage if available.
 */
export async function initializeAuth(): Promise<void> {
  console.error('Auth initialized. Checking for persisted token...');

  try {
    tokenData = await loadTokenFromFile();

    if (tokenData && tokenData.access_token) {
      accessToken = tokenData.access_token;
      console.error('Persisted access token loaded successfully.');
      await refreshTokenIfNeeded();
    } else {
      console.error('No valid access token found.');
      tokenData = null;
    }
  } catch (error) {
    console.error('Error during token initialization:', error);
  }
}
