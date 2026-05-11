// Toggl Track master data synchronization (append-only)
//
// Volatile-field stripping: Toggl's master endpoints include aggregate or
// audit fields that change without any real edit to the master itself —
// `actual_hours` on projects ticks every time a new time entry lands;
// `total_count` on every project reflects the workspace-level project
// count and bumps when ANY project is added; `last_modified` on workspace
// changes daily; `authorization_updated_at` on me bumps on every API call.
// Storing those naively makes every sync produce a new revision per row,
// drowning real edits in noise. Strip them at the connector so the
// content_hash only reflects user-meaningful state.
//
// All stripped fields are derivable elsewhere (time_entries for the
// project aggregates) or are pure metadata (workspace/me timestamps).

const VOLATILE_PROJECT_FIELDS = ['actual_hours', 'actual_seconds', 'total_count'];
const VOLATILE_WORKSPACE_FIELDS = ['last_modified'];
const VOLATILE_ME_FIELDS = ['authorization_updated_at'];

function stripFields(item: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out = { ...item };
  for (const f of fields) delete out[f];
  return out;
}

function toRawRecords(
  items: Record<string, unknown>[],
  idField: string = 'id',
  strip: string[] = [],
): RawRecord[] {
  return items.map(item => ({
    sourceId: String(item[idField]),
    data: strip.length > 0 ? stripFields(item, strip) : item,
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

  appendRaw('raw_toggl_track__projects',
    toRawRecords(fetchProjects() || [], 'id', VOLATILE_PROJECT_FIELDS),
    'v9', { fullTable: true });
  appendRaw('raw_toggl_track__clients',
    toRawRecords(fetchClients() || []),
    'v9', { fullTable: true });
  appendRaw('raw_toggl_track__tags',
    toRawRecords(fetchTags() || []),
    'v9', { fullTable: true });

  const me = fetchMe();
  if (me) {
    appendRaw('raw_toggl_track__me',
      [{ sourceId: String(me['id']), data: stripFields(me, VOLATILE_ME_FIELDS) }],
      'v9');
  }

  appendRaw('raw_toggl_track__workspaces',
    toRawRecords(fetchWorkspaces() || [], 'id', VOLATILE_WORKSPACE_FIELDS),
    'v9');
  appendRaw('raw_toggl_track__users',
    toRawRecords(fetchUsers() || []),
    'v9');
  appendRaw('raw_toggl_track__groups',
    toRawRecords(fetchGroups() || []),
    'v9');

  log('Master sync complete');
}
