# Google Health (Fitbit) MCP Connector for AI

[![CI](https://github.com/TheDigitalNinja/mcp-fitbit/actions/workflows/ci.yml/badge.svg)](https://github.com/TheDigitalNinja/mcp-fitbit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Connect AI assistants to your Fitbit / Pixel Watch health data through the **Google Health API**

The legacy Fitbit Web API was shut down on **2 November 2026**. Google replaced it with the
[Google Health API](https://developers.google.com/health), which uses Google OAuth 2.0. This server now talks to
the Google Health API and returns its raw JSON.

## What it does

🏃 **Exercise & Activities** - Workout sessions and daily activity roll-ups
😴 **Sleep Analysis** - Sleep sessions
⚖️ **Weight Tracking** - Weight data points
❤️ **Heart Rate Data** - Samples, daily roll-ups and HRV
🍎 **Nutrition Logs** - Food log, calories, macros and water
👤 **Profile & Devices** - Profile, settings, identity and paired trackers

*Ask your AI things like: "Show me my sleep patterns this week" or "What's my step count trend this month?"*

## ⚠️ Breaking changes from the Fitbit version

- You must create a **Google Cloud** OAuth client (see below) and re-authorize. Old Fitbit tokens cannot be reused.
- Credentials are now `GOOGLE_HEALTH_CLIENT_ID` / `GOOGLE_HEALTH_CLIENT_SECRET`.- The token file is now `.google-health-token.json` (the old `.fitbit-token.json` is ignored and can be deleted).
- Responses are the Google Health API's JSON, not Fitbit's. Fitbit-style `period` (`1d`, `7d`, ...) parameters are gone: tools take explicit start/end times, as the API does.
- `get_activity_goals` was removed: the Google Health API has no goals endpoint.
- New tools: `get_identity`, `get_settings`, `list_paired_devices`, `list_data_points`, `reconcile_data_points`.

## Setup

### 1. Link your account to Google Health

In the **Google Health mobile app**, tap **Sign in with Google** and choose the Google Account to use (this creates a
Google Health profile or migrates your existing Fitbit account). Without this, the API returns `ACCOUNT_NOT_LINKED`.

### 2. Create Google OAuth credentials

1. In the [Google Cloud Console](https://console.cloud.google.com/), create (or pick) a project.
2. [Enable the Google Health API](https://console.developers.google.com/apis/library/health.googleapis.com).
3. Create an **OAuth client ID** of type **Web application** and add the authorized redirect URI
   `http://localhost:3000/callback`. Note the **Client ID** and **Client secret**.
4. On the [OAuth consent screen / Audience](https://console.developers.google.com/auth/audience) page, keep the user
   type **External** and add your Google Account under **Test users**.
5. On the [Data Access](https://console.developers.google.com/auth/scopes) page, add these scopes (all read-only):
   - `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`
   - `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly`
   - `https://www.googleapis.com/auth/googlehealth.sleep.readonly`
   - `https://www.googleapis.com/auth/googlehealth.nutrition.readonly`
   - `https://www.googleapis.com/auth/googlehealth.profile.readonly`
   - `https://www.googleapis.com/auth/googlehealth.settings.readonly`

> **Refresh tokens in Testing mode expire after 7 days.** For a personal tool, set the app's publishing status to
> **In production** (an unverified app is limited to 100 users and shows a warning screen at consent, which is fine
> for your own account). Verification is only required beyond that.

### 3. Install and configure

**From npm:**
```bash
npm install -g mcp-fitbit
```

**From source:**
```bash
git clone https://github.com/TheDigitalNinja/mcp-fitbit
cd mcp-fitbit
npm install
npm run build
```

Create a `.env` file in the package directory (the server prints the expected path if it is missing):
```bash
GOOGLE_HEALTH_CLIENT_ID=your_client_id_here
GOOGLE_HEALTH_CLIENT_SECRET=your_client_secret_here
```

### 4. Claude Desktop

Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "google-health": {
      "command": "mcp-fitbit",
      "args": [],
      "env": {
        "GOOGLE_HEALTH_CLIENT_ID": "your_client_id_here",
        "GOOGLE_HEALTH_CLIENT_SECRET": "your_client_secret_here"
      }
    }
  }
}
```
For a local build use `"command": "node", "args": ["C:\\path\\to\\mcp-fitbit\\build\\index.js"]`.

Config file locations:
- Windows: `%AppData%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

### First Run Authorization

1. The server opens your browser to `http://localhost:3000/auth`
2. Sign in to Google and grant the requested Google Health permissions
3. The server verifies your Google Health link (`/v4/users/me/identity`) and saves the token
4. Your AI can now access your data. Access tokens refresh automatically.

## Available Tools

Time parameters follow the API: ranges are **start inclusive, end exclusive**. Samples (`get_weight`, `get_heart_rate`)
use RFC 3339 timestamps (e.g. `2026-03-04T00:00:00Z`); sessions use civil time (`YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SS`).
List tools accept `pageSize` and `pageToken` (use `nextPageToken` from the response).

| Tool | Google Health API | Parameters |
|------|-------------------|------------|
| `get_weight` | `weight` data points | `startTime`, optional `endTime` (RFC 3339) |
| `get_sleep_by_date_range` | `sleep` data points (max 25/page) | `startTime`, optional `endTime` (civil) |
| `get_exercises` | `exercise` data points (max 25/page) | `startTime`, optional `endTime` (civil) |
| `get_daily_activity_summary` | daily roll-ups of steps, distance, total calories, active zone minutes, floors | `date` |
| `get_activity_timeseries` | `dailyRollUp` (max 90 days; 14 for calories/active minutes) | `dataType`, `startDate`, `endDate` |
| `get_azm_timeseries` | `dailyRollUp` of `active-zone-minutes` | `startDate`, `endDate` |
| `get_heart_rate` | `heart-rate` samples | `startTime`, optional `endTime` (RFC 3339) |
| `get_heart_rate_by_date_range` | `dailyRollUp` of `heart-rate` (max 14 days) | `startDate`, `endDate` |
| `get_hrv` / `get_hrv_by_date_range` | `daily-heart-rate-variability` | `date` / `startDate`, `endDate` |
| `get_food_log` | `nutrition-log` data points | `startTime`, optional `endTime` (civil) |
| `get_nutrition` / `get_nutrition_by_date_range` | `dailyRollUp` of `nutrition-log` / `hydration-log` | `dataType`, `date` / `startDate`, `endDate` |
| `get_profile` | `users/me/profile` | none |
| `get_identity` | `users/me/identity` | none |
| `get_settings` | `users/me/settings` | none |
| `list_paired_devices` | `users/me/pairedDevices` | none |
| `reauthenticate` | not an API call: deletes the local tokens (memory + `.google-health-token.json`) and opens a new Google sign-in; new tokens are saved on approval, no restart needed. Cancels a pending sign-in. Confirm with `get_identity` | none |
| `list_data_points` | any of the 38 data types | `dataType`, optional raw `filter` |
| `reconcile_data_points` | `dataPoints:reconcile` for any data type | `dataType`, optional `filter`, `dataSourceFamily` |

**Activity data types:** `steps`, `distance`, `total-calories`, `active-energy-burned`, `floors`, `active-minutes`

See the [data types reference](https://developers.google.com/health/data-types) for everything `list_data_points` can query.

## Fitbit-compatible output mode

Set `GOOGLE_HEALTH_OUTPUT_MODE=fitbit` (in the Claude Desktop `env` block or `.env`) to make the overlapping tools behave
like the old Fitbit Web API server, so prompts and projects written against it keep working. The default (`google`) mode
is unchanged. In `fitbit` mode these tools are replaced by Fitbit-shaped versions (same names, `period` parameters and
**inclusive** end dates); everything else (`get_profile`, `get_exercises`, `get_identity`, `get_settings`,
`list_paired_devices`, `list_data_points`, `reconcile_data_points`) stays a Google proxy.

| Tool | Fitbit-style response | Notes |
|------|----------------------|-------|
| `get_weight` (`period`, `date?`) | `{ weight: [{ date, time, logId, weight }] }` | Pounds (follows the account unit). Duplicate weigh-ins from several sources are collapsed to one. No `bmi`/`fat`. |
| `get_sleep_by_date_range` | `{ sleep: [{ dateOfSleep, minutesAsleep, timeInBed, levels.summary.{deep,light,rem,wake} }] }` | Max 100 days. No sleep score or efficiency (the Fitbit API had neither). |
| `get_daily_activity_summary` | `{ activities: [], goals: {}, summary: { caloriesOut, steps, distances, floors, *ActiveMinutes, restingHeartRate, heartRateZones } }` | Miles. Exercise sessions and goals are not included. |
| `get_heart_rate` (`period`) / `get_heart_rate_by_date_range` | `{ 'activities-heart': [{ dateTime, value: { restingHeartRate, heartRateZones } }] }` | Zones: Out of Range / Fat Burn / Cardio / Peak with `min`, `max`, `minutes`, `caloriesOut`. |
| `get_hrv` / `get_hrv_by_date_range` | `{ hrv: [{ dateTime, value: { dailyRmssd, deepRmssd } }] }` | Milliseconds; max 30 days. |
| `get_activity_timeseries` | `{ 'activities-<resource>': [{ dateTime, value: '<string>' }] }` | `steps`, `distance`, `calories`, `activityCalories` (+ `tracker/` variants). `caloriesBMR` is not available. |
| `get_azm_timeseries` | `{ 'activities-active-zone-minutes': [...] }` | Total + fat burn / cardio / peak. |
| `get_food_log` / `get_nutrition` / `get_nutrition_by_date_range` | Fitbit food-log summary / `foods-log-caloriesIn`, `foods-log-water` | No individual food entries or goals. |

How the numbers are mapped (verified against a real day of Fitbit-era data):

- **Heart-rate zones:** Fitbit's Out of Range / Fat Burn / Cardio / Peak are Google's Light / Moderate / Vigorous / Peak.
  Fat Burn minutes equal Active Zone Minutes fat burn (1x); Cardio and Peak minutes are Active Zone Minutes divided by 2
  (they count double). Out of Range comes from time-in-zone. Calories per zone come from `calories-in-heart-rate-zone`
  and the bpm bounds from the account's own `daily-heart-rate-zones`.
- **Sleep:** stage minutes come straight from Google's stage summary, which matched Fitbit's deep/REM numbers exactly.
  The wake date (`dateOfSleep`) is derived from the sleep end time and its UTC offset.
- **Units and time zone:** weight, distance and water follow the account's Google Health unit settings; days are
  interpreted in the account time zone (override with `COMPAT_TIME_ZONE`).
- **Known small differences:** Google re-derives some values, so a historical day can differ slightly from what Fitbit
  returned at the time (e.g. a few steps or 1 bpm of resting heart rate). Fields that could not be provided are listed in a
  top-level `_compat.notes` array when relevant.

## Development

```bash
npm run build         # Compile TypeScript
npm test              # Run tests
npm run lint          # Check code quality
npm run format        # Fix formatting
npm run dev           # Run with MCP inspector
```

**Architecture:** See [CLAUDE.md](CLAUDE.md) and [MIGRATION_PLAN.md](MIGRATION_PLAN.md).
