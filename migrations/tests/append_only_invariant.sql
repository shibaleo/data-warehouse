-- tests/append_only_invariant.sql
-- Verify enable_append_only_protection blocks UPDATE and DELETE.

BEGIN;

SELECT plan(4);

-- Create a throwaway dim table and enable protection.
CREATE TABLE data_warehouse_v2._test_protected (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    revision int NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    valid_from timestamptz NOT NULL DEFAULT now(),
    label text NOT NULL,
    deleted boolean NOT NULL DEFAULT false,
    purged boolean NOT NULL DEFAULT false,
    PRIMARY KEY (id, revision)
);

INSERT INTO data_warehouse_v2._test_protected (revision, label) VALUES (1, 'a');

CALL data_warehouse_v2.enable_append_only_protection('_test_protected');

-- UPDATE blocked
SELECT throws_ok(
  $$ UPDATE data_warehouse_v2._test_protected SET label = 'b' $$,
  'P0001',
  NULL,
  'UPDATE on a protected table raises append-only exception'
);

-- DELETE blocked
SELECT throws_ok(
  $$ DELETE FROM data_warehouse_v2._test_protected $$,
  'P0001',
  NULL,
  'DELETE on a protected table raises append-only exception'
);

-- INSERT still works
SELECT lives_ok(
  $$ INSERT INTO data_warehouse_v2._test_protected (revision, label) VALUES (2, 'c') $$,
  'INSERT is allowed on a protected table'
);

-- Triggers are present
SELECT is(
  (SELECT count(*)::int FROM information_schema.triggers
    WHERE event_object_schema = 'data_warehouse_v2'
      AND event_object_table = '_test_protected'),
  2,
  'enable_append_only_protection installs exactly 2 triggers'
);

-- Tear down (DROP works because triggers don't fire on DDL)
DROP TABLE data_warehouse_v2._test_protected;

SELECT finish();
ROLLBACK;
