// Notion strength-log sync — pulls all pages from the TB__STRENGTH database
// and appends them to data_warehouse_v2.raw_notion__strength.
//
// Volume: a few hundred rows total, single-digit additions per day. Full
// re-query is cheap (≤ 5 paginated requests). We therefore always do a
// full pull and rely on:
//   - content_hash dedup in appendRaw to skip unchanged pages
//   - diff-tombstone with { fullTable: true } to flip archived / deleted
//     pages to deleted=true
//
// Notion's default query excludes archived pages, so they disappear from
// the response and the tombstone logic catches them automatically. Any
// page that re-surfaces (archived flipped back) is restored by appendRaw
// via its "latest is deleted → fresh revision" branch.
//
// TZ: stored fields are Notion's `created_time` / `last_edited_time` (Z
// suffix, UTC) and the `date` property (naive calendar date with no
// time). Both satisfy the CLAUDE.md offset rule without backfill.

const NOTION_RAW_API_VERSION = '2022-06-28';

// Notion database IDs are not secrets — they're visible in the database URL —
// so we keep them in source instead of Script Properties. Only NOTION_TOKEN
// needs to live in Script Properties.
const NOTION_STRENGTH_DATABASE_ID = '1d32cd76e35b8027b086fbc1d26911e0';

function syncNotionStrength(): void {
  log('Syncing Notion strength log...');

  const pages = notionQueryDatabaseAll(NOTION_STRENGTH_DATABASE_ID);
  log(`Notion strength: fetched ${pages.length} pages`);

  const records: RawRecord[] = pages
    .filter(p => !p.archived)
    .map(p => ({
      sourceId: p.id,
      data: p as unknown as Record<string, unknown>,
    }));

  appendRaw('raw_notion__strength', records, NOTION_RAW_API_VERSION, { fullTable: true });
}
