// Toggl Track time entries synchronization (Track API v9)
//
// Differential delete is window-scoped: any entry in [startDate, endDate)
// whose source_id no longer comes back from the API is removed from raw.
// In-progress entries (stop IS NULL) are protected — Track v9 returns those
// as part of the live state and we don't want to delete them on transient
// API quirks.

interface SyncTimeEntriesOptions {
  days?: number;
  start?: string; // YYYY-MM-DD
  end?: string;   // YYYY-MM-DD
}

function syncTimeEntries(options: SyncTimeEntriesOptions = {}): void {
  const days = options.days || 3;
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const endDate = options.end || Utilities.formatDate(tomorrow, 'UTC', 'yyyy-MM-dd');
  const startDateObj = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const startDate = options.start || Utilities.formatDate(startDateObj, 'UTC', 'yyyy-MM-dd');

  log(`Syncing time entries: ${startDate} to ${endDate}`);

  const entries = fetchTimeEntries(startDate, endDate) || [];
  const records = toRawRecords(entries);

  upsertRaw('raw_toggl_track__time_entries', records, 'v9', {
    dateField: 'start',
    start: `${startDate}T00:00:00Z`,
    end: `${endDate}T00:00:00Z`,
    protectInProgress: true,
  });
}
