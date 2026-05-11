-- tests/purge_uniqueness.sql
-- Verify the partial unique index on purged=true enforces single purge.
-- Cleanup happens via the outer ROLLBACK; no SAVEPOINT (which would also
-- roll back pgtap's internal state).

BEGIN;

SELECT plan(4);

INSERT INTO data_warehouse_v2.example_dim (id, revision, name)
VALUES ('77777777-7777-7777-7777-777777777777', 1, 'ToPurge');

SELECT lives_ok(
  $$ SELECT data_warehouse_v2.example_dim_purge('77777777-7777-7777-7777-777777777777') $$,
  'dim purge succeeds on first call'
);

SELECT is(
  (SELECT count(*)::int FROM data_warehouse_v2.example_dim
     WHERE id = '77777777-7777-7777-7777-777777777777' AND purged = true),
  1,
  'dim purge: exactly one purged=true revision exists'
);

SELECT lives_ok(
  $$ SELECT data_warehouse_v2.example_dim_purge('77777777-7777-7777-7777-777777777777') $$,
  'dim purge is idempotent (no-op when already purged)'
);

SELECT throws_like(
  $$ INSERT INTO data_warehouse_v2.example_dim (id, revision, name, deleted, purged)
     VALUES ('77777777-7777-7777-7777-777777777777', 9, 'BypassAttempt', true, true) $$,
  '%duplicate key%',
  'partial unique index blocks a second purged=true revision on the same id'
);

SELECT finish();
ROLLBACK;
