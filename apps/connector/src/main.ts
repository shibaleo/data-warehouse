// GAS entry points (trigger functions)

/** Daily sync: masters + recent time entries */
function dailySync(): void {
  log('=== Daily Sync Start ===');
  syncMasters();
  syncTimeEntries({ days: 3 });
  log('=== Daily Sync Complete ===');
}

/** Weekly historical sync: last 30 days of report data */
function weeklyHistoricalSync(): void {
  log('=== Weekly Historical Sync Start ===');
  syncTimeEntriesReport({ days: 30 });
  log('=== Weekly Historical Sync Complete ===');
}

/** Full historical sync: last 365 days of report data */
function fullHistoricalSync(): void {
  log('=== Full Historical Sync Start ===');
  syncTimeEntriesReport({ days: 365 });
  log('=== Full Historical Sync Complete ===');
}

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

  // Daily sync at 6:00 AM JST
  ScriptApp.newTrigger('dailySync')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();

  // Weekly historical sync on Monday at 3:00 AM JST
  ScriptApp.newTrigger('weeklyHistoricalSync')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(3)
    .create();

  log('Triggers installed');
}
