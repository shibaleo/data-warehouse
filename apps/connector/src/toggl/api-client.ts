// Toggl Track API Client for GAS
// Track API v9: https://api.track.toggl.com/api/v9
// Reports API v3: https://api.track.toggl.com/reports/api/v3

const TOGGL_API_V9 = 'https://api.track.toggl.com/api/v9';
const TOGGL_REPORTS_V3 = 'https://api.track.toggl.com/reports/api/v3';

// Sentinel string embedded in Error.message so callers can detect quota-exceeded
// (402) responses and skip the rest of the sync without retrying.
const TOGGL_QUOTA_SENTINEL = 'TogglQuotaExceeded';
const TOGGL_402_COUNTER_KEY = 'toggl_402_count';
// Time-entries / detailed-report page size used by Toggl. Reaching this on
// /me/time_entries is a signal that the requested window is too wide.
const TOGGL_PAGE_SIZE = 1000;

function isTogglQuotaError(err: unknown): boolean {
  return err instanceof Error && err.message.indexOf(TOGGL_QUOTA_SENTINEL) !== -1;
}

function bumpToggl402Counter(): void {
  const props = PropertiesService.getScriptProperties();
  const cur = parseInt(props.getProperty(TOGGL_402_COUNTER_KEY) || '0', 10) || 0;
  props.setProperty(TOGGL_402_COUNTER_KEY, String(cur + 1));
}

function checkTogglResponse(code: number, body: string): void {
  if (code === 402) {
    bumpToggl402Counter();
    log(`Toggl quota exceeded (HTTP 402), skipping. body=${body.substring(0, 200)}`);
    throw new Error(`${TOGGL_QUOTA_SENTINEL}: HTTP 402`);
  }
  if (code >= 400) {
    throw new Error(`Toggl HTTP ${code}: ${body.substring(0, 500)}`);
  }
}

interface TogglCredentials {
  apiToken: string;
  workspaceId: string;
}

let cachedTogglCredentials: TogglCredentials | null = null;

function getTogglCredentials(): TogglCredentials {
  if (cachedTogglCredentials) return cachedTogglCredentials;

  const result = neonQuery(
    `SELECT access_token,
            (metadata->>'workspace_id') as workspace_id
     FROM data_warehouse.credentials
     WHERE service_name = $1`,
    ['toggl_track']
  ) as { fields: unknown[]; rows: unknown[][] };

  if (!result.rows || result.rows.length === 0) {
    throw new Error('Toggl credentials not found in credentials');
  }

  const row = result.rows[0];
  cachedTogglCredentials = {
    apiToken: String(row[0]),
    workspaceId: String(row[1]),
  };

  return cachedTogglCredentials;
}

function getTogglAuthHeader(): string {
  const creds = getTogglCredentials();
  const encoded = Utilities.base64Encode(`${creds.apiToken}:api_token`);
  return `Basic ${encoded}`;
}

function togglGet(url: string): unknown {
  const response = httpFetch(url, {
    headers: { 'Authorization': getTogglAuthHeader() },
  });
  const body = response.getContentText();
  checkTogglResponse(response.getResponseCode(), body);
  return JSON.parse(body);
}

function togglPost(url: string, body: unknown): unknown {
  const response = httpFetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': getTogglAuthHeader() },
    payload: JSON.stringify(body),
  });
  const text = response.getContentText();
  checkTogglResponse(response.getResponseCode(), text);
  return JSON.parse(text);
}

// --- Track API v9 ---

function fetchMe(): Record<string, unknown> {
  return togglGet(`${TOGGL_API_V9}/me`) as Record<string, unknown>;
}

function fetchWorkspaces(): Record<string, unknown>[] {
  return togglGet(`${TOGGL_API_V9}/workspaces`) as Record<string, unknown>[];
}

function fetchProjects(): Record<string, unknown>[] {
  const creds = getTogglCredentials();
  return togglGet(`${TOGGL_API_V9}/workspaces/${creds.workspaceId}/projects`) as Record<string, unknown>[];
}

function fetchClients(): Record<string, unknown>[] {
  const creds = getTogglCredentials();
  return togglGet(`${TOGGL_API_V9}/workspaces/${creds.workspaceId}/clients`) as Record<string, unknown>[];
}

function fetchTags(): Record<string, unknown>[] {
  const creds = getTogglCredentials();
  return togglGet(`${TOGGL_API_V9}/workspaces/${creds.workspaceId}/tags`) as Record<string, unknown>[];
}

function fetchUsers(): Record<string, unknown>[] {
  const creds = getTogglCredentials();
  return togglGet(`${TOGGL_API_V9}/workspaces/${creds.workspaceId}/users`) as Record<string, unknown>[];
}

function fetchGroups(): Record<string, unknown>[] {
  const creds = getTogglCredentials();
  return togglGet(`${TOGGL_API_V9}/workspaces/${creds.workspaceId}/groups`) as Record<string, unknown>[];
}

function fetchTimeEntries(startDate: string, endDate: string): Record<string, unknown>[] {
  const entries = togglGet(
    `${TOGGL_API_V9}/me/time_entries?start_date=${startDate}&end_date=${endDate}`
  ) as Record<string, unknown>[];
  if (entries && entries.length >= TOGGL_PAGE_SIZE) {
    // Track v9 caps /me/time_entries at this page size. Hitting it means the
    // requested window is too wide (e.g. stale `since`, GAS long downtime) —
    // investigate manually; auto-pagination intentionally not implemented.
    log(`WARN: /me/time_entries returned ${entries.length} rows (>= page size ${TOGGL_PAGE_SIZE}) for ${startDate}..${endDate}`);
  }
  return entries;
}

// --- Reports API v3 ---

interface DetailedReportResponse {
  time_entries: Record<string, unknown>[];
  row_count: number;
  total_count?: number;
}

function fetchDetailedReport(
  startDate: string,
  endDate: string,
  firstRowNumber: number = 1,
  pageSize: number = 1000
): DetailedReportResponse {
  const creds = getTogglCredentials();
  const body = {
    start_date: startDate,
    end_date: endDate,
    first_row_number: firstRowNumber,
    page_size: pageSize,
  };

  const raw = togglPost(
    `${TOGGL_REPORTS_V3}/workspace/${creds.workspaceId}/search/time_entries`,
    body
  ) as Record<string, unknown>[];

  // Reports API v3 returns an array of grouped entries
  // Each group has common fields + nested time_entries array
  const flatEntries: Record<string, unknown>[] = [];
  for (const group of raw) {
    const timeEntries = (group['time_entries'] as Record<string, unknown>[]) || [];
    for (const entry of timeEntries) {
      flatEntries.push({
        ...entry,
        user_id: group['user_id'],
        username: group['username'],
        project_id: group['project_id'],
        task_id: group['task_id'],
        billable: group['billable'],
        description: group['description'],
        tag_ids: group['tag_ids'],
      });
    }
  }

  return {
    time_entries: flatEntries,
    row_count: flatEntries.length,
  };
}

function fetchAllDetailedReport(startDate: string, endDate: string): Record<string, unknown>[] {
  const allEntries: Record<string, unknown>[] = [];
  let firstRowNumber = 1;
  const pageSize = 1000;

  while (true) {
    const result = fetchDetailedReport(startDate, endDate, firstRowNumber, pageSize);
    allEntries.push(...result.time_entries);

    if (result.row_count < pageSize) {
      break;
    }
    firstRowNumber += pageSize;
    Utilities.sleep(1000); // Rate limit
  }

  return allEntries;
}
