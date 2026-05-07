// Fitbit data sync — 8 data types to data_warehouse_v2 raw tables (append-only).
//
// Each Fitbit endpoint has a stable per-day source_id (date or logId) and the
// connector projects only the fields we care about, so content_hash is just
// md5(data::text) (the 'at' field stripping is a no-op here, kept for code
// symmetry with Toggl). No diff window is needed: Fitbit doesn't delete past
// days, so a same-source_id record either appears unchanged (no-op) or with
// updated values (new revision). Fullness changes (e.g. catching up partial
// data) naturally produce a revision via the content_hash.
//
// Timezone handling: Fitbit returns naive datetime strings ("2026-05-05T23:32")
// reflecting the user's account timezone setting. Storing them naive lets
// PostgreSQL ::timestamptz cast misinterpret them as UTC, so the connector
// completes the ISO 8601 by appending +09:00 (Asia/Tokyo, no DST) before
// storage. See CLAUDE.md "時間データの必須ルール" for the rationale.

const FITBIT_TZ_OFFSET = '+09:00';

/** Complete a naive ISO 8601 datetime by appending the account timezone offset. */
function withOffset(naive: string | null | undefined): string | null {
  if (naive == null || naive === '') return null;
  if (/(?:Z|[+\-]\d{2}:\d{2})$/.test(naive)) return naive;  // already has offset
  return naive + FITBIT_TZ_OFFSET;
}

/** Walk Fitbit sleep `levels` and apply withOffset to every nested dateTime. */
function fixSleepLevels(levels: unknown): unknown {
  if (!levels || typeof levels !== 'object') return levels;
  const obj = levels as Record<string, unknown>;
  const fixed: Record<string, unknown> = { ...obj };
  for (const key of ['data', 'shortData']) {
    const arr = obj[key];
    if (Array.isArray(arr)) {
      fixed[key] = arr.map((entry: unknown) => {
        if (!entry || typeof entry !== 'object') return entry;
        const e = entry as Record<string, unknown>;
        return { ...e, dateTime: withOffset(e['dateTime'] as string | undefined) };
      });
    }
  }
  return fixed;
}

// ---------------------------------------------------------------------------
// Sleep
// ---------------------------------------------------------------------------

function syncFitbitSleep(days: number = 7): void {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  log(`Syncing Fitbit sleep (${days} days)...`);
  const sleepLogs = fitbitFetchWithChunks(start, tomorrow, 100, fetchFitbitSleep);

  if (sleepLogs.length === 0) { log('No sleep data'); return; }

  const records: RawRecord[] = sleepLogs.map(s => ({
    sourceId: String(s.logId),
    data: {
      log_id: String(s.logId),
      date: s.dateOfSleep,
      start_time: withOffset(s.startTime),
      end_time: withOffset(s.endTime),
      duration_ms: s.duration,
      efficiency: s.efficiency,
      is_main_sleep: s.isMainSleep,
      minutes_asleep: s.minutesAsleep,
      minutes_awake: s.minutesAwake,
      time_in_bed: s.timeInBed,
      sleep_type: s.type,
      levels: fixSleepLevels(s.levels),
    },
  }));

  appendRaw('raw_fitbit__sleep', records, 'v1.2');
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

function syncFitbitActivity(days: number = 7): void {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  log(`Syncing Fitbit activity (${days} days)...`);
  const activities = fetchFitbitActivityRange(start, tomorrow);

  if (activities.length === 0) { log('No activity data'); return; }

  const records: RawRecord[] = activities.map(a => {
    const totalDistance = a.distances?.find(d => d.activity === 'total')?.distance || 0;
    return {
      sourceId: a.date,
      data: {
        date: a.date,
        steps: a.steps,
        distance_km: totalDistance,
        floors: a.floors,
        calories_total: a.caloriesOut,
        calories_bmr: a.caloriesBMR,
        calories_activity: a.activityCalories,
        sedentary_minutes: a.sedentaryMinutes,
        lightly_active_minutes: a.lightlyActiveMinutes,
        fairly_active_minutes: a.fairlyActiveMinutes,
        very_active_minutes: a.veryActiveMinutes,
        active_zone_minutes: a.activeZoneMinutes,
      },
    };
  });

  appendRaw('raw_fitbit__activity', records, 'v1');
}

// ---------------------------------------------------------------------------
// Heart Rate
// ---------------------------------------------------------------------------

function syncFitbitHeartRate(days: number = 7): void {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  log(`Syncing Fitbit heart rate (${days} days)...`);
  const heartRates = fitbitFetchWithChunks(start, tomorrow, 30, fetchFitbitHeartRate);

  if (heartRates.length === 0) { log('No heart rate data'); return; }

  const records: RawRecord[] = heartRates.map(hr => ({
    sourceId: hr.dateTime,
    data: {
      date: hr.dateTime,
      resting_heart_rate: hr.value.restingHeartRate,
      heart_rate_zones: hr.value.heartRateZones,
    },
  }));

  appendRaw('raw_fitbit__heart_rate', records, 'v1');
}

// ---------------------------------------------------------------------------
// HRV
// ---------------------------------------------------------------------------

function syncFitbitHrv(days: number = 7): void {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  log(`Syncing Fitbit HRV (${days} days)...`);
  const hrvData = fitbitFetchWithChunks(start, tomorrow, 30, fetchFitbitHrv);

  if (hrvData.length === 0) { log('No HRV data'); return; }

  const records: RawRecord[] = hrvData.map(h => ({
    sourceId: h.dateTime,
    data: {
      date: h.dateTime,
      daily_rmssd: h.value.dailyRmssd,
      deep_rmssd: h.value.deepRmssd,
    },
  }));

  appendRaw('raw_fitbit__hrv', records, 'v1');
}

// ---------------------------------------------------------------------------
// SpO2
// ---------------------------------------------------------------------------

function syncFitbitSpo2(days: number = 7): void {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  log(`Syncing Fitbit SpO2 (${days} days)...`);
  const spo2Data = fitbitFetchWithChunks(start, tomorrow, 30, fetchFitbitSpo2);

  if (spo2Data.length === 0) { log('No SpO2 data'); return; }

  const records: RawRecord[] = spo2Data.map(s => ({
    sourceId: s.dateTime,
    data: {
      date: s.dateTime,
      avg_spo2: s.value.avg,
      min_spo2: s.value.min,
      max_spo2: s.value.max,
    },
  }));

  appendRaw('raw_fitbit__spo2', records, 'v1');
}

// ---------------------------------------------------------------------------
// Breathing Rate
// ---------------------------------------------------------------------------

function syncFitbitBreathingRate(days: number = 7): void {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  log(`Syncing Fitbit breathing rate (${days} days)...`);
  const brData = fitbitFetchWithChunks(start, tomorrow, 30, fetchFitbitBreathingRate);

  if (brData.length === 0) { log('No breathing rate data'); return; }

  const records: RawRecord[] = brData.map(b => ({
    sourceId: b.dateTime,
    data: {
      date: b.dateTime,
      breathing_rate: b.value.breathingRate,
    },
  }));

  appendRaw('raw_fitbit__breathing_rate', records, 'v1');
}

// ---------------------------------------------------------------------------
// Cardio Score (VO2 Max)
// ---------------------------------------------------------------------------

function syncFitbitCardioScore(days: number = 7): void {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  log(`Syncing Fitbit cardio score (${days} days)...`);
  const csData = fitbitFetchWithChunks(start, tomorrow, 30, fetchFitbitCardioScore);

  if (csData.length === 0) { log('No cardio score data'); return; }

  const records: RawRecord[] = csData.map(cs => {
    const vo2MaxStr = cs.value.vo2Max;
    let vo2Max: number | null = null;
    let vo2MaxRangeLow: number | null = null;
    let vo2MaxRangeHigh: number | null = null;

    if (vo2MaxStr) {
      const parts = vo2MaxStr.split('-');
      if (parts.length === 2) {
        vo2MaxRangeLow = parseFloat(parts[0]);
        vo2MaxRangeHigh = parseFloat(parts[1]);
        vo2Max = (vo2MaxRangeLow + vo2MaxRangeHigh) / 2;
      } else {
        vo2Max = parseFloat(vo2MaxStr);
      }
    }

    return {
      sourceId: cs.dateTime,
      data: {
        date: cs.dateTime,
        vo2_max: vo2Max,
        vo2_max_range_low: vo2MaxRangeLow,
        vo2_max_range_high: vo2MaxRangeHigh,
      },
    };
  });

  appendRaw('raw_fitbit__cardio_score', records, 'v1');
}

// ---------------------------------------------------------------------------
// Temperature Skin
// ---------------------------------------------------------------------------

function syncFitbitTemperatureSkin(days: number = 7): void {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  log(`Syncing Fitbit temperature skin (${days} days)...`);
  const tsData = fitbitFetchWithChunks(start, tomorrow, 30, fetchFitbitTemperatureSkin);

  if (tsData.length === 0) { log('No temperature skin data'); return; }

  const records: RawRecord[] = tsData.map(t => ({
    sourceId: t.dateTime,
    data: {
      date: t.dateTime,
      nightly_relative: t.value.nightlyRelative,
      log_type: t.logType,
    },
  }));

  appendRaw('raw_fitbit__temperature_skin', records, 'v1');
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

function syncFitbitAll(days: number = 7): void {
  syncFitbitSleep(days);
  syncFitbitActivity(days);
  syncFitbitHeartRate(days);
  syncFitbitHrv(days);
  syncFitbitSpo2(days);
  syncFitbitBreathingRate(days);
  syncFitbitCardioScore(days);
  syncFitbitTemperatureSkin(days);
}
