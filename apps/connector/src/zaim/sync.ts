// Zaim data sync — money, category, genre, account to data_warehouse_v2
// raw tables (append-only).
//
// Masters (category / genre / account) carry an upstream `modified` field;
// it stays stable unless the user actually edits the master, so it is part
// of content_hash. Same for money's `created` field. No diff-tombstone is
// configured — Zaim deletions in the past 30 days are rare enough that
// catching them eventually (next time the user runs a full re-sync) is OK.

const ZAIM_API_VERSION = 'v2';

// ---------------------------------------------------------------------------
// Money (Transactions)
// ---------------------------------------------------------------------------

function syncZaimMoney(days: number = 30): void {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  log(`Syncing Zaim money (${days} days)...`);
  const startDate = zaimFormatDate(start);
  const endDate = zaimFormatDate(tomorrow);

  const money = fetchZaimAllMoney(startDate, endDate);

  if (money.length === 0) { log('No Zaim money data'); return; }

  const records: RawRecord[] = money.map(m => ({
    sourceId: String(m.id),
    data: {
      id: m.id,
      mode: m.mode,
      user_id: m.user_id,
      date: m.date,
      category_id: m.category_id,
      genre_id: m.genre_id,
      to_account_id: m.to_account_id,
      from_account_id: m.from_account_id,
      amount: m.amount,
      comment: m.comment,
      active: m.active,
      name: m.name,
      receipt_id: m.receipt_id,
      place: m.place,
      created: m.created,
      currency_code: m.currency_code,
    },
  }));

  appendRaw('raw_zaim__money', records, ZAIM_API_VERSION);
}

/** Full sync — fetch all money records from 2020-01-01 */
function syncZaimMoneyAll(): void {
  log('Syncing Zaim money (ALL records)...');
  const startDate = '2020-01-01';
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const endDate = zaimFormatDate(tomorrow);

  const money = fetchZaimAllMoney(startDate, endDate);

  if (money.length === 0) { log('No Zaim money data'); return; }

  const records: RawRecord[] = money.map(m => ({
    sourceId: String(m.id),
    data: {
      id: m.id,
      mode: m.mode,
      user_id: m.user_id,
      date: m.date,
      category_id: m.category_id,
      genre_id: m.genre_id,
      to_account_id: m.to_account_id,
      from_account_id: m.from_account_id,
      amount: m.amount,
      comment: m.comment,
      active: m.active,
      name: m.name,
      receipt_id: m.receipt_id,
      place: m.place,
      created: m.created,
      currency_code: m.currency_code,
    },
  }));

  appendRaw('raw_zaim__money', records, ZAIM_API_VERSION);
}

// ---------------------------------------------------------------------------
// Category master
// ---------------------------------------------------------------------------

function syncZaimCategory(): void {
  log('Syncing Zaim categories...');
  const categories = fetchZaimCategories();

  if (categories.length === 0) { log('No Zaim category data'); return; }

  const records: RawRecord[] = categories.map(c => ({
    sourceId: String(c.id),
    data: {
      id: c.id,
      name: c.name,
      mode: c.mode,
      sort: c.sort,
      parent_category_id: c.parent_category_id,
      active: c.active,
      modified: c.modified,
    },
  }));

  appendRaw('raw_zaim__category', records, ZAIM_API_VERSION, { fullTable: true });
}

// ---------------------------------------------------------------------------
// Genre master
// ---------------------------------------------------------------------------

function syncZaimGenre(): void {
  log('Syncing Zaim genres...');
  const genres = fetchZaimGenres();

  if (genres.length === 0) { log('No Zaim genre data'); return; }

  const records: RawRecord[] = genres.map(g => ({
    sourceId: String(g.id),
    data: {
      id: g.id,
      name: g.name,
      sort: g.sort,
      active: g.active,
      category_id: g.category_id,
      parent_genre_id: g.parent_genre_id,
      modified: g.modified,
    },
  }));

  appendRaw('raw_zaim__genre', records, ZAIM_API_VERSION, { fullTable: true });
}

// ---------------------------------------------------------------------------
// Account master
// ---------------------------------------------------------------------------

function syncZaimAccount(): void {
  log('Syncing Zaim accounts...');
  const accounts = fetchZaimAccounts();

  if (accounts.length === 0) { log('No Zaim account data'); return; }

  const records: RawRecord[] = accounts.map(a => ({
    sourceId: String(a.id),
    data: {
      id: a.id,
      name: a.name,
      modified: a.modified,
      sort: a.sort,
      active: a.active,
      local_id: a.local_id,
      website_id: a.website_id,
      parent_account_id: a.parent_account_id,
    },
  }));

  appendRaw('raw_zaim__account', records, ZAIM_API_VERSION, { fullTable: true });
}

// ---------------------------------------------------------------------------
// Orchestrators
// ---------------------------------------------------------------------------

function syncZaimMasters(): void {
  syncZaimCategory();
  syncZaimGenre();
  syncZaimAccount();
}

function syncZaimAll(days: number = 400): void {
  syncZaimMasters();
  syncZaimMoney(days);
}
