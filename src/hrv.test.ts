import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerHrvTools } from './hrv.js';
import * as utils from './utils.js';
import { CommonSchemas } from './utils.js';

// Mock the utils module
vi.mock('./utils.js', async (importOriginal) => {
  const actualUtils = await importOriginal<typeof utils>();
  return {
    ...actualUtils,
    registerTool: vi.fn(),
    handleFitbitApiCall: vi.fn(),
  };
});

describe('HRV Tools', () => {
  let mockServer: McpServer;
  let mockGetAccessToken: ReturnType<typeof vi.fn>;
  let mockRegisterTool: ReturnType<typeof vi.fn>;
  let mockHandleFitbitApiCall: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockServer = {} as McpServer;
    mockGetAccessToken = vi.fn();
    mockRegisterTool = vi.mocked(utils.registerTool);
    mockHandleFitbitApiCall = vi.mocked(utils.handleFitbitApiCall);

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('get_hrv', () => {
    const testDate = '2023-01-15';

    it('should register the get_hrv tool with correct configuration', () => {
      registerHrvTools(mockServer, mockGetAccessToken);

      expect(mockRegisterTool).toHaveBeenCalledWith(mockServer, {
        name: 'get_hrv',
        description:
          'Get the raw JSON response for Heart Rate Variability (HRV) summary data from Fitbit for a single date. Returns daily RMSSD and deep sleep RMSSD values.',
        parametersSchema: {
          date: CommonSchemas.date,
        },
        handler: expect.any(Function),
      });
    });

    it('should call handler with correct endpoint and parameters', async () => {
      const mockHrvResponse = {
        hrv: [
          {
            dateTime: '2023-01-15',
            value: { dailyRmssd: 35.2, deepRmssd: 42.1 },
          },
        ],
      };

      mockHandleFitbitApiCall.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(mockHrvResponse) }],
      });

      registerHrvTools(mockServer, mockGetAccessToken);

      // get_hrv is the first registered tool
      const registeredToolConfig = mockRegisterTool.mock.calls[0][1];
      const handler = registeredToolConfig.handler;

      const result = await handler({ date: testDate });

      const expectedEndpoint = `hrv/date/${testDate}.json`;
      expect(mockHandleFitbitApiCall).toHaveBeenCalledWith(
        expectedEndpoint,
        { date: testDate },
        mockGetAccessToken,
        {
          errorContext: `HRV data for ${testDate}`,
        }
      );

      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(mockHrvResponse) }],
      });
    });

    it('should handle API errors gracefully', async () => {
      const errorMessage = 'API error occurred';
      mockHandleFitbitApiCall.mockRejectedValue(new Error(errorMessage));

      registerHrvTools(mockServer, mockGetAccessToken);

      const registeredToolConfig = mockRegisterTool.mock.calls[0][1];
      const handler = registeredToolConfig.handler;

      await expect(handler({ date: testDate })).rejects.toThrow(errorMessage);

      const expectedEndpoint = `hrv/date/${testDate}.json`;
      expect(mockHandleFitbitApiCall).toHaveBeenCalledWith(
        expectedEndpoint,
        { date: testDate },
        mockGetAccessToken,
        {
          errorContext: `HRV data for ${testDate}`,
        }
      );
    });

    it('should handle null access token', async () => {
      mockGetAccessToken.mockResolvedValue(null);
      mockHandleFitbitApiCall.mockRejectedValue(
        new Error('No access token available')
      );

      registerHrvTools(mockServer, mockGetAccessToken);

      const registeredToolConfig = mockRegisterTool.mock.calls[0][1];
      const handler = registeredToolConfig.handler;

      await expect(handler({ date: testDate })).rejects.toThrow(
        'No access token available'
      );
    });
  });

  describe('get_hrv_by_date_range', () => {
    const testStartDate = '2023-01-01';
    const testEndDate = '2023-01-07';

    it('should register the get_hrv_by_date_range tool with correct configuration', () => {
      registerHrvTools(mockServer, mockGetAccessToken);

      expect(mockRegisterTool).toHaveBeenCalledWith(mockServer, {
        name: 'get_hrv_by_date_range',
        description:
          'Get the raw JSON response for Heart Rate Variability (HRV) summary data from Fitbit over a date range (max 30 days). Returns daily RMSSD and deep sleep RMSSD values for each day.',
        parametersSchema: {
          startDate: CommonSchemas.startDate,
          endDate: CommonSchemas.endDate,
        },
        handler: expect.any(Function),
      });
    });

    it('should call handler with correct endpoint and parameters', async () => {
      const mockHrvResponse = {
        hrv: [
          {
            dateTime: '2023-01-01',
            value: { dailyRmssd: 35.2, deepRmssd: 42.1 },
          },
          {
            dateTime: '2023-01-02',
            value: { dailyRmssd: 33.8, deepRmssd: 40.5 },
          },
        ],
      };

      mockHandleFitbitApiCall.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(mockHrvResponse) }],
      });

      registerHrvTools(mockServer, mockGetAccessToken);

      // get_hrv_by_date_range is the second registered tool
      const registeredToolConfig = mockRegisterTool.mock.calls[1][1];
      const handler = registeredToolConfig.handler;

      const result = await handler({
        startDate: testStartDate,
        endDate: testEndDate,
      });

      const expectedEndpoint = `hrv/date/${testStartDate}/${testEndDate}.json`;
      expect(mockHandleFitbitApiCall).toHaveBeenCalledWith(
        expectedEndpoint,
        { startDate: testStartDate, endDate: testEndDate },
        mockGetAccessToken,
        {
          errorContext: `HRV data from ${testStartDate} to ${testEndDate}`,
        }
      );

      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(mockHrvResponse) }],
      });
    });

    it('should handle API errors gracefully', async () => {
      const errorMessage = 'API error occurred';
      mockHandleFitbitApiCall.mockRejectedValue(new Error(errorMessage));

      registerHrvTools(mockServer, mockGetAccessToken);

      const registeredToolConfig = mockRegisterTool.mock.calls[1][1];
      const handler = registeredToolConfig.handler;

      await expect(
        handler({ startDate: testStartDate, endDate: testEndDate })
      ).rejects.toThrow(errorMessage);

      const expectedEndpoint = `hrv/date/${testStartDate}/${testEndDate}.json`;
      expect(mockHandleFitbitApiCall).toHaveBeenCalledWith(
        expectedEndpoint,
        { startDate: testStartDate, endDate: testEndDate },
        mockGetAccessToken,
        {
          errorContext: `HRV data from ${testStartDate} to ${testEndDate}`,
        }
      );
    });

    it('should handle null access token', async () => {
      mockGetAccessToken.mockResolvedValue(null);
      mockHandleFitbitApiCall.mockRejectedValue(
        new Error('No access token available')
      );

      registerHrvTools(mockServer, mockGetAccessToken);

      const registeredToolConfig = mockRegisterTool.mock.calls[1][1];
      const handler = registeredToolConfig.handler;

      await expect(
        handler({ startDate: testStartDate, endDate: testEndDate })
      ).rejects.toThrow('No access token available');
    });
  });

  it('should register both tools', () => {
    registerHrvTools(mockServer, mockGetAccessToken);

    expect(mockRegisterTool).toHaveBeenCalledTimes(2);

    const firstToolConfig = mockRegisterTool.mock.calls[0][1];
    const secondToolConfig = mockRegisterTool.mock.calls[1][1];

    expect(firstToolConfig.name).toBe('get_hrv');
    expect(secondToolConfig.name).toBe('get_hrv_by_date_range');
  });

  it('should have correct parameters schemas', () => {
    registerHrvTools(mockServer, mockGetAccessToken);

    const firstToolConfig = mockRegisterTool.mock.calls[0][1];
    const secondToolConfig = mockRegisterTool.mock.calls[1][1];

    expect(firstToolConfig.parametersSchema).toEqual({
      date: CommonSchemas.date,
    });
    expect(secondToolConfig.parametersSchema).toEqual({
      startDate: CommonSchemas.startDate,
      endDate: CommonSchemas.endDate,
    });
  });
});
