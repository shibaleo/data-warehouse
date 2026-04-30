// Toggl Track master data synchronization

function toRawRecords(items: Record<string, unknown>[], idField: string = 'id'): RawRecord[] {
  return items.map(item => ({
    sourceId: String(item[idField]),
    data: item,
  }));
}

/**
 * Sync master data from Toggl. Differential delete is enabled for tags,
 * projects, and clients so entries deleted upstream disappear from raw.
 *
 * Workspaces / users / groups / me are not differentially deleted because:
 *   - workspaces/users/groups: rarely change; a delete here would imply
 *     account-level disruption better resolved manually
 *   - me: there's only one row, idempotent upsert is enough
 */
function syncMasters(): void {
  log('Starting master data sync...');

  // Projects (full-table differential)
  const projects = fetchProjects() || [];
  upsertRaw('raw_toggl_track__projects', toRawRecords(projects), 'v9', { fullTable: true });

  // Clients (full-table differential)
  const clients = fetchClients() || [];
  upsertRaw('raw_toggl_track__clients', toRawRecords(clients), 'v9', { fullTable: true });

  // Tags (full-table differential)
  const tags = fetchTags() || [];
  upsertRaw('raw_toggl_track__tags', toRawRecords(tags), 'v9', { fullTable: true });

  // Me (single row, no diff needed)
  const me = fetchMe();
  if (me) {
    upsertRaw('raw_toggl_track__me', [{ sourceId: String(me['id']), data: me }], 'v9');
  }

  // Workspaces / users / groups (no diff: rarely change, manual cleanup if needed)
  upsertRaw('raw_toggl_track__workspaces', toRawRecords(fetchWorkspaces() || []), 'v9');
  upsertRaw('raw_toggl_track__users', toRawRecords(fetchUsers() || []), 'v9');
  upsertRaw('raw_toggl_track__groups', toRawRecords(fetchGroups() || []), 'v9');

  log('Master sync complete');
}
