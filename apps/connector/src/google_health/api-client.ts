// Google Health API v4 client.
//
// Endpoint shape (confirmed via scripts/probe-google-health.mjs):
//   GET https://health.googleapis.com/v4/users/me/dataTypes/{kebab-type}/dataPoints
//     ?pageSize=50&filter=<snake_type>.<field> >= "..." AND ... < "..."&pageToken=...
//
// All dataType responses share { dataPoints: [...], nextPageToken?: string }.
// The 11 entities differ only in the filter field they accept. We DRY this by
// taking the filter field name per call.

const GOOGLE_HEALTH_API_BASE = 'https://health.googleapis.com/v4';
const GOOGLE_HEALTH_PAGE_SIZE = 50;

interface GoogleHealthDataPointsResponse {
  dataPoints?: Record<string, unknown>[];
  nextPageToken?: string;
}

function googleHealthGet(url: string): GoogleHealthDataPointsResponse {
  const token = getGoogleHealthAccessToken();

  const response = httpFetch(url, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  const code = response.getResponseCode();

  if (code === 401) {
    log('Google Health token expired mid-call, refreshing...');
    refreshGoogleHealthToken();
    const retryToken = cachedGoogleHealthCredentials!.accessToken;
    const retryResponse = httpFetch(url, {
      headers: { 'Authorization': `Bearer ${retryToken}` },
    });
    return JSON.parse(retryResponse.getContentText()) as GoogleHealthDataPointsResponse;
  }

  if (code >= 400) {
    throw new Error(`Google Health HTTP ${code}: ${response.getContentText().substring(0, 500)}`);
  }

  return JSON.parse(response.getContentText()) as GoogleHealthDataPointsResponse;
}

/**
 * List all dataPoints for a dataType within a filter window, auto-following
 * nextPageToken until exhausted.
 *
 * @param dataType  kebab-case (e.g. "daily-resting-heart-rate")
 * @param filter    fully-formed filter string (e.g. `sleep.interval.end_time >= "..." AND ...`)
 */
function listGoogleHealthDataPoints(
  dataType: string,
  filter: string,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  let pageCount = 0;

  do {
    let qs = `pageSize=${GOOGLE_HEALTH_PAGE_SIZE}&filter=${encodeURIComponent(filter)}`;
    if (pageToken) qs += `&pageToken=${encodeURIComponent(pageToken)}`;
    const url = `${GOOGLE_HEALTH_API_BASE}/users/me/dataTypes/${dataType}/dataPoints?${qs}`;

    const resp = googleHealthGet(url);
    if (resp.dataPoints) out.push(...resp.dataPoints);
    pageToken = resp.nextPageToken;
    pageCount++;

    // Soft cap to avoid runaway loops; 1000 pages × 50 = 50k points
    if (pageCount > 1000) {
      log(`listGoogleHealthDataPoints: hit 1000-page cap for ${dataType}`);
      break;
    }
  } while (pageToken);

  return out;
}

// ---------------------------------------------------------------------------
// Filter helpers — confirmed working via probe
// ---------------------------------------------------------------------------

/** RFC3339 UTC instant ("2026-05-18T03:46:10.365Z") filter window */
function instantFilter(field: string, startIso: string, endIso: string): string {
  return `${field} >= "${startIso}" AND ${field} < "${endIso}"`;
}

/** Civil-time filter window (no Z): "YYYY-MM-DDTHH:MM:SS" */
function civilTimeFilter(field: string, startIso: string, endIso: string): string {
  return `${field} >= "${startIso.slice(0, 19)}" AND ${field} < "${endIso.slice(0, 19)}"`;
}

/** Daily-date filter window: "YYYY-MM-DD" */
function dateFilter(field: string, startIso: string, endIso: string): string {
  return `${field} >= "${startIso.slice(0, 10)}" AND ${field} < "${endIso.slice(0, 10)}"`;
}

// ---------------------------------------------------------------------------
// Per-entity fetchers — return raw dataPoints (stored as-is into raw_*)
// ---------------------------------------------------------------------------

function fetchGoogleHealthSleep(startIso: string, endIso: string): Record<string, unknown>[] {
  return listGoogleHealthDataPoints('sleep', instantFilter('sleep.interval.end_time', startIso, endIso));
}

function fetchGoogleHealthSteps(startIso: string, endIso: string): Record<string, unknown>[] {
  return listGoogleHealthDataPoints('steps', instantFilter('steps.interval.start_time', startIso, endIso));
}

function fetchGoogleHealthActiveMinutes(startIso: string, endIso: string): Record<string, unknown>[] {
  return listGoogleHealthDataPoints('active-minutes', instantFilter('active_minutes.interval.start_time', startIso, endIso));
}

function fetchGoogleHealthDistance(startIso: string, endIso: string): Record<string, unknown>[] {
  return listGoogleHealthDataPoints('distance', instantFilter('distance.interval.start_time', startIso, endIso));
}

function fetchGoogleHealthExercise(startIso: string, endIso: string): Record<string, unknown>[] {
  return listGoogleHealthDataPoints('exercise', civilTimeFilter('exercise.interval.civil_start_time', startIso, endIso));
}

function fetchGoogleHealthDailyRestingHeartRate(startIso: string, endIso: string): Record<string, unknown>[] {
  return listGoogleHealthDataPoints('daily-resting-heart-rate', dateFilter('daily_resting_heart_rate.date', startIso, endIso));
}

function fetchGoogleHealthDailyHeartRateVariability(startIso: string, endIso: string): Record<string, unknown>[] {
  return listGoogleHealthDataPoints('daily-heart-rate-variability', dateFilter('daily_heart_rate_variability.date', startIso, endIso));
}

function fetchGoogleHealthDailyOxygenSaturation(startIso: string, endIso: string): Record<string, unknown>[] {
  return listGoogleHealthDataPoints('daily-oxygen-saturation', dateFilter('daily_oxygen_saturation.date', startIso, endIso));
}

function fetchGoogleHealthDailyVo2Max(startIso: string, endIso: string): Record<string, unknown>[] {
  return listGoogleHealthDataPoints('daily-vo2-max', dateFilter('daily_vo2_max.date', startIso, endIso));
}

function fetchGoogleHealthDailySleepTemperatureDerivations(startIso: string, endIso: string): Record<string, unknown>[] {
  return listGoogleHealthDataPoints('daily-sleep-temperature-derivations', dateFilter('daily_sleep_temperature_derivations.date', startIso, endIso));
}

function fetchGoogleHealthRespiratoryRateSleepSummary(startIso: string, endIso: string): Record<string, unknown>[] {
  // Filter field is `sample_time.physical_time` (nested), confirmed via probe
  // 2026-06-15. Earlier civil_sample_time/civil_date guesses were rejected
  // with INVALID_DATA_POINT_FILTER_DATA_TYPE_MEMBER.
  return listGoogleHealthDataPoints(
    'respiratory-rate-sleep-summary',
    instantFilter('respiratory_rate_sleep_summary.sample_time.physical_time', startIso, endIso),
  );
}
