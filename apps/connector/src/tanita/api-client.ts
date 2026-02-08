// Tanita Health Planet API Client for GAS

const HEALTH_PLANET_API_BASE = 'https://www.healthplanet.jp/status';
const MAX_DAYS_PER_REQUEST = 90;

// Measurement tags
const INNERSCAN_TAGS = '6021,6022'; // weight, body fat %
const SPHYGMOMANOMETER_TAGS = '622E,622F,6230'; // systolic, diastolic, pulse

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TanitaBodyComposition {
  date: string;      // 12-digit format: yyyyMMddHHmm
  keydata: string;
  model: string;
  tag: string;
  weight?: string;
  bodyFatPercent?: string;
}

interface TanitaBloodPressure {
  date: string;
  keydata: string;
  model: string;
  tag: string;
  systolic?: string;
  diastolic?: string;
  pulse?: string;
}

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------

/** Format date for Tanita API request (14 digits: yyyyMMddHHmmss in JST) */
function tanitaFormatRequestDate(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return Utilities.formatDate(jst, 'UTC', 'yyyyMMddHHmmss');
}

/** Parse Tanita API response date (12 digits: yyyyMMddHHmm JST) to ISO8601 UTC */
function tanitaParseResponseDate(dateStr: string): string {
  const year = dateStr.slice(0, 4);
  const month = dateStr.slice(4, 6);
  const day = dateStr.slice(6, 8);
  const hour = dateStr.slice(8, 10);
  const minute = dateStr.slice(10, 12);

  const jstDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:00+09:00`);
  return jstDate.toISOString();
}

/** Get JST datetime string from Tanita response date */
function tanitaToJstString(dateStr: string): string {
  const year = dateStr.slice(0, 4);
  const month = dateStr.slice(4, 6);
  const day = dateStr.slice(6, 8);
  const hour = dateStr.slice(8, 10);
  const minute = dateStr.slice(10, 12);

  return `${year}-${month}-${day}T${hour}:${minute}:00+09:00`;
}

// ---------------------------------------------------------------------------
// API call helper
// ---------------------------------------------------------------------------

function tanitaGet(endpoint: string, params: Record<string, string>): unknown {
  const token = getTanitaAccessToken();
  params['access_token'] = token;

  const queryString = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

  const response = httpFetch(`${HEALTH_PLANET_API_BASE}/${endpoint}?${queryString}`, {});

  const code = response.getResponseCode();

  // 401: token expired mid-execution, refresh and retry
  if (code === 401) {
    log('Tanita token expired, refreshing...');
    refreshTanitaToken();
    params['access_token'] = cachedTanitaCredentials!.accessToken;
    const retryQuery = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    const retryResponse = httpFetch(`${HEALTH_PLANET_API_BASE}/${endpoint}?${retryQuery}`, {});
    return JSON.parse(retryResponse.getContentText());
  }

  return JSON.parse(response.getContentText());
}

// ---------------------------------------------------------------------------
// InnerScan (Body Composition): weight + body fat %
// ---------------------------------------------------------------------------

function fetchTanitaBodyComposition(startDate: Date, endDate: Date): TanitaBodyComposition[] {
  const from = tanitaFormatRequestDate(startDate);
  const to = tanitaFormatRequestDate(endDate);

  const data = tanitaGet('innerscan.json', {
    date: '1',
    from,
    to,
    tag: INNERSCAN_TAGS,
  }) as { data?: { date: string; keydata: string; model: string; tag: string }[] };

  if (!data.data || data.data.length === 0) return [];

  // Group measurements by date
  const byDate = new Map<string, TanitaBodyComposition>();
  for (const item of data.data) {
    const existing = byDate.get(item.date) || {
      date: item.date,
      keydata: item.keydata,
      model: item.model,
      tag: item.tag,
    };
    if (item.tag === '6021') existing.weight = item.keydata;
    if (item.tag === '6022') existing.bodyFatPercent = item.keydata;
    byDate.set(item.date, existing);
  }

  return Array.from(byDate.values());
}

// ---------------------------------------------------------------------------
// Sphygmomanometer (Blood Pressure): systolic, diastolic, pulse
// ---------------------------------------------------------------------------

function fetchTanitaBloodPressure(startDate: Date, endDate: Date): TanitaBloodPressure[] {
  const from = tanitaFormatRequestDate(startDate);
  const to = tanitaFormatRequestDate(endDate);

  const data = tanitaGet('sphygmomanometer.json', {
    date: '1',
    from,
    to,
    tag: SPHYGMOMANOMETER_TAGS,
  }) as { data?: { date: string; keydata: string; model: string; tag: string }[] };

  if (!data.data || data.data.length === 0) return [];

  // Group measurements by date
  const byDate = new Map<string, TanitaBloodPressure>();
  for (const item of data.data) {
    const existing = byDate.get(item.date) || {
      date: item.date,
      keydata: item.keydata,
      model: item.model,
      tag: item.tag,
    };
    if (item.tag === '622E') existing.systolic = item.keydata;
    if (item.tag === '622F') existing.diastolic = item.keydata;
    if (item.tag === '6230') existing.pulse = item.keydata;
    byDate.set(item.date, existing);
  }

  return Array.from(byDate.values());
}

// ---------------------------------------------------------------------------
// Chunked fetching (for periods > 90 days)
// ---------------------------------------------------------------------------

function tanitaFetchWithChunks<T>(
  startDate: Date,
  endDate: Date,
  fetchFn: (start: Date, end: Date) => T[]
): T[] {
  const results: T[] = [];
  let currentStart = new Date(startDate.getTime());

  while (currentStart < endDate) {
    const chunkEndMs = currentStart.getTime() + MAX_DAYS_PER_REQUEST * 24 * 60 * 60 * 1000;
    const chunkEnd = new Date(Math.min(chunkEndMs, endDate.getTime()));

    const data = fetchFn(currentStart, chunkEnd);
    results.push(...data);

    currentStart = new Date(chunkEnd.getTime() + 1);
  }

  return results;
}
