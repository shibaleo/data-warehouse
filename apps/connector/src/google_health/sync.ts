// Google Health data sync — 11 entities → data_warehouse_v2.raw_google_health__*
// (append-only). Replaces the retired Fitbit Web API connector.
//
// Storage model:
//   - The full Google Health dataPoint is stored verbatim as `data`. The
//     response is already structured/typed, so faithful storage is the
//     most useful shape downstream.
//   - source_id strategy varies by entity — see per-entity functions. Three
//     classes exist:
//       (a) Entities with stable `name`: sleep, exercise → last URL segment
//       (b) Sub-minute interval points (steps/active_minutes/distance): use
//           `<type>.interval.startTime` (UTC Z ISO) as source_id
//       (c) Daily summaries: civil date "YYYY-MM-DD" as source_id
//       (d) respiratory_rate_sleep_summary: `sampleTime.physicalTime` per
//           docs/002 (entity hadn't fired during probe — treat as provisional)
//
// Timezone: Google Health returns `physicalTime` / `startTime` etc. in UTC
// with `Z` suffix and a separate `utcOffset` field. The "Z" suffix already
// satisfies the CLAUDE.md offset-required rule, so no withOffset() rewrite
// is needed here.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function googleHealthWindow(days: number): { startIso: string; endIso: string } {
  const now = Date.now();
  // End at tomorrow 00:00 UTC so today's partial bucket is included.
  const endIso = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  const startIso = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
  return { startIso, endIso };
}

/** Extract the last path segment of a Google API resource name. */
function nameLastSegment(name: unknown): string | null {
  if (typeof name !== 'string' || name.length === 0) return null;
  const idx = name.lastIndexOf('/');
  return idx >= 0 ? name.substring(idx + 1) : name;
}

/** Convert a Google Health `date: {year,month,day}` to "YYYY-MM-DD". */
function googleHealthDateToIso(date: unknown): string | null {
  if (!date || typeof date !== 'object') return null;
  const d = date as { year?: number; month?: number; day?: number };
  if (!d.year || !d.month || !d.day) return null;
  const mm = String(d.month).padStart(2, '0');
  const dd = String(d.day).padStart(2, '0');
  return `${d.year}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Sleep — source_id from `name` last segment
// ---------------------------------------------------------------------------

function syncGoogleHealthSleep(days: number = 7): void {
  const { startIso, endIso } = googleHealthWindow(days);
  log(`Syncing Google Health sleep (${days} days)...`);
  const points = fetchGoogleHealthSleep(startIso, endIso);

  if (points.length === 0) { log('No sleep data'); return; }

  const records: RawRecord[] = [];
  for (const p of points) {
    const id = nameLastSegment(p['name']);
    if (!id) { log(`sleep: dataPoint without name, skipping`); continue; }
    records.push({ sourceId: id, data: p });
  }

  appendRaw('raw_google_health__sleep', records, 'v4');
}

// ---------------------------------------------------------------------------
// Exercise — source_id from `name` last segment
// ---------------------------------------------------------------------------

function syncGoogleHealthExercise(days: number = 7): void {
  const { startIso, endIso } = googleHealthWindow(days);
  log(`Syncing Google Health exercise (${days} days)...`);
  const points = fetchGoogleHealthExercise(startIso, endIso);

  if (points.length === 0) { log('No exercise data'); return; }

  const records: RawRecord[] = [];
  for (const p of points) {
    const id = nameLastSegment(p['name']);
    if (!id) { log(`exercise: dataPoint without name, skipping`); continue; }
    records.push({ sourceId: id, data: p });
  }

  appendRaw('raw_google_health__exercise', records, 'v4');
}

// ---------------------------------------------------------------------------
// Interval-shaped sub-minute points: steps / active_minutes / distance
//
// source_id = `${startTime}__${recordingMethod}__${device}`.
// Different devices/methods can report the same instant independently (e.g.
// MobileTrack + Inspire 3 both reporting steps at 2026-05-31T11:28:00Z), so
// startTime alone is not unique.
// ---------------------------------------------------------------------------

function googleHealthIntervalSourceId(
  p: Record<string, unknown>,
  startTime: string,
): string {
  const ds = p['dataSource'] as { recordingMethod?: string; device?: { displayName?: string } } | undefined;
  const method = ds?.recordingMethod ?? 'UNKNOWN_METHOD';
  const device = ds?.device?.displayName ?? 'UNKNOWN_DEVICE';
  return `${startTime}__${method}__${device}`;
}

function syncIntervalDataType(
  tableShortName: string,
  fullTableName: string,
  payloadKey: string,
  fetcher: (s: string, e: string) => Record<string, unknown>[],
  days: number,
): void {
  const { startIso, endIso } = googleHealthWindow(days);
  log(`Syncing Google Health ${tableShortName} (${days} days)...`);
  const points = fetcher(startIso, endIso);

  if (points.length === 0) { log(`No ${tableShortName} data`); return; }

  const records: RawRecord[] = [];
  for (const p of points) {
    const payload = p[payloadKey] as { interval?: { startTime?: string } } | undefined;
    const startTime = payload?.interval?.startTime;
    if (!startTime) { log(`${tableShortName}: dataPoint without interval.startTime, skipping`); continue; }
    records.push({ sourceId: googleHealthIntervalSourceId(p, startTime), data: p });
  }

  appendRaw(fullTableName, records, 'v4');
}

function syncGoogleHealthSteps(days: number = 7): void {
  syncIntervalDataType('steps', 'raw_google_health__steps', 'steps', fetchGoogleHealthSteps, days);
}

function syncGoogleHealthActiveMinutes(days: number = 7): void {
  syncIntervalDataType('active_minutes', 'raw_google_health__active_minutes', 'activeMinutes', fetchGoogleHealthActiveMinutes, days);
}

function syncGoogleHealthDistance(days: number = 7): void {
  syncIntervalDataType('distance', 'raw_google_health__distance', 'distance', fetchGoogleHealthDistance, days);
}

// ---------------------------------------------------------------------------
// Daily summaries — source_id = "YYYY-MM-DD" from <typeCamel>.date
// ---------------------------------------------------------------------------

function syncDailyDataType(
  tableShortName: string,
  fullTableName: string,
  payloadKey: string,
  fetcher: (s: string, e: string) => Record<string, unknown>[],
  days: number,
): void {
  const { startIso, endIso } = googleHealthWindow(days);
  log(`Syncing Google Health ${tableShortName} (${days} days)...`);
  const points = fetcher(startIso, endIso);

  if (points.length === 0) { log(`No ${tableShortName} data`); return; }

  const records: RawRecord[] = [];
  for (const p of points) {
    const payload = p[payloadKey] as { date?: unknown } | undefined;
    const id = googleHealthDateToIso(payload?.date);
    if (!id) { log(`${tableShortName}: dataPoint without date, skipping`); continue; }
    records.push({ sourceId: id, data: p });
  }

  appendRaw(fullTableName, records, 'v4');
}

function syncGoogleHealthDailyRestingHeartRate(days: number = 7): void {
  syncDailyDataType('daily_resting_heart_rate', 'raw_google_health__daily_resting_heart_rate',
    'dailyRestingHeartRate', fetchGoogleHealthDailyRestingHeartRate, days);
}

function syncGoogleHealthDailyHeartRateVariability(days: number = 7): void {
  syncDailyDataType('daily_heart_rate_variability', 'raw_google_health__daily_heart_rate_variability',
    'dailyHeartRateVariability', fetchGoogleHealthDailyHeartRateVariability, days);
}

function syncGoogleHealthDailyOxygenSaturation(days: number = 7): void {
  syncDailyDataType('daily_oxygen_saturation', 'raw_google_health__daily_oxygen_saturation',
    'dailyOxygenSaturation', fetchGoogleHealthDailyOxygenSaturation, days);
}

function syncGoogleHealthDailyVo2Max(days: number = 7): void {
  syncDailyDataType('daily_vo2_max', 'raw_google_health__daily_vo2_max',
    'dailyVo2Max', fetchGoogleHealthDailyVo2Max, days);
}

function syncGoogleHealthDailySleepTemperatureDerivations(days: number = 7): void {
  syncDailyDataType('daily_sleep_temperature_derivations', 'raw_google_health__daily_sleep_temperature_derivations',
    'dailySleepTemperatureDerivations', fetchGoogleHealthDailySleepTemperatureDerivations, days);
}

// ---------------------------------------------------------------------------
// Respiratory rate sleep summary — source_id = sampleTime.physicalTime
// Provisional: no real datapoints seen during probe. If the synthetic ID
// collides we'll switch to sha256(physicalTime + breaths_per_minute).
// ---------------------------------------------------------------------------

function syncGoogleHealthRespiratoryRateSleepSummary(days: number = 7): void {
  const { startIso, endIso } = googleHealthWindow(days);
  log(`Syncing Google Health respiratory_rate_sleep_summary (${days} days)...`);
  const points = fetchGoogleHealthRespiratoryRateSleepSummary(startIso, endIso);

  if (points.length === 0) { log('No respiratory_rate_sleep_summary data'); return; }

  const records: RawRecord[] = [];
  for (const p of points) {
    const payload = p['respiratoryRateSleepSummary'] as { sampleTime?: { physicalTime?: string } } | undefined;
    const physicalTime = payload?.sampleTime?.physicalTime;
    if (!physicalTime) { log(`respiratory_rate_sleep_summary: dataPoint without sampleTime.physicalTime, skipping`); continue; }
    records.push({ sourceId: physicalTime, data: p });
  }

  appendRaw('raw_google_health__respiratory_rate_sleep_summary', records, 'v4');
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

function syncGoogleHealthAll(days: number = 7): void {
  syncGoogleHealthSleep(days);
  syncGoogleHealthSteps(days);
  syncGoogleHealthActiveMinutes(days);
  syncGoogleHealthDistance(days);
  syncGoogleHealthExercise(days);
  syncGoogleHealthDailyRestingHeartRate(days);
  syncGoogleHealthDailyHeartRateVariability(days);
  syncGoogleHealthDailyOxygenSaturation(days);
  syncGoogleHealthDailyVo2Max(days);
  syncGoogleHealthDailySleepTemperatureDerivations(days);
  syncGoogleHealthRespiratoryRateSleepSummary(days);
}
