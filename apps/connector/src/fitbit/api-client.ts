// Fitbit API Client for GAS

const FITBIT_API_BASE = 'https://api.fitbit.com';

function fitbitGet(endpoint: string): unknown {
  const token = getFitbitAccessToken();

  const response = httpFetch(`${FITBIT_API_BASE}${endpoint}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  const code = response.getResponseCode();

  // 401: token expired mid-execution, refresh and retry
  if (code === 401) {
    log('Fitbit token expired, refreshing...');
    refreshFitbitToken();
    const newToken = cachedFitbitCredentials!.accessToken;
    const retryResponse = httpFetch(`${FITBIT_API_BASE}${endpoint}`, {
      headers: { 'Authorization': `Bearer ${newToken}` },
    });
    return JSON.parse(retryResponse.getContentText());
  }

  return JSON.parse(response.getContentText());
}

/** Fitbit GET that returns empty array on 404 (optional endpoints) */
function fitbitGetOptional(endpoint: string): unknown {
  try {
    return fitbitGet(endpoint);
  } catch (e) {
    if (String(e).includes('404')) {
      return null;
    }
    throw e;
  }
}

function fitbitFormatDate(date: Date): string {
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}

/** Generic chunked fetcher for date-range APIs */
function fitbitFetchWithChunks<T>(
  startDate: Date,
  endDate: Date,
  chunkDays: number,
  fetchFn: (start: string, end: string) => T[]
): T[] {
  const results: T[] = [];
  let currentStart = new Date(startDate.getTime());

  while (currentStart < endDate) {
    const chunkEndMs = currentStart.getTime() + chunkDays * 24 * 60 * 60 * 1000 - 1;
    const chunkEnd = new Date(Math.min(chunkEndMs, endDate.getTime()));

    const start = fitbitFormatDate(currentStart);
    const end = fitbitFormatDate(chunkEnd);
    const data = fetchFn(start, end);
    results.push(...data);

    currentStart = new Date(chunkEnd.getTime() + 24 * 60 * 60 * 1000);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Sleep API (v1.2) — 100 day chunks
// ---------------------------------------------------------------------------

interface FitbitSleepLog {
  logId: number;
  dateOfSleep: string;
  startTime: string;
  endTime: string;
  duration: number;
  efficiency: number;
  isMainSleep: boolean;
  minutesAsleep: number;
  minutesAwake: number;
  timeInBed: number;
  type: string;
  levels?: unknown;
}

function fetchFitbitSleep(start: string, end: string): FitbitSleepLog[] {
  const data = fitbitGet(`/1.2/user/-/sleep/date/${start}/${end}.json`) as { sleep?: FitbitSleepLog[] };
  return data.sleep || [];
}

// ---------------------------------------------------------------------------
// Activity API (v1) — 1 day at a time
// ---------------------------------------------------------------------------

interface FitbitActivitySummary {
  date: string;
  steps: number;
  distances: { activity: string; distance: number }[];
  floors?: number;
  caloriesOut: number;
  caloriesBMR: number;
  activityCalories: number;
  sedentaryMinutes: number;
  lightlyActiveMinutes: number;
  fairlyActiveMinutes: number;
  veryActiveMinutes: number;
  activeZoneMinutes?: { fatBurn?: number; cardio?: number; peak?: number };
}

function fetchFitbitActivity(dateStr: string): FitbitActivitySummary | null {
  const data = fitbitGet(`/1/user/-/activities/date/${dateStr}.json`) as { summary?: Record<string, unknown> };
  if (!data.summary) return null;
  return { ...data.summary, date: dateStr } as unknown as FitbitActivitySummary;
}

function fetchFitbitActivityRange(startDate: Date, endDate: Date): FitbitActivitySummary[] {
  const results: FitbitActivitySummary[] = [];
  let current = new Date(startDate.getTime());

  while (current <= endDate) {
    const dateStr = fitbitFormatDate(current);
    const activity = fetchFitbitActivity(dateStr);
    if (activity) results.push(activity);
    current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Heart Rate API (v1) — 30 day chunks
// ---------------------------------------------------------------------------

interface FitbitHeartRateDay {
  dateTime: string;
  value: {
    restingHeartRate?: number;
    heartRateZones: { name: string; min: number; max: number; minutes: number; caloriesOut: number }[];
  };
}

function fetchFitbitHeartRate(start: string, end: string): FitbitHeartRateDay[] {
  const data = fitbitGet(`/1/user/-/activities/heart/date/${start}/${end}.json`) as Record<string, unknown>;
  return (data['activities-heart'] as FitbitHeartRateDay[]) || [];
}

// ---------------------------------------------------------------------------
// HRV API (v1) — 30 day chunks
// ---------------------------------------------------------------------------

interface FitbitHrvDay {
  dateTime: string;
  value: { dailyRmssd: number; deepRmssd: number };
}

function fetchFitbitHrv(start: string, end: string): FitbitHrvDay[] {
  const data = fitbitGet(`/1/user/-/hrv/date/${start}/${end}.json`) as { hrv?: FitbitHrvDay[] };
  return data.hrv || [];
}

// ---------------------------------------------------------------------------
// SpO2 API (v1) — 30 day chunks, 404 on no data
// ---------------------------------------------------------------------------

interface FitbitSpo2Day {
  dateTime: string;
  value: { avg: number; min: number; max: number };
}

function fetchFitbitSpo2(start: string, end: string): FitbitSpo2Day[] {
  const data = fitbitGetOptional(`/1/user/-/spo2/date/${start}/${end}.json`) as { value?: FitbitSpo2Day[] } | null;
  return data?.value || [];
}

// ---------------------------------------------------------------------------
// Breathing Rate API (v1) — 30 day chunks, 404 on no data
// ---------------------------------------------------------------------------

interface FitbitBreathingRateDay {
  dateTime: string;
  value: { breathingRate: number };
}

function fetchFitbitBreathingRate(start: string, end: string): FitbitBreathingRateDay[] {
  const data = fitbitGetOptional(`/1/user/-/br/date/${start}/${end}.json`) as { br?: FitbitBreathingRateDay[] } | null;
  return data?.br || [];
}

// ---------------------------------------------------------------------------
// Cardio Score / VO2 Max API (v1) — 30 day chunks, 404 on no data
// ---------------------------------------------------------------------------

interface FitbitCardioScoreDay {
  dateTime: string;
  value: { vo2Max: string };
}

function fetchFitbitCardioScore(start: string, end: string): FitbitCardioScoreDay[] {
  const data = fitbitGetOptional(`/1/user/-/cardioscore/date/${start}/${end}.json`) as { cardioScore?: FitbitCardioScoreDay[] } | null;
  return data?.cardioScore || [];
}

// ---------------------------------------------------------------------------
// Temperature Skin API (v1) — 30 day chunks, 404 on no data
// ---------------------------------------------------------------------------

interface FitbitTemperatureSkinDay {
  dateTime: string;
  value: { nightlyRelative: number };
  logType: string;
}

function fetchFitbitTemperatureSkin(start: string, end: string): FitbitTemperatureSkinDay[] {
  const data = fitbitGetOptional(`/1/user/-/temp/skin/date/${start}/${end}.json`) as { tempSkin?: FitbitTemperatureSkinDay[] } | null;
  return data?.tempSkin || [];
}
