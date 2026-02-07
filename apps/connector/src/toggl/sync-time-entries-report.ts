// Toggl Track time entries report synchronization (Reports API v3)

interface SyncReportOptions {
  days?: number;
  start?: string; // YYYY-MM-DD
  end?: string;   // YYYY-MM-DD
}

function syncTimeEntriesReport(options: SyncReportOptions = {}): void {
  const days = options.days || 365;
  const now = new Date();
  const endDate = options.end || Utilities.formatDate(now, 'UTC', 'yyyy-MM-dd');
  const startDateObj = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const startDate = options.start || Utilities.formatDate(startDateObj, 'UTC', 'yyyy-MM-dd');

  log(`Syncing time entries report: ${startDate} to ${endDate}`);

  // Split into yearly chunks to avoid API limits and GAS 6-min timeout
  const chunks = splitDateRange(startDate, endDate, 365);

  for (const chunk of chunks) {
    log(`Processing chunk: ${chunk.start} to ${chunk.end}`);
    const entries = fetchAllDetailedReport(chunk.start, chunk.end);

    // Deduplicate by entry ID
    const seen = new Set<string>();
    const unique: RawRecord[] = [];
    for (const entry of entries) {
      const id = String(entry['id']);
      if (!seen.has(id)) {
        seen.add(id);
        unique.push({ sourceId: id, data: entry });
      }
    }

    upsertRaw('raw_toggl_track__time_entries_report', unique, 'v3');
    log(`Chunk complete: ${unique.length} unique entries`);
  }

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
