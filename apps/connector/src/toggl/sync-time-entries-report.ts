// Toggl Track time entries synchronization via Reports API v3.
//
// Two cleanup layers:
//   1. Per-chunk differential delete on raw_toggl_track__time_entries_report —
//      catches entries deleted upstream within each chunk's date range
//   2. Cross-table cleanup on raw_toggl_track__time_entries — catches Track v9
//      orphans that Track's narrow daily window cannot detect on its own
//      (e.g. user deletes an entry 5 days after it was first synced)

interface SyncReportOptions {
  days?: number;
  start?: string; // YYYY-MM-DD
  end?: string;   // YYYY-MM-DD
}

function syncTimeEntriesReport(options: SyncReportOptions = {}): void {
  const days = options.days || 365;
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const endDate = options.end || Utilities.formatDate(tomorrow, 'UTC', 'yyyy-MM-dd');
  const startDateObj = new Date(tomorrow.getTime() - days * 24 * 60 * 60 * 1000);
  const startDate = options.start || Utilities.formatDate(startDateObj, 'UTC', 'yyyy-MM-dd');

  log(`Syncing time entries report: ${startDate} to ${endDate}`);

  // Reports API allows up to 1-year detailed-report queries.
  const chunks = splitDateRange(startDate, endDate, 365);

  for (const chunk of chunks) {
    log(`Processing chunk: ${chunk.start} to ${chunk.end}`);
    const entries = fetchAllDetailedReport(chunk.start, chunk.end);

    const seen = new Set<string>();
    const unique: RawRecord[] = [];
    for (const entry of entries) {
      const id = String(entry['id']);
      if (!seen.has(id)) {
        seen.add(id);
        unique.push({ sourceId: id, data: entry });
      }
    }

    upsertRaw('raw_toggl_track__time_entries_report', unique, 'v3', {
      dateField: 'start',
      start: `${chunk.start}T00:00:00Z`,
      end: `${chunk.end}T00:00:00Z`,
      // Reports API only returns completed entries, so all rows in raw should
      // have stop set; protectInProgress is unnecessary here.
    });
  }

  // Catch-all: drop track-only entries that have already been confirmed
  // deleted by the just-refreshed Reports authority.
  cleanupStaleTrackEntries(startDate, endDate);

  log('Report sync complete');
}

function splitDateRange(start: string, end: string, maxDays: number): { start: string; end: string }[] {
  const chunks: { start: string; end: string }[] = [];
  let currentStart = new Date(start);
  const endDate = new Date(end);

  while (currentStart < endDate) {
    const chunkEnd = new Date(currentStart.getTime() + maxDays * 24 * 60 * 60 * 1000);
    const actualEnd = chunkEnd < endDate ? chunkEnd : endDate;
    chunks.push({
      start: Utilities.formatDate(currentStart, 'UTC', 'yyyy-MM-dd'),
      end: Utilities.formatDate(actualEnd, 'UTC', 'yyyy-MM-dd'),
    });
    currentStart = new Date(actualEnd.getTime() + 24 * 60 * 60 * 1000);
  }

  return chunks;
}

/**
 * Cross-table cleanup: remove track entries (Track API v9 raw) whose
 * source_id is missing from Reports. Track v9 daily sync uses a narrow
 * window (1-3 days) so deletions older than that aren't caught by Track's
 * own differential delete; this sweep, run after the weekly Reports sync,
 * handles the gap.
 *
 * In-progress entries are protected: Reports never returns those by API
 * design, so absence is not deletion.
 */
function cleanupStaleTrackEntries(startDate: string, endDate: string): void {
  const result = neonQuery(
    `DELETE FROM data_warehouse.raw_toggl_track__time_entries t
     WHERE (t.data->>'start')::timestamptz >= ($1)::timestamptz
       AND (t.data->>'start')::timestamptz <  ($2)::timestamptz
       AND (t.data->>'stop') IS NOT NULL
       AND (t.data->>'duration')::bigint > 0
       AND t.synced_at < now() - interval '5 minutes'
       AND NOT EXISTS (
         SELECT 1 FROM data_warehouse.raw_toggl_track__time_entries_report r
         WHERE r.source_id = t.source_id
       )`,
    [`${startDate}T00:00:00Z`, `${endDate}T00:00:00Z`],
  ) as { rowCount?: number; rows?: unknown[] };

  const deleted = result.rowCount ?? (result.rows ? result.rows.length : 0);
  log(`Cleanup: removed ${deleted} stale track entries (deleted in Toggl)`);
}
