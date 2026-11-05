import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockUnlink = vi.fn().mockResolvedValue(undefined);
const mockExistsSync = vi.fn();
const mockRefresh = vi.fn();
const mockCreateToken = vi.fn(() => ({ refresh: mockRefresh }));
const mockGetToken = vi.fn();
const mockAuthorizeURL = vi.fn();
const mockAuthorizationCode = vi.fn(() => ({
  createToken: mockCreateToken,
  getToken: mockGetToken,
  authorizeURL: mockAuthorizeURL,
}));

const routes: Record<
  string,
  (req: unknown, res: unknown) => Promise<void> | void
> = {};
const mockClose = vi.fn((cb?: () => void) => cb?.());
const mockListen = vi.fn(() => ({ close: mockClose, on: vi.fn() }));
const mockOpen = vi.fn().mockResolvedValue(undefined);

vi.doMock('dotenv', () => ({ default: { config: vi.fn() } }));
vi.doMock('fs/promises', () => ({
  default: {
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    unlink: mockUnlink,
  },
}));
vi.doMock('fs', () => ({ existsSync: mockExistsSync }));
vi.doMock('simple-oauth2', () => ({
  AuthorizationCode: mockAuthorizationCode,
}));
vi.doMock('open', () => ({ default: mockOpen }));
vi.doMock('express', () => ({
  default: () => ({
    get: (path: string, handler: (req: unknown, res: unknown) => void) => {
      routes[path] = handler;
    },
    listen: mockListen,
  }),
}));

const past = new Date(Date.now() - 3600_000).toISOString();
const future = new Date(Date.now() + 3600_000).toISOString();

function mockResponse() {
  const res = {
    status: vi.fn(() => res),
    send: vi.fn(),
    redirect: vi.fn(),
  };
  return res;
}

describe('auth', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    for (const key of Object.keys(routes)) delete routes[key];
    process.env.GOOGLE_HEALTH_CLIENT_ID = 'id';
    process.env.GOOGLE_HEALTH_CLIENT_SECRET = 'secret';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('configures the Google OAuth endpoints with body client auth', async () => {
    await import('./auth.js');
    expect(mockAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({
          tokenHost: 'https://oauth2.googleapis.com',
          tokenPath: '/token',
          authorizeHost: 'https://accounts.google.com',
          authorizePath: '/o/oauth2/v2/auth',
        }),
        options: { authorizationMethod: 'body' },
      })
    );
  });

  it('loads a valid persisted token without refreshing', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        access_token: 'a',
        refresh_token: 'r',
        expires_at: future,
      })
    );
    const auth = await import('./auth.js');
    await auth.initializeAuth();
    expect(await auth.getAccessToken()).toBe('a');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('returns null when no token file exists', async () => {
    mockExistsSync.mockReturnValue(false);
    const auth = await import('./auth.js');
    await auth.initializeAuth();
    expect(await auth.getAccessToken()).toBeNull();
  });

  it('refreshes an expired token and keeps the original refresh token', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        access_token: 'old',
        refresh_token: 'keep-me',
        expires_at: past,
      })
    );
    // Google does not return a refresh_token on refresh
    mockRefresh.mockResolvedValue({
      token: { access_token: 'new', expires_at: future },
    });
    const auth = await import('./auth.js');
    await auth.initializeAuth();

    expect(await auth.getAccessToken()).toBe('new');
    const saved = JSON.parse(mockWriteFile.mock.calls.at(-1)![1]);
    expect(saved.access_token).toBe('new');
    expect(saved.refresh_token).toBe('keep-me');
  });

  it('clears the token when refresh fails', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        access_token: 'old',
        refresh_token: 'r',
        expires_at: past,
      })
    );
    mockRefresh.mockRejectedValue(new Error('invalid_grant'));
    const auth = await import('./auth.js');
    await auth.initializeAuth();
    expect(await auth.getAccessToken()).toBeNull();
  });

  it('clears an expired token that has no refresh token', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify({ access_token: 'old', expires_at: past })
    );
    const auth = await import('./auth.js');
    await auth.initializeAuth();
    expect(await auth.getAccessToken()).toBeNull();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  describe('re-authentication', () => {
    const loadToken = async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(
        JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: future })
      );
      mockAuthorizeURL.mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?x=1');
      const auth = await import('./auth.js');
      await auth.initializeAuth();
      expect(await auth.getAccessToken()).toBe('a');
      return auth;
    };

    it('clears memory and the token file, then starts a new flow', async () => {
      const auth = await loadToken();
      const result = await auth.reauthenticate();

      expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('.google-health-token.json'));
      expect(await auth.getAccessToken()).toBeNull();
      expect(mockListen).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ tokenFileCleared: true, authUrl: 'http://localhost:3000/auth' });
    });

    it('works when there is no token file to delete', async () => {
      mockUnlink.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'ENOENT' }));
      mockAuthorizeURL.mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?x=1');
      const auth = await import('./auth.js');
      const result = await auth.reauthenticate();
      expect(result.tokenFileCleared).toBe(false);
      expect(result.authUrl).toBe('http://localhost:3000/auth');
    });

    it('propagates unexpected file errors and does not start a flow', async () => {
      mockUnlink.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EPERM' }));
      const auth = await import('./auth.js');
      await expect(auth.reauthenticate()).rejects.toThrow('denied');
      expect(mockListen).not.toHaveBeenCalled();
    });

    it('cancels a pending flow before starting the new one', async () => {
      mockAuthorizeURL.mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?x=1');
      const auth = await import('./auth.js');
      auth.startAuthorizationFlow();
      expect(mockListen).toHaveBeenCalledTimes(1);

      await auth.reauthenticate();
      expect(mockClose).toHaveBeenCalledTimes(1);
      expect(mockListen).toHaveBeenCalledTimes(2);
    });

    it('reports no auth URL when the flow cannot start', async () => {
      delete process.env.GOOGLE_HEALTH_CLIENT_ID;
      delete process.env.FITBIT_CLIENT_ID;
      const auth = await import('./auth.js');
      const result = await auth.reauthenticate();
      expect(result.authUrl).toBeNull();
    });
  });

  describe('authorization flow', () => {
    async function startFlow() {
      mockAuthorizeURL.mockImplementation(
        (p: { state: string }) =>
          `https://accounts.google.com/o/oauth2/v2/auth?client_id=id&state=${p.state}`
      );
      const auth = await import('./auth.js');
      auth.startAuthorizationFlow();
      return auth;
    }

    it('adds offline access and consent prompt to the authorize URL', async () => {
      await startFlow();
      const res = mockResponse();
      routes['/auth']({}, res);
      const url = new URL(res.redirect.mock.calls[0][0]);
      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('prompt')).toBe('consent');
      expect(url.searchParams.get('state')).toBeTruthy();
      expect(mockAuthorizeURL).toHaveBeenCalledWith(
        expect.objectContaining({
          redirect_uri: 'http://localhost:3000/callback',
          scope: expect.stringContaining('googlehealth.sleep.readonly'),
        })
      );
    });

    it('rejects a callback with a mismatched state', async () => {
      await startFlow();
      const res = mockResponse();
      await routes['/callback']({ query: { code: 'c', state: 'wrong' } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockGetToken).not.toHaveBeenCalled();
    });

    it('handles an authorization error from Google', async () => {
      await startFlow();
      const res = mockResponse();
      await routes['/callback']({ query: { error: 'access_denied' } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockGetToken).not.toHaveBeenCalled();
    });

    async function stateFrom() {
      const res = mockResponse();
      routes['/auth']({}, res);
      return new URL(res.redirect.mock.calls[0][0]).searchParams.get('state')!;
    }

    it('rejects a callback without a code', async () => {
      await startFlow();
      const state = await stateFrom();
      const res = mockResponse();
      await routes['/callback']({ query: { state } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('exchanges the code, verifies the identity and persists the token', async () => {
      const auth = await startFlow();
      const state = await stateFrom();
      mockGetToken.mockResolvedValue({
        token: {
          access_token: 'tok',
          refresh_token: 'ref',
          expires_at: future,
        },
      });
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
      });

      const res = mockResponse();
      await routes['/callback']({ query: { code: 'abc', state } }, res);

      expect(mockGetToken).toHaveBeenCalledWith({
        code: 'abc',
        redirect_uri: 'http://localhost:3000/callback',
      });
      expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
        'https://health.googleapis.com/v4/users/me/identity'
      );
      expect(mockWriteFile).toHaveBeenCalled();
      expect(await auth.getAccessToken()).toBe('tok');
      expect(res.send).toHaveBeenCalledWith(
        expect.stringContaining('successful')
      );
    });

    it('does not persist the token when the account is not linked', async () => {
      const auth = await startFlow();
      const state = await stateFrom();
      mockGetToken.mockResolvedValue({ token: { access_token: 'tok' } });
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'ACCOUNT_NOT_LINKED',
      });

      const res = mockResponse();
      await routes['/callback']({ query: { code: 'abc', state } }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(await auth.getAccessToken()).toBeNull();
    });

    it('continues when the identity check fails for another reason', async () => {
      await startFlow();
      const state = await stateFrom();
      mockGetToken.mockResolvedValue({ token: { access_token: 'tok' } });
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'forbidden',
      });
      const res = mockResponse();
      await routes['/callback']({ query: { code: 'abc', state } }, res);
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('reports token exchange failures', async () => {
      await startFlow();
      const state = await stateFrom();
      mockGetToken.mockRejectedValue(new Error('invalid_grant'));
      const res = mockResponse();
      await routes['/callback']({ query: { code: 'abc', state } }, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('does nothing without client credentials', async () => {
      delete process.env.GOOGLE_HEALTH_CLIENT_ID;
      delete process.env.FITBIT_CLIENT_ID;
      const auth = await import('./auth.js');
      auth.startAuthorizationFlow();
      expect(mockListen).not.toHaveBeenCalled();
    });
  });
});
