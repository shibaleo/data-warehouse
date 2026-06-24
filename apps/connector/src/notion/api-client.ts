// Notion API client (database query only — we treat the strength DB as a
// flat append-only source). Uses the integration token + database id stored
// in Script Properties.
//
// Docs: https://developers.notion.com/reference/post-database-query
// Notion-Version header is required and pinned to 2022-06-28 (matches the
// raw table's api_version column).

const NOTION_API_VERSION = '2022-06-28';
const NOTION_PAGE_SIZE = 100;
const NOTION_REQUEST_INTERVAL_MS = 350;   // ≤ 3 req/sec sustained

interface NotionPage {
  object: 'page';
  id: string;
  created_time: string;
  last_edited_time: string;
  archived: boolean;
  properties: Record<string, unknown>;
  [k: string]: unknown;
}

interface NotionQueryResponse {
  object: 'list';
  results: NotionPage[];
  next_cursor: string | null;
  has_more: boolean;
}

/**
 * Query a Notion database, following pagination until exhausted.
 *
 * The Notion query endpoint does not support arbitrary server-side date
 * filters cheaply for our shape — the strength DB is small (a few hundred
 * rows total), so we always pull everything and let downstream tombstoning
 * + content_hash dedup handle deletes / edits.
 */
function notionQueryDatabaseAll(databaseId: string): NotionPage[] {
  const { accessToken } = getNotionCredentials();
  const url = `https://api.notion.com/v1/databases/${databaseId}/query`;
  const all: NotionPage[] = [];
  let cursor: string | null = null;

  do {
    const body: Record<string, unknown> = { page_size: NOTION_PAGE_SIZE };
    if (cursor) body.start_cursor = cursor;

    const response = httpFetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Notion-Version': NOTION_API_VERSION,
      },
      payload: JSON.stringify(body),
    });

    const code = response.getResponseCode();
    if (code >= 400) {
      throw new Error(`Notion query failed ${code}: ${response.getContentText().substring(0, 500)}`);
    }

    const parsed = JSON.parse(response.getContentText()) as NotionQueryResponse;
    all.push(...parsed.results);
    cursor = parsed.has_more ? parsed.next_cursor : null;

    if (cursor) Utilities.sleep(NOTION_REQUEST_INTERVAL_MS);
  } while (cursor);

  return all;
}
