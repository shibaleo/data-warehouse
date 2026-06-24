// Notion TB__ORGASM sync — pulls all pages from the orgasm log database
// and appends them to data_warehouse_v2.raw_notion__orgasm.
//
// Same pattern as sync-strength.ts: small DB, full pull every run,
// content_hash dedup + diff-tombstone handle deltas / archives.

const NOTION_ORGASM_DATABASE_ID = '2a62cd76e35b8092bfcedadc537c9efc';

function syncNotionOrgasm(): void {
  log('Syncing Notion orgasm log...');

  const pages = notionQueryDatabaseAll(NOTION_ORGASM_DATABASE_ID);
  log(`Notion orgasm: fetched ${pages.length} pages`);

  const records: RawRecord[] = pages
    .filter(p => !p.archived)
    .map(p => ({
      sourceId: p.id,
      data: p as unknown as Record<string, unknown>,
    }));

  appendRaw('raw_notion__orgasm', records, '2022-06-28', { fullTable: true });
}
