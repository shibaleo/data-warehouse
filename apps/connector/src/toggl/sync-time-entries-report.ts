// Toggl Track time entries synchronization via Reports API v3 (append-only).
//
// Two cleanup layers, both implemented as tombstone INSERTs under append-only:
//   1. Per-chunk diff-tombstone on raw_toggl_track__time_entries_report —
//      catches entries deleted upstream within each chunk's date range.
//   2. Cross-table cleanup on raw_toggl_track__time_entries — appends
//      tombstones for Track v9 orphans that Track's narrow daily window
//      cannot detect on its own (e.g. user deletes an entry 5 days after
//      it was first synced).

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
    let entries: Record<string, unknown>[];
    try {
      entries = fetchAllDetailedReport(chunk.start, chunk.end);
    } catch (err) {
      if (isTogglQuotaError(err)) {
        log(`syncTimeEntriesReport skipped at chunk ${chunk.start}..${chunk.end} due to Toggl 402; next trigger will retry`);
        return;
      }
      throw err;
    }

    const seen = new Set<string>();
    const unique: RawRecord[] = [];
    for (const entry of entries) {
      const id = String(entry['id']);
      if (!seen.has(id)) {
        seen.add(id);
        unique.push({ sourceId: id, data: entry });
      }
    }

    appendRaw('raw_toggl_track__time_entries_report', unique, 'v3', {
      dateField: 'start',
      start: `${chunk.start}T00:00:00Z`,
      end: `${chunk.end}T00:00:00Z`,
      // Reports API only returns completed entries, so all rows in raw should
      // have stop set; protectInProgress is unnecessary here.
    });
  }

  // Catch-all: tombstone any track entry that the just-refreshed Reports
  // authority confirms is gone.
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
 * Cross-table cleanup: append a tombstone for any Track v9 raw row that is
 * still "live" (latest revision deleted=false) but whose source_id is
 * absent from the freshly-synced Reports authority.
 *
 * In-progress entries (stop IS NULL) are protected: Reports never returns
 * those by API design, so absence is not deletion.
 */
function cleanupStaleTrackEntries(startDate: string, endDate: string): void {
  const result = neonQuery(
    `WITH targets AS (
       SELECT cur.source_id, cur.data, cur.content_hash, cur.revision
       FROM data_warehouse_v2.raw_toggl_track__time_entries_current cur
       WHERE (cur.data->>'start')::timestamptz >= ($1)::timestamptz
         AND (cur.data->>'start')::timestamptz <  ($2)::timestamptz
         AND (cur.data->>'stop') IS NOT NULL
         AND cur.created_at < now() - interval '5 minutes'
         AND NOT EXISTS (
           SELECT 1 FROM data_warehouse_v2.raw_toggl_track__time_entries_report_current r
           WHERE r.source_id = cur.source_id
         )
     ),
     tombstones AS (
       INSERT INTO data_warehouse_v2.raw_toggl_track__time_entries
         (source_id, revision, data, content_hash, deleted, purged, api_version)
       SELECT t.source_id, t.revision + 1, t.data, t.content_hash, true, false, 'v9'
       FROM targets t
       RETURNING 1
     )
     SELECT count(*) AS tombstoned FROM tombstones`,
    [`${startDate}T00:00:00Z`, `${endDate}T00:00:00Z`],
  ) as { rows?: unknown[][] };

  const tombstoned = result.rows && result.rows.length > 0
    ? parseInt(String(result.rows[0][0]), 10) || 0
    : 0;
  log(`Cross-table cleanup: tombstoned ${tombstoned} stale track entries`);
}
