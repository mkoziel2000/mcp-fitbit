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
  resolveTokenPath,
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
// A refresh already running, so parallel callers share one Google request
let refreshInFlight: Promise<void> | null = null;
// Refresh token Google rejected with invalid_grant. A copy of it found on disk
// is ignored, so an unauthenticated session doesn't retry it on every call.
let rejectedRefreshToken: string | null = null;

// How many times a refresh is tried before giving up for now
const REFRESH_MAX_ATTEMPTS = 3;

// --- File path for token persistence (per-user, outside the install dir) ---
const TOKEN_FILE_PATH = resolveTokenPath();

// --- OAuth Client Initialization ---
const oauthClient = new AuthorizationCode(googleConfig);

/**
 * Saves the token data to a file for persistence. The write is atomic (temp
 * file + rename) so a session starting at the same moment never reads a
 * half-written file.
 * @returns null on success, otherwise a description of why the save failed.
 */
async function saveTokenToFile(data: GoogleTokenData): Promise<string | null> {
  const tempPath = `${TOKEN_FILE_PATH}.${process.pid}.tmp`;
  try {
    await fs.mkdir(path.dirname(TOKEN_FILE_PATH), { recursive: true });
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fs.rename(tempPath, TOKEN_FILE_PATH);
    console.error(`Token saved to ${TOKEN_FILE_PATH}`);
    return null;
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    const reason = error instanceof Error ? error.message : String(error);
    console.error(
      `Error saving token to ${TOKEN_FILE_PATH}: ${reason}. ` +
        `You will have to sign in again next session. ` +
        `Set ${FILE_PATHS.TOKEN_PATH_ENV} to a writable file path.`
    );
    return reason;
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

function isExpired(data: GoogleTokenData, marginMs = 60_000): boolean {
  if (!data.expires_at) return false;
  // By default refresh a minute early to avoid racing the expiry
  return new Date(data.expires_at).getTime() - marginMs < Date.now();
}

function forgetTokenInMemory(): void {
  accessToken = null;
  tokenData = null;
}

interface RefreshErrorShape {
  message?: string;
  output?: { statusCode?: number };
  data?: { payload?: unknown; res?: { statusCode?: number } };
}

/** The error text plus Google's response body (e.g. {"error":"invalid_grant"}). */
function describeRefreshError(error: unknown): string {
  const e = error as RefreshErrorShape;
  const payload = e?.data?.payload;
  const body =
    payload === undefined
      ? ''
      : ` ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`;
  return `${e?.message ?? String(error)}${body}`;
}

/** invalid_grant: the refresh token is expired, revoked or otherwise dead. */
function isInvalidGrant(error: unknown): boolean {
  return describeRefreshError(error).includes('invalid_grant');
}

/** A client error (4xx, except timeout/rate limit): retrying cannot help. */
function isNonRetryable(error: unknown): boolean {
  const e = error as RefreshErrorShape;
  const status = e?.output?.statusCode ?? e?.data?.res?.statusCode;
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  );
}

async function refreshAccessToken(): Promise<void> {
  const current = tokenData;
  if (!current) return;

  const refreshToken = current.refresh_token;
  if (!refreshToken) {
    console.error('Token is expired and no refresh token is available.');
    forgetTokenInMemory();
    return;
  }

  for (let attempt = 1; attempt <= REFRESH_MAX_ATTEMPTS; attempt++) {
    console.error(
      `Token is expired. Attempting to refresh (attempt ${attempt}/${REFRESH_MAX_ATTEMPTS})...`
    );
    try {
      const refreshed = await oauthClient.createToken(current).refresh();
      const refreshedData = refreshed.token as GoogleTokenData;
      // Google does not return a refresh token on refresh: keep the existing one
      if (!refreshedData.refresh_token) {
        refreshedData.refresh_token = refreshToken;
      }
      tokenData = refreshedData;
      accessToken = refreshedData.access_token;
      await saveTokenToFile(refreshedData);
      console.error('Token refreshed successfully.');
      return;
    } catch (error) {
      const detail = describeRefreshError(error);
      if (isInvalidGrant(error)) {
        // Only this means the refresh token itself is dead and sign-in is needed
        console.error(
          `Google rejected the refresh token (invalid_grant): ${detail}. Sign-in is required.`
        );
        rejectedRefreshToken = refreshToken;
        forgetTokenInMemory();
        return;
      }
      console.error(`Token refresh attempt ${attempt} failed: ${detail}`);
      if (isNonRetryable(error)) {
        console.error(
          'Google refused the refresh request. Check GOOGLE_HEALTH_CLIENT_ID / GOOGLE_HEALTH_CLIENT_SECRET match the client that issued the token.'
        );
        break;
      }
      if (attempt < REFRESH_MAX_ATTEMPTS) {
        const delayMs = HTTP_CONFIG.RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  // The stored token is kept: a network blip must not force a new sign-in
  console.error(
    'Could not refresh the token right now. Keeping it and retrying on the next request.'
  );
}

/**
 * Refreshes the access token if it has expired. Parallel callers share a single
 * refresh. Only an invalid_grant response discards the token; any other
 * failure keeps it so a later call can try again.
 */
function refreshTokenIfNeeded(): Promise<void> {
  if (!tokenData || !isExpired(tokenData)) {
    return Promise.resolve();
  }
  refreshInFlight ??= refreshAccessToken().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/**
 * Loads the stored token into memory. Also called when a session has no token,
 * to pick up one that another session has saved since startup.
 */
async function loadPersistedToken(): Promise<void> {
  const stored = await loadTokenFromFile();
  // A refresh may have set a newer token while we were reading the file
  if (tokenData || !stored || !stored.access_token) return;
  if (rejectedRefreshToken && stored.refresh_token === rejectedRefreshToken) {
    return;
  }
  tokenData = stored;
  accessToken = stored.access_token;
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
      rejectedRefreshToken = null;
      const saveError = await saveTokenToFile(newToken);

      res.send(
        saveError
          ? `Authorization successful for this session, but the token could not be saved (${saveError}). You will have to sign in again next session. Set ${FILE_PATHS.TOKEN_PATH_ENV} to a writable file path.`
          : 'Authorization successful! You can close this window. The MCP Server is now authenticated.'
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
  forgetTokenInMemory();
  rejectedRefreshToken = null;
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
  if (!tokenData) {
    // Another session may have signed in and saved a token since we started
    await loadPersistedToken();
  }
  if (!tokenData || !accessToken) {
    console.error('No valid access token found.');
    return null;
  }

  await refreshTokenIfNeeded();
  if (!tokenData || !accessToken) {
    return null;
  }
  // A temporary refresh failure keeps the token but leaves it expired
  if (isExpired(tokenData, 0)) {
    return null;
  }
  return accessToken;
}

/**
 * Whether the user has to sign in: there is no stored token, or Google rejected
 * the refresh token. False while a stored token exists but could not be
 * refreshed yet (e.g. offline), which a later request can still recover.
 */
export function isAuthorizationRequired(): boolean {
  return !tokenData;
}

/**
 * Initializes the authentication module.
 * Loads persisted token from file storage if available.
 */
export async function initializeAuth(): Promise<void> {
  console.error(`Auth initialized. Token file: ${TOKEN_FILE_PATH}`);

  try {
    await loadPersistedToken();

    if (tokenData) {
      console.error('Persisted access token loaded successfully.');
      await refreshTokenIfNeeded();
    } else {
      console.error('No valid access token found.');
    }
  } catch (error) {
    console.error('Error during token initialization:', error);
  }
}
