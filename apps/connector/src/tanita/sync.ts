// Tanita Health Planet data sync — body composition + blood pressure
// to data_warehouse_v2 raw tables (append-only).

// ---------------------------------------------------------------------------
// Body Composition (weight, body fat %)
// ---------------------------------------------------------------------------

function syncTanitaBodyComposition(days: number = 30): void {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  log(`Syncing Tanita body composition (${days} days)...`);
  const measurements = tanitaFetchWithChunks(start, tomorrow, fetchTanitaBodyComposition);

  if (measurements.length === 0) { log('No body composition data'); return; }

  const records: RawRecord[] = measurements.map(m => ({
    sourceId: tanitaParseResponseDate(m.date),
    data: {
      date: m.date,
      keydata: m.keydata,
      model: m.model,
      tag: m.tag,
      weight: m.weight,
      body_fat_percent: m.bodyFatPercent,
      _measured_at_jst: tanitaToJstString(m.date),
    },
  }));

  appendRaw('raw_tanita_health_planet__body_composition', records, 'v1');
}

// ---------------------------------------------------------------------------
// Blood Pressure (systolic, diastolic, pulse)
// ---------------------------------------------------------------------------

function syncTanitaBloodPressure(days: number = 30): void {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  log(`Syncing Tanita blood pressure (${days} days)...`);
  const measurements = tanitaFetchWithChunks(start, tomorrow, fetchTanitaBloodPressure);

  if (measurements.length === 0) { log('No blood pressure data'); return; }

  const records: RawRecord[] = measurements.map(m => ({
    sourceId: tanitaParseResponseDate(m.date),
    data: {
      date: m.date,
      keydata: m.keydata,
      model: m.model,
      tag: m.tag,
      systolic: m.systolic,
      diastolic: m.diastolic,
      pulse: m.pulse,
      _measured_at_jst: tanitaToJstString(m.date),
    },
  }));

  appendRaw('raw_tanita_health_planet__blood_pressure', records, 'v1');
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

function syncTanitaAll(days: number = 30): void {
  syncTanitaBodyComposition(days);
  syncTanitaBloodPressure(days);
}
