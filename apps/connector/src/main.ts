// GAS entry points (trigger functions)

// --- Toggl Track ---

/** Toggl hourly sync: recent time entries only */
function togglHourlySync(): void {
  log('=== Toggl Hourly Sync Start ===');
  syncTimeEntries({ days: 1 });
  log('=== Toggl Hourly Sync Complete ===');
}

/** Toggl weekly historical sync: last 30 days of report data */
function togglWeeklyHistoricalSync(): void {
  log('=== Toggl Weekly Historical Sync Start ===');
  syncTimeEntriesReport({ days: 30 });
  log('=== Toggl Weekly Historical Sync Complete ===');
}

/** Toggl full historical sync: last 365 days of report data */
function togglFullHistoricalSync(): void {
  log('=== Toggl Full Historical Sync Start ===');
  syncTimeEntriesReport({ days: 365 });
  log('=== Toggl Full Historical Sync Complete ===');
}

// --- Daily sync (all services) ---

/** Daily sync: Toggl masters + time entries + Tanita all + Zaim all */
function dailySync(): void {
  log('=== Daily Sync Start ===');
  reportAndResetToggl402Counter();
  try {
    syncMasters();
  } catch (err) {
    if (isTogglQuotaError(err)) {
      log('syncMasters skipped due to Toggl 402');
    } else {
      throw err;
    }
  }
  syncTimeEntries({ days: 3 });
  syncTanitaAll(30);
  syncZaimAll(30);
  log('=== Daily Sync Complete ===');
}

function reportAndResetToggl402Counter(): void {
  const props = PropertiesService.getScriptProperties();
  const cur = parseInt(props.getProperty('toggl_402_count') || '0', 10) || 0;
  if (cur > 0) {
    log(`Toggl 402 count since last dailySync: ${cur}`);
  }
  props.deleteProperty('toggl_402_count');
}

/**
 * Google Health daily sync (Fitbit successor). Fitbit ingestion was retired
 * once raw_google_health__sleep was backfilled to 2020-06 and verified
 * against raw_fitbit__* — see docs/004_bug_fix.md.
 */
function dailySyncGoogleHealth(): void {
  log('=== Daily Sync (Google Health) Start ===');
  syncGoogleHealthAll(7);
  log('=== Daily Sync (Google Health) Complete ===');
}

// --- Zaim ad-hoc ---

/** Zaim full sync: all money records from 2020-01-01 + masters */
function zaimFullSync(): void {
  log('=== Zaim Full Sync Start ===');
  syncZaimMasters();
  syncZaimMoneyAll();
  log('=== Zaim Full Sync Complete ===');
}

// --- Utilities ---

/** Set script properties from key-value object. Run via Apps Script API or GAS editor. */
function setScriptProperties(props: Record<string, string>): void {
  PropertiesService.getScriptProperties().setProperties(props);
  log('Script properties updated', Object.keys(props));
}

/** Get all current script properties (for debugging) */
function getScriptPropertyKeys(): string[] {
  return Object.keys(PropertiesService.getScriptProperties().getProperties());
}

/** Install time-driven triggers */
function installTriggers(): void {
  // Remove existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
  }

  // Toggl hourly sync: time entries every hour
  ScriptApp.newTrigger('togglHourlySync')
    .timeBased()
    .everyHours(1)
    .create();

  // Daily sync at 12:00 PM JST: Toggl + Tanita + Zaim
  ScriptApp.newTrigger('dailySync')
    .timeBased()
    .everyDays(1)
    .atHour(12)
    .create();

  // Google Health daily sync at 1:00 PM JST (1h after dailySync).
  ScriptApp.newTrigger('dailySyncGoogleHealth')
    .timeBased()
    .everyDays(1)
    .atHour(13)
    .create();

  // Toggl weekly historical sync on Monday at 3:00 AM JST
  ScriptApp.newTrigger('togglWeeklyHistoricalSync')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(3)
    .create();

  log('Triggers installed: togglHourlySync, dailySync, dailySyncGoogleHealth, togglWeeklyHistoricalSync');
}
