// Toggl Track master data synchronization (append-only)

function toRawRecords(items: Record<string, unknown>[], idField: string = 'id'): RawRecord[] {
  return items.map(item => ({
    sourceId: String(item[idField]),
    data: item,
  }));
}

/**
 * Sync master data from Toggl. Tags / projects / clients use full-table
 * tombstoning so entries deleted upstream get a deleted=true revision
 * appended (rather than physically removed).
 *
 * me / workspaces / users / groups skip diff-tombstoning:
 *   - me: single row, idempotent append is enough
 *   - workspaces / users / groups: rarely change; an apparent disappearance
 *     is more likely an account-level disruption than a real delete and
 *     should be reviewed manually
 */
function syncMasters(): void {
  log('Starting master data sync...');

  appendRaw('raw_toggl_track__projects', toRawRecords(fetchProjects() || []), 'v9', { fullTable: true });
  appendRaw('raw_toggl_track__clients',  toRawRecords(fetchClients()  || []), 'v9', { fullTable: true });
  appendRaw('raw_toggl_track__tags',     toRawRecords(fetchTags()     || []), 'v9', { fullTable: true });

  const me = fetchMe();
  if (me) {
    appendRaw('raw_toggl_track__me', [{ sourceId: String(me['id']), data: me }], 'v9');
  }

  appendRaw('raw_toggl_track__workspaces', toRawRecords(fetchWorkspaces() || []), 'v9');
  appendRaw('raw_toggl_track__users',      toRawRecords(fetchUsers()      || []), 'v9');
  appendRaw('raw_toggl_track__groups',     toRawRecords(fetchGroups()     || []), 'v9');

  log('Master sync complete');
}
