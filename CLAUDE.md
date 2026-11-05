# Claude Development Guide

## Project Overview
MCP server for Google Health API integration (the successor to the Fitbit Web API, which ended 2026-11-02) providing health data access (weight, sleep, exercise, activity, heart rate, HRV, nutrition, profile).

**Design Philosophy:** This MCP server acts as a 1:1 JSON proxy to the Google Health API (https://developers.google.com/health). Tools keep their familiar names but their parameters match the Google API (filters, civil/RFC 3339 times, `pageSize`/`pageToken`) and limitations exactly, without client-side data manipulation. Return raw JSON responses from Google Health API calls.

## Development Commands
- `npm run build` - Compile TypeScript to build/ directory
- `npm run start` - Run the built MCP server
- `npm run dev` - Build and run with MCP inspector for testing/debugging
- `npm run lint` - Check code quality and style issues
- `npm run format` - Auto-fix code formatting
- `npm test` - Run tests with Vitest
- `npm run test:coverage` - Run tests with coverage report

## CI/CD
- GitHub Actions workflow runs tests, lint checks, and build on push/PR to main branch
- Located at `.github/workflows/ci.yml`

## Project Structure
- `src/index.ts` - Main MCP server entry point, registers all tools
- `src/auth.ts` - Google OAuth2 flow (state check, offline access, Google Health link verification) with token persistence
- `src/utils.ts` - Shared Google Health API request utilities and filter/roll-up helpers  
- `src/weight.ts` - Weight data tool
- `src/sleep.ts` - Sleep data tool
- `src/activities.ts` - Exercise/activity data tool (date range)
- `src/profile.ts` - User profile tool
- `src/heart-rate.ts` - Heart rate data tools (time series and date range)
- `src/nutrition.ts` - Nutrition data tools (comprehensive food log with macros, plus time series for individual nutrients)
- `src/daily-activity.ts` - Daily activity summary tool (steps, calories, goals, heart rate zones)
- `src/account.ts` - Identity, settings and paired devices tools
- `src/data-points.ts` - Generic `list_data_points` / `reconcile_data_points` tools for any data type
- `src/activity-timeseries.ts` - Activity time series tool (steps, distance, calories over time)
- `src/azm-timeseries.ts` - Active Zone Minutes time series tool
- `src/hrv.ts` - Heart Rate Variability (HRV) tools (single date and date range)
- `src/compat/` - Optional Fitbit-compatible output mode (`GOOGLE_HEALTH_OUTPUT_MODE=fitbit`): `convert.ts` (pure Google→Fitbit shape/unit mappers), `api.ts` (paging, units/time-zone context, zone assembly), `tools.ts` (legacy tool names, `period` params, inclusive end dates)
- `build/` - Compiled JavaScript output
- `.env` - Environment variables (GOOGLE_HEALTH_CLIENT_ID, GOOGLE_HEALTH_CLIENT_SECRET; legacy FITBIT_* accepted as fallback)

## Output Modes
- Default (`google`): 1:1 JSON proxy, as described above. Do not add client-side manipulation here.
- `fitbit` (`GOOGLE_HEALTH_OUTPUT_MODE=fitbit`): deliberate exception for consumers written against the Fitbit Web API (e.g. the "Heather's Coach" Claude project). `src/compat/` replaces the overlapping tools (weight, sleep, daily summary, heart rate, HRV, activity/AZM time series, nutrition) with Fitbit-shaped, imperial-unit versions. Keep all compat logic inside `src/compat/`; never leak it into the proxy tools.
- Zone mapping (verified on real data): Fitbit Fat Burn/Cardio/Peak = Google Moderate/Vigorous/Peak; minutes come from Active Zone Minutes (cardio/peak are 2x, so divide by 2). Google responses may omit civil times, so derive local dates from instants + UTC offsets.

## Code Conventions
- TypeScript with ES modules
- Zod for parameter validation
- All tools return raw JSON from the Google Health API
- Error handling with console.error for debugging
- Use makeGoogleHealthRequest / handleGoogleHealthCall utilities for API calls
- **API Fidelity:** Tool parameters must exactly match Google Health API requirements - no client-side workarounds or data filtering
- **No Abstraction:** If the API only supports a filter on a field, expose that filter - don't invent Fitbit-style `period` parameters
- **Documentation First:** Always check the official Google Health API documentation at https://developers.google.com/health when adding new endpoints to ensure proper parameters, authentication scopes, and response formats
- **CRITICAL: Endpoint URL Construction:** `makeGoogleHealthRequest` prefixes `https://health.googleapis.com/v4/` only. Paths must include the user segment, e.g. `users/me/dataTypes/steps/dataPoints` (use `dataPointsPath()`). Data type names are kebab-case in URLs and snake_case in filters.

## Testing the Server
**Development mode (with inspector):**
1. `npm run dev` - Builds and opens MCP inspector web UI
2. Test tools interactively at http://localhost:5173
3. OAuth flow - server opens browser for authorization

**Production mode:**
1. `npm run build` - Compile TypeScript
2. `npm run start` - Run server directly
3. Tools available after auth: get_weight, get_sleep_by_date_range, get_exercises, get_daily_activity_summary, get_activity_timeseries, get_azm_timeseries, get_profile, get_heart_rate, get_heart_rate_by_date_range, get_food_log, get_nutrition, get_nutrition_by_date_range, get_hrv, get_hrv_by_date_range, get_identity, get_settings, list_paired_devices, list_data_points, reconcile_data_points

## Environment Setup
Requires `.env` file with:
```
GOOGLE_HEALTH_CLIENT_ID=your_client_id
GOOGLE_HEALTH_CLIENT_SECRET=your_client_secret
```

## API Notes
- Single base URL: `https://health.googleapis.com/v4` (JSON over REST)
- All dates in YYYY-MM-DD format
- Token persisted to `.google-health-token.json`; refresh token is only issued with `access_type=offline` + `prompt=consent` and is not returned on refresh
- OAuth: Google OAuth 2.0 (authorize `https://accounts.google.com/o/oauth2/v2/auth`, token `https://oauth2.googleapis.com/token`), scopes `https://www.googleapis.com/auth/googlehealth.{activity_and_fitness,health_metrics_and_measurements,sleep,nutrition,profile,settings}.readonly`
- Testing-mode refresh tokens expire after 7 days; ranges are start-inclusive, end-exclusive; list endpoints paginate with `nextPageToken`

## Contributing & Improvements

When working on this codebase:
1. Follow the existing code style and patterns
2. Update relevant documentation 
3. Test changes thoroughly with the MCP inspector
4. Ensure backward compatibility with existing tools
5. **VERY IMPORTANT:** When you have completed a task, you MUST run both build, test, and lint commands (`npm run build` then `npm run test:coverage` then  `npm run lint`) to ensure your code is correct
6. Update documentation when making changes

**For identified improvement opportunities, see [TASKS.md](TASKS.md)** - this file contains a comprehensive analysis of refactoring opportunities, code quality improvements, and architectural enhancements prioritized by impact and effort.