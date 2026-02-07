// Toggl Track API Client for GAS
// Track API v9: https://api.track.toggl.com/api/v9
// Reports API v3: https://api.track.toggl.com/reports/api/v3

const TOGGL_API_V9 = 'https://api.track.toggl.com/api/v9';
const TOGGL_REPORTS_V3 = 'https://api.track.toggl.com/reports/api/v3';

function getTogglAuthHeader(): string {
  const config = getConfig();
  const encoded = Utilities.base64Encode(`${config.togglApiToken}:api_token`);
  return `Basic ${encoded}`;
}

function togglGet(url: string): unknown {
  const response = httpFetch(url, {
    headers: { 'Authorization': getTogglAuthHeader() },
  });
  return JSON.parse(response.getContentText());
}

function togglPost(url: string, body: unknown): unknown {
  const response = httpFetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': getTogglAuthHeader() },
    payload: JSON.stringify(body),
  });
  return JSON.parse(response.getContentText());
}

// --- Track API v9 ---

function fetchMe(): Record<string, unknown> {
  return togglGet(`${TOGGL_API_V9}/me`) as Record<string, unknown>;
}

function fetchWorkspaces(): Record<string, unknown>[] {
  return togglGet(`${TOGGL_API_V9}/workspaces`) as Record<string, unknown>[];
}

function fetchProjects(): Record<string, unknown>[] {
  const config = getConfig();
  return togglGet(`${TOGGL_API_V9}/workspaces/${config.togglWorkspaceId}/projects`) as Record<string, unknown>[];
}

function fetchClients(): Record<string, unknown>[] {
  const config = getConfig();
  return togglGet(`${TOGGL_API_V9}/workspaces/${config.togglWorkspaceId}/clients`) as Record<string, unknown>[];
}

function fetchTags(): Record<string, unknown>[] {
  const config = getConfig();
  return togglGet(`${TOGGL_API_V9}/workspaces/${config.togglWorkspaceId}/tags`) as Record<string, unknown>[];
}

function fetchUsers(): Record<string, unknown>[] {
  const config = getConfig();
  return togglGet(`${TOGGL_API_V9}/workspaces/${config.togglWorkspaceId}/users`) as Record<string, unknown>[];
}

function fetchGroups(): Record<string, unknown>[] {
  const config = getConfig();
  return togglGet(`${TOGGL_API_V9}/workspaces/${config.togglWorkspaceId}/groups`) as Record<string, unknown>[];
}

function fetchTimeEntries(startDate: string, endDate: string): Record<string, unknown>[] {
  return togglGet(
    `${TOGGL_API_V9}/me/time_entries?start_date=${startDate}&end_date=${endDate}`
  ) as Record<string, unknown>[];
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
  const config = getConfig();
  const body = {
    start_date: startDate,
    end_date: endDate,
    first_row_number: firstRowNumber,
    page_size: pageSize,
  };

  const raw = togglPost(
    `${TOGGL_REPORTS_V3}/workspace/${config.togglWorkspaceId}/search/time_entries`,
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
