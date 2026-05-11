-- tests/dim_at_retroactive.sql
-- Verify example_dim_at(biz_t, tx_t) returns correct rows across the
-- retroactive / future-dated / soft-delete scenarios seeded by 013.

BEGIN;

SELECT plan(7);

-- Scenario reference (from 013):
--   id #1: rev 1 (Education, 2026-01-01), rev 2 (Education updated, 2026-03-01),
--          rev 3 retroactive (Study, valid_from 2026-02-15, created 2026-05-01)
--   id #2: rev 1 (Drift, 2026-01-01), rev 2 deleted (2026-05-01)
--   id #3: rev 1 (Original, 2026-04-01), rev 2 future (Renamed, valid_from 2026-06-01, created 2026-04-15)

-- 1. now(): #1 = Education r2 (valid_from 2026-03-01 > Study's 2026-02-15)
SELECT is(
  (SELECT name FROM data_warehouse_v2.example_dim_at()
    WHERE id = '00000000-0000-0000-0000-000000000001'),
  'Education',
  'now(): id #1 resolves to Education (r2 wins by valid_from over retroactive r3)'
);

-- 2. biz=2026-02-20: retroactive Study takes over (rev 3, valid_from 2026-02-15)
SELECT is(
  (SELECT name FROM data_warehouse_v2.example_dim_at('2026-02-20+09'::timestamptz)
    WHERE id = '00000000-0000-0000-0000-000000000001' AND deleted = false),
  'Study',
  'biz=2026-02-20: retroactive rev 3 (Study) is the right answer'
);

-- 3. biz=2026-04-01: rev 2 (Education, valid_from 2026-03-01) beats rev 3 (Study, valid_from 2026-02-15)
SELECT is(
  (SELECT name FROM data_warehouse_v2.example_dim_at('2026-04-01+09'::timestamptz)
    WHERE id = '00000000-0000-0000-0000-000000000001' AND deleted = false),
  'Education',
  'biz=2026-04-01: rev 2 wins by valid_from DESC, not revision DESC'
);

-- 4. tx=2026-03-15, biz=2026-02-20: rev 3 not yet observed, so rev 1 visible
SELECT is(
  (SELECT name FROM data_warehouse_v2.example_dim_at(
     '2026-02-20+09'::timestamptz, '2026-03-15+09'::timestamptz)
    WHERE id = '00000000-0000-0000-0000-000000000001' AND deleted = false),
  'Education',
  'tx=2026-03-15: retroactive r3 (created 2026-05-01) is hidden, r1 visible'
);

-- 5. id #2 soft-delete: at biz=2026-04-01 still alive
SELECT is(
  (SELECT deleted FROM data_warehouse_v2.example_dim_at('2026-04-01+09'::timestamptz)
    WHERE id = '00000000-0000-0000-0000-000000000002'),
  false,
  'biz=2026-04-01: id #2 is still alive'
);

-- 6. id #2 soft-delete: at biz=2026-06-01 deleted
SELECT is(
  (SELECT deleted FROM data_warehouse_v2.example_dim_at('2026-06-01+09'::timestamptz)
    WHERE id = '00000000-0000-0000-0000-000000000002'),
  true,
  'biz=2026-06-01: id #2 is tombstoned'
);

-- 7. id #3 future-dated: at biz=2026-06-15 the rename is in effect
SELECT is(
  (SELECT name FROM data_warehouse_v2.example_dim_at('2026-06-15+09'::timestamptz)
    WHERE id = '00000000-0000-0000-0000-000000000003' AND deleted = false),
  'Renamed',
  'biz=2026-06-15: future-dated rename is active'
);

SELECT finish();
ROLLBACK;
