// Notion TB__RUNNING sync — pulls all pages from the running log database
// and appends them to data_warehouse_v2.raw_notion__running.
//
// Same pattern as sync-strength.ts / sync-orgasm.ts: small DB, full pull
// every run, content_hash dedup + diff-tombstone handle deltas / archives.

const NOTION_RUNNING_DATABASE_ID = '2582cd76e35b80d28950f962ab21b923';

function syncNotionRunning(): void {
  log('Syncing Notion running log...');

  const pages = notionQueryDatabaseAll(NOTION_RUNNING_DATABASE_ID);
  log(`Notion running: fetched ${pages.length} pages`);

  const records: RawRecord[] = pages
    .filter(p => !p.archived)
    .map(p => ({
      sourceId: p.id,
      data: p as unknown as Record<string, unknown>,
    }));

  appendRaw('raw_notion__running', records, '2022-06-28', { fullTable: true });
}
