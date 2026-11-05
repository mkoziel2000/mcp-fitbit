import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  makeGoogleHealthRequest,
  handleGoogleHealthCall,
  createErrorResponse,
  createSuccessResponse,
  createNoDataResponse,
  registerTool,
  buildRangeFilter,
  buildDailyRollUpBody,
  dataPointsPath,
  toFilterName,
  nextDate,
  listDataPoints,
  dailyRollUp,
  GoogleHealthApiError,
  type ToolConfig,
} from './utils.js';
import { GOOGLE_HEALTH_API_BASE, ERROR_MESSAGES } from './config.js';

global.fetch = vi.fn();
const fetchMock = () => fetch as ReturnType<typeof vi.fn>;

describe('Utility Functions', () => {
  let getToken: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getToken = vi.fn().mockResolvedValue('test_token');
    vi.clearAllMocks();
    getToken.mockResolvedValue('test_token');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('makeGoogleHealthRequest', () => {
    it('makes a GET request with bearer auth and returns JSON', async () => {
      fetchMock().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ foo: 'bar' }),
      });

      const result = await makeGoogleHealthRequest(
        'users/me/profile',
        getToken
      );
      expect(result).toEqual({ foo: 'bar' });
      const [url, init] = fetchMock().mock.calls[0];
      expect(url).toBe(`${GOOGLE_HEALTH_API_BASE}/users/me/profile`);
      expect(init.method).toBe('GET');
      expect(init.headers.Authorization).toBe('Bearer test_token');
      expect(init.body).toBeUndefined();
    });

    it('does not add a /user/-/ prefix and strips a leading slash', async () => {
      fetchMock().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
      await makeGoogleHealthRequest('/users/me/identity', getToken);
      expect(fetchMock().mock.calls[0][0]).toBe(
        `${GOOGLE_HEALTH_API_BASE}/users/me/identity`
      );
    });

    it('encodes query parameters and skips undefined values', async () => {
      fetchMock().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
      await makeGoogleHealthRequest(
        'users/me/dataTypes/steps/dataPoints',
        getToken,
        {
          query: { filter: 'a >= "x"', pageSize: 5, pageToken: undefined },
        }
      );
      expect(fetchMock().mock.calls[0][0]).toBe(
        `${GOOGLE_HEALTH_API_BASE}/users/me/dataTypes/steps/dataPoints?filter=a%20%3E%3D%20%22x%22&pageSize=5`
      );
    });

    it('sends a JSON body with Content-Type on POST', async () => {
      fetchMock().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
      await makeGoogleHealthRequest('p', getToken, {
        method: 'POST',
        body: { a: 1 },
      });
      const init = fetchMock().mock.calls[0][1];
      expect(init.method).toBe('POST');
      expect(init.body).toBe('{"a":1}');
      expect(init.headers['Content-Type']).toBe('application/json');
    });

    it('returns null when no access token is available', async () => {
      getToken.mockResolvedValue(null);
      const result = await makeGoogleHealthRequest('p', getToken);
      expect(result).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        `Error: ${ERROR_MESSAGES.NO_ACCESS_TOKEN}`
      );
    });

    it('throws GoogleHealthApiError on non-retryable errors', async () => {
      fetchMock().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      });
      await expect(
        makeGoogleHealthRequest('p', getToken)
      ).rejects.toMatchObject({
        name: 'GoogleHealthApiError',
        status: 403,
        body: 'Forbidden',
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('logs a token message on 401', async () => {
      fetchMock().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });
      await expect(
        makeGoogleHealthRequest('p', getToken)
      ).rejects.toBeInstanceOf(GoogleHealthApiError);
      expect(console.error).toHaveBeenCalledWith(ERROR_MESSAGES.TOKEN_EXPIRED);
    });

    it('retries 429 and succeeds', async () => {
      fetchMock()
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => 'slow down',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ ok: 1 }),
        });
      const result = await makeGoogleHealthRequest('p', getToken, {
        retryBaseDelayMs: 0,
      });
      expect(result).toEqual({ ok: 1 });
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('gives up after max retries on 504', async () => {
      fetchMock().mockResolvedValue({
        ok: false,
        status: 504,
        text: async () => 'timeout',
      });
      await expect(
        makeGoogleHealthRequest('p', getToken, { retryBaseDelayMs: 0 })
      ).rejects.toMatchObject({ status: 504 });
      expect(fetch).toHaveBeenCalledTimes(4); // initial + 3 retries
    });

    it('returns an empty object for 204 responses', async () => {
      fetchMock().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => null,
      });
      expect(await makeGoogleHealthRequest('p', getToken)).toEqual({});
    });

    it('rethrows network errors', async () => {
      fetchMock().mockRejectedValue(new Error('Network failure'));
      await expect(makeGoogleHealthRequest('p', getToken)).rejects.toThrow(
        'Network failure'
      );
    });
  });

  describe('helpers', () => {
    it('builds data point paths and filter names', () => {
      expect(dataPointsPath('body-fat')).toBe(
        'users/me/dataTypes/body-fat/dataPoints'
      );
      expect(dataPointsPath('sleep', ':reconcile')).toBe(
        'users/me/dataTypes/sleep/dataPoints:reconcile'
      );
      expect(toFilterName('body-fat')).toBe('body_fat');
    });

    it('builds range filters (end exclusive, optional)', () => {
      expect(buildRangeFilter('f', 'a')).toBe('f >= "a"');
      expect(buildRangeFilter('f', 'a', 'b')).toBe('f >= "a" AND f < "b"');
    });

    it('computes the next date across month and year boundaries', () => {
      expect(nextDate('2026-03-04')).toBe('2026-03-05');
      expect(nextDate('2026-02-28')).toBe('2026-03-01');
      expect(nextDate('2026-12-31')).toBe('2027-01-01');
    });

    it('builds a daily roll-up body', () => {
      expect(buildDailyRollUpBody('2026-07-28', '2026-07-30')).toEqual({
        range: {
          start: { date: { year: 2026, month: 7, day: 28 }, time: {} },
          end: { date: { year: 2026, month: 7, day: 30 }, time: {} },
        },
        windowSizeDays: 1,
      });
      expect(
        buildDailyRollUpBody('2026-07-28', '2026-07-30', {
          windowSizeDays: 2,
          dataSourceFamily: 'users/me/dataSourceFamilies/google-wearables',
        })
      ).toMatchObject({
        windowSizeDays: 2,
        dataSourceFamily: 'users/me/dataSourceFamilies/google-wearables',
      });
    });
  });

  describe('Response helpers', () => {
    it('formats error, success and no-data responses', () => {
      expect(createErrorResponse('x')).toEqual({
        content: [{ type: 'text', text: 'x' }],
        isError: true,
      });
      expect(createSuccessResponse({ a: 1 })).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ a: 1 }, null, 2) }],
      });
      expect(createNoDataResponse('ctx')).toEqual({
        content: [
          { type: 'text', text: `${ERROR_MESSAGES.NO_DATA_FOUND} ctx.` },
        ],
      });
    });
  });

  describe('registerTool', () => {
    it('calls server.tool with the config', () => {
      const server = { tool: vi.fn() } as unknown as McpServer;
      const config: ToolConfig = {
        name: 't',
        description: 'd',
        parametersSchema: {},
        handler: vi.fn(),
      };
      registerTool(server, config);
      expect(server.tool).toHaveBeenCalledWith('t', 'd', {}, config.handler);
    });
  });

  describe('handleGoogleHealthCall', () => {
    it('returns success JSON', async () => {
      fetchMock().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ d: 1 }),
      });
      expect(await handleGoogleHealthCall('p', getToken)).toEqual(
        createSuccessResponse({ d: 1 })
      );
    });

    it('returns an error response when there is no token', async () => {
      getToken.mockResolvedValue(null);
      const result = await handleGoogleHealthCall('p', getToken, {
        errorContext: 'ctx',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        `${ERROR_MESSAGES.API_REQUEST_FAILED} for ctx`
      );
    });

    it('includes the HTTP status and Google error body', async () => {
      fetchMock().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => '{"error":"insufficient scope"}',
      });
      const result = await handleGoogleHealthCall('p', getToken, {
        errorContext: 'ctx',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('HTTP 403');
      expect(result.content[0].text).toContain('insufficient scope');
    });

    it('maps ACCOUNT_NOT_LINKED to a helpful message', async () => {
      fetchMock().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () =>
          '{"error":{"details":[{"reason":"ACCOUNT_NOT_LINKED"}]}}',
      });
      const result = await handleGoogleHealthCall('p', getToken);
      expect(result).toEqual(
        createErrorResponse(ERROR_MESSAGES.ACCOUNT_NOT_LINKED)
      );
    });

    it('reports network failures as error responses', async () => {
      fetchMock().mockRejectedValue(new Error('boom'));
      const result = await handleGoogleHealthCall('p', getToken, {
        errorContext: 'ctx',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('boom');
    });

    it('returns a no-data response when the extractor yields nothing', async () => {
      fetchMock().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ items: [] }),
      });
      const result = await handleGoogleHealthCall<{ items: unknown[] }>(
        'p',
        getToken,
        {
          successDataExtractor: (d) => d.items,
          noDataMessage: 'nothing',
        }
      );
      expect(result).toEqual(createNoDataResponse('nothing'));
    });

    it('returns data when the extractor yields items', async () => {
      const data = { items: [1] };
      fetchMock().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => data,
      });
      const result = await handleGoogleHealthCall<typeof data>('p', getToken, {
        successDataExtractor: (d) => d.items,
      });
      expect(result).toEqual(createSuccessResponse(data));
    });
  });

  describe('listDataPoints / dailyRollUp', () => {
    it('lists data points with filter and pagination', async () => {
      fetchMock().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ dataPoints: [{ a: 1 }] }),
      });
      await listDataPoints(
        'steps',
        getToken,
        { filter: 'f', pageSize: 2, pageToken: 'tok' },
        'ctx'
      );
      expect(fetchMock().mock.calls[0][0]).toBe(
        `${GOOGLE_HEALTH_API_BASE}/users/me/dataTypes/steps/dataPoints?filter=f&pageSize=2&pageToken=tok`
      );
    });

    it('reports no data when dataPoints is missing', async () => {
      fetchMock().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
      const result = await listDataPoints('steps', getToken, {}, 'ctx');
      expect(result).toEqual(createNoDataResponse('ctx'));
    });

    it('posts a daily roll-up', async () => {
      fetchMock().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ rollupDataPoints: [{ a: 1 }] }),
      });
      await dailyRollUp(
        'steps',
        getToken,
        {
          startDate: '2026-07-28',
          endDate: '2026-07-29',
          pageSize: 7,
          pageToken: 't',
        },
        'ctx'
      );
      const [url, init] = fetchMock().mock.calls[0];
      expect(url).toBe(
        `${GOOGLE_HEALTH_API_BASE}/users/me/dataTypes/steps/dataPoints:dailyRollUp`
      );
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toMatchObject({
        windowSizeDays: 1,
        pageSize: 7,
        pageToken: 't',
      });
    });
  });
});
