// Zaim API Client for GAS (OAuth 1.0a)

const ZAIM_PAGE_LIMIT = 100;
const ZAIM_REQUEST_INTERVAL_MS = 300;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ZaimMoneyRecord {
  id: number;
  mode: string;
  user_id: number;
  date: string;
  category_id: number;
  genre_id: number;
  to_account_id: number;
  from_account_id: number;
  amount: number;
  comment: string;
  active: number;
  name: string;
  receipt_id: number;
  place: string;
  created: string;
  currency_code: string;
}

interface ZaimCategory {
  id: number;
  name: string;
  mode: string;
  sort: number;
  parent_category_id: number;
  active: number;
  modified: string;
}

interface ZaimGenre {
  id: number;
  name: string;
  sort: number;
  active: number;
  category_id: number;
  parent_genre_id: number;
  modified: string;
}

interface ZaimAccount {
  id: number;
  name: string;
  modified: string;
  sort: number;
  active: number;
  local_id: number;
  website_id: number;
  parent_account_id: number;
}

// ---------------------------------------------------------------------------
// API call helper
// ---------------------------------------------------------------------------

function zaimGet(endpoint: string, params: Record<string, string> = {}): unknown {
  const url = `${ZAIM_API_BASE}${endpoint}`;

  const queryString = Object.keys(params).length > 0
    ? '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    : '';

  const authHeader = zaimOAuthHeader('GET', url, params);

  const response = httpFetch(`${url}${queryString}`, {
    headers: { Authorization: authHeader },
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  if (code >= 400) {
    throw new Error(`Zaim API error ${code}: ${response.getContentText().substring(0, 500)}`);
  }

  return JSON.parse(response.getContentText());
}

// ---------------------------------------------------------------------------
// Money (Transactions)
// ---------------------------------------------------------------------------

function fetchZaimMoney(startDate: string, endDate: string, page: number = 1): ZaimMoneyRecord[] {
  const data = zaimGet('/home/money', {
    mapping: '1',
    start_date: startDate,
    end_date: endDate,
    page: String(page),
    limit: String(ZAIM_PAGE_LIMIT),
  }) as { money?: ZaimMoneyRecord[] };

  return data.money || [];
}

/** Fetch all money records with pagination */
function fetchZaimAllMoney(startDate: string, endDate: string): ZaimMoneyRecord[] {
  const results: ZaimMoneyRecord[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    if (page > 1) Utilities.sleep(ZAIM_REQUEST_INTERVAL_MS);

    const records = fetchZaimMoney(startDate, endDate, page);
    results.push(...records);

    log(`Zaim money page ${page}: ${records.length} records`);

    if (records.length < ZAIM_PAGE_LIMIT) {
      hasMore = false;
    } else {
      page++;
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------

function fetchZaimCategories(): ZaimCategory[] {
  const data = zaimGet('/home/category', { mapping: '1' }) as { categories?: ZaimCategory[] };
  return data.categories || [];
}

function fetchZaimGenres(): ZaimGenre[] {
  const data = zaimGet('/home/genre', { mapping: '1' }) as { genres?: ZaimGenre[] };
  return data.genres || [];
}

function fetchZaimAccounts(): ZaimAccount[] {
  const data = zaimGet('/home/account', { mapping: '1' }) as { accounts?: ZaimAccount[] };
  return data.accounts || [];
}

// ---------------------------------------------------------------------------
// Date utility
// ---------------------------------------------------------------------------

function zaimFormatDate(date: Date): string {
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');
}
