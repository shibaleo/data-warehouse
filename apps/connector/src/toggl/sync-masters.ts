// Toggl Track master data synchronization

function toRawRecords(items: Record<string, unknown>[], idField: string = 'id'): RawRecord[] {
  return items.map(item => ({
    sourceId: String(item[idField]),
    data: item,
  }));
}

function syncMasters(): void {
  log('Starting master data sync...');

  const results: UpsertResult[] = [];

  // Projects
  const projects = fetchProjects() || [];
  results.push(upsertRaw('raw_toggl_track__projects', toRawRecords(projects), 'v9'));

  // Clients
  const clients = fetchClients() || [];
  results.push(upsertRaw('raw_toggl_track__clients', toRawRecords(clients), 'v9'));

  // Tags
  const tags = fetchTags() || [];
  results.push(upsertRaw('raw_toggl_track__tags', toRawRecords(tags), 'v9'));

  // Me
  const me = fetchMe();
  if (me) {
    results.push(upsertRaw('raw_toggl_track__me', [{ sourceId: String(me['id']), data: me }], 'v9'));
  }

  // Workspaces
  const workspaces = fetchWorkspaces() || [];
  results.push(upsertRaw('raw_toggl_track__workspaces', toRawRecords(workspaces), 'v9'));

  // Users
  const users = fetchUsers() || [];
  results.push(upsertRaw('raw_toggl_track__users', toRawRecords(users), 'v9'));

  // Groups
  const groups = fetchGroups() || [];
  results.push(upsertRaw('raw_toggl_track__groups', toRawRecords(groups), 'v9'));

  log('Master sync complete', results);
}
