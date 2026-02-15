// Fitbit data sync — 8 data types to Neon raw tables

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
      start_time: s.startTime,
      end_time: s.endTime,
      duration_ms: s.duration,
      efficiency: s.efficiency,
      is_main_sleep: s.isMainSleep,
      minutes_asleep: s.minutesAsleep,
      minutes_awake: s.minutesAwake,
      time_in_bed: s.timeInBed,
      sleep_type: s.type,
      levels: s.levels,
    },
  }));

  upsertRaw('raw_fitbit__sleep', records, 'v1.2');
  log(`Fitbit sleep: ${records.length} records`);
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

  upsertRaw('raw_fitbit__activity', records, 'v1');
  log(`Fitbit activity: ${records.length} records`);
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

  upsertRaw('raw_fitbit__heart_rate', records, 'v1');
  log(`Fitbit heart rate: ${records.length} records`);
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

  upsertRaw('raw_fitbit__hrv', records, 'v1');
  log(`Fitbit HRV: ${records.length} records`);
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

  upsertRaw('raw_fitbit__spo2', records, 'v1');
  log(`Fitbit SpO2: ${records.length} records`);
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

  upsertRaw('raw_fitbit__breathing_rate', records, 'v1');
  log(`Fitbit breathing rate: ${records.length} records`);
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

  upsertRaw('raw_fitbit__cardio_score', records, 'v1');
  log(`Fitbit cardio score: ${records.length} records`);
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

  upsertRaw('raw_fitbit__temperature_skin', records, 'v1');
  log(`Fitbit temperature skin: ${records.length} records`);
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
