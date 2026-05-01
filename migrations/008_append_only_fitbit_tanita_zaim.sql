-- 008_append_only_fitbit_tanita_zaim.sql
-- =============================================================================
-- Phase 2: extend the append-only / uni-temporal pattern (introduced in 007
-- for Toggl) to Fitbit, Tanita Health Planet, and Zaim raw tables.
--
-- 14 tables total:
--   Fitbit  (8): activity, breathing_rate, cardio_score, heart_rate, hrv,
--                sleep, spo2, temperature_skin
--   Tanita  (2): blood_pressure, body_composition
--   Zaim    (4): money, category, genre, account
--
-- All tables go into the same data_warehouse_v2 schema as the Toggl tables.
-- Old data_warehouse.raw_* tables remain untouched as the rollback path;
-- they will be DROPped together with the Toggl archives after smoke test.
--
-- Hash semantics: md5((data - 'at')::text). The connector for Fitbit /
-- Tanita / Zaim does not include an 'at' field in its projected payload, so
-- 'data - at' is a no-op for these sources — the hash covers the full
-- content. Kept identical to 007 for code-path symmetry.
-- =============================================================================

BEGIN;

-- ===== helper macro pattern (per table): =====================================
-- 1) CREATE TABLE with PK (source_id, revision)
-- 2) UNIQUE INDEX enforcing one purged=true row per source_id
-- 3) INDEX (source_id, revision DESC) for *_current view performance
-- 4) Backfill from data_warehouse.<table> as revision=1
-- 5) CREATE VIEW <table>_current
-- =============================================================================

-- ===== Fitbit =================================================================

CREATE TABLE data_warehouse_v2.raw_fitbit__activity (
    source_id TEXT NOT NULL, revision INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL,
    content_hash TEXT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT false,
    purged BOOLEAN NOT NULL DEFAULT false, api_version TEXT,
    PRIMARY KEY (source_id, revision)
);
CREATE UNIQUE INDEX raw_fitbit__activity_purge_unique
    ON data_warehouse_v2.raw_fitbit__activity (source_id) WHERE purged = true;
CREATE INDEX raw_fitbit__activity_source_revision_desc
    ON data_warehouse_v2.raw_fitbit__activity (source_id, revision DESC);
INSERT INTO data_warehouse_v2.raw_fitbit__activity
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT source_id, 1, synced_at, data, md5((data - 'at')::text), false, false, api_version
FROM data_warehouse.raw_fitbit__activity;
CREATE VIEW data_warehouse_v2.raw_fitbit__activity_current AS
SELECT * FROM (SELECT DISTINCT ON (source_id) * FROM data_warehouse_v2.raw_fitbit__activity ORDER BY source_id, revision DESC) t
WHERE deleted = false AND purged = false;

CREATE TABLE data_warehouse_v2.raw_fitbit__breathing_rate (
    source_id TEXT NOT NULL, revision INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL,
    content_hash TEXT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT false,
    purged BOOLEAN NOT NULL DEFAULT false, api_version TEXT,
    PRIMARY KEY (source_id, revision)
);
CREATE UNIQUE INDEX raw_fitbit__breathing_rate_purge_unique
    ON data_warehouse_v2.raw_fitbit__breathing_rate (source_id) WHERE purged = true;
CREATE INDEX raw_fitbit__breathing_rate_source_revision_desc
    ON data_warehouse_v2.raw_fitbit__breathing_rate (source_id, revision DESC);
INSERT INTO data_warehouse_v2.raw_fitbit__breathing_rate
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT source_id, 1, synced_at, data, md5((data - 'at')::text), false, false, api_version
FROM data_warehouse.raw_fitbit__breathing_rate;
CREATE VIEW data_warehouse_v2.raw_fitbit__breathing_rate_current AS
SELECT * FROM (SELECT DISTINCT ON (source_id) * FROM data_warehouse_v2.raw_fitbit__breathing_rate ORDER BY source_id, revision DESC) t
WHERE deleted = false AND purged = false;

CREATE TABLE data_warehouse_v2.raw_fitbit__cardio_score (
    source_id TEXT NOT NULL, revision INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL,
    content_hash TEXT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT false,
    purged BOOLEAN NOT NULL DEFAULT false, api_version TEXT,
    PRIMARY KEY (source_id, revision)
);
CREATE UNIQUE INDEX raw_fitbit__cardio_score_purge_unique
    ON data_warehouse_v2.raw_fitbit__cardio_score (source_id) WHERE purged = true;
CREATE INDEX raw_fitbit__cardio_score_source_revision_desc
    ON data_warehouse_v2.raw_fitbit__cardio_score (source_id, revision DESC);
INSERT INTO data_warehouse_v2.raw_fitbit__cardio_score
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT source_id, 1, synced_at, data, md5((data - 'at')::text), false, false, api_version
FROM data_warehouse.raw_fitbit__cardio_score;
CREATE VIEW data_warehouse_v2.raw_fitbit__cardio_score_current AS
SELECT * FROM (SELECT DISTINCT ON (source_id) * FROM data_warehouse_v2.raw_fitbit__cardio_score ORDER BY source_id, revision DESC) t
WHERE deleted = false AND purged = false;

CREATE TABLE data_warehouse_v2.raw_fitbit__heart_rate (
    source_id TEXT NOT NULL, revision INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL,
    content_hash TEXT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT false,
    purged BOOLEAN NOT NULL DEFAULT false, api_version TEXT,
    PRIMARY KEY (source_id, revision)
);
CREATE UNIQUE INDEX raw_fitbit__heart_rate_purge_unique
    ON data_warehouse_v2.raw_fitbit__heart_rate (source_id) WHERE purged = true;
CREATE INDEX raw_fitbit__heart_rate_source_revision_desc
    ON data_warehouse_v2.raw_fitbit__heart_rate (source_id, revision DESC);
INSERT INTO data_warehouse_v2.raw_fitbit__heart_rate
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT source_id, 1, synced_at, data, md5((data - 'at')::text), false, false, api_version
FROM data_warehouse.raw_fitbit__heart_rate;
CREATE VIEW data_warehouse_v2.raw_fitbit__heart_rate_current AS
SELECT * FROM (SELECT DISTINCT ON (source_id) * FROM data_warehouse_v2.raw_fitbit__heart_rate ORDER BY source_id, revision DESC) t
WHERE deleted = false AND purged = false;

CREATE TABLE data_warehouse_v2.raw_fitbit__hrv (
    source_id TEXT NOT NULL, revision INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL,
    content_hash TEXT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT false,
    purged BOOLEAN NOT NULL DEFAULT false, api_version TEXT,
    PRIMARY KEY (source_id, revision)
);
CREATE UNIQUE INDEX raw_fitbit__hrv_purge_unique
    ON data_warehouse_v2.raw_fitbit__hrv (source_id) WHERE purged = true;
CREATE INDEX raw_fitbit__hrv_source_revision_desc
    ON data_warehouse_v2.raw_fitbit__hrv (source_id, revision DESC);
INSERT INTO data_warehouse_v2.raw_fitbit__hrv
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT source_id, 1, synced_at, data, md5((data - 'at')::text), false, false, api_version
FROM data_warehouse.raw_fitbit__hrv;
CREATE VIEW data_warehouse_v2.raw_fitbit__hrv_current AS
SELECT * FROM (SELECT DISTINCT ON (source_id) * FROM data_warehouse_v2.raw_fitbit__hrv ORDER BY source_id, revision DESC) t
WHERE deleted = false AND purged = false;

CREATE TABLE data_warehouse_v2.raw_fitbit__sleep (
    source_id TEXT NOT NULL, revision INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL,
    content_hash TEXT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT false,
    purged BOOLEAN NOT NULL DEFAULT false, api_version TEXT,
    PRIMARY KEY (source_id, revision)
);
CREATE UNIQUE INDEX raw_fitbit__sleep_purge_unique
    ON data_warehouse_v2.raw_fitbit__sleep (source_id) WHERE purged = true;
CREATE INDEX raw_fitbit__sleep_source_revision_desc
    ON data_warehouse_v2.raw_fitbit__sleep (source_id, revision DESC);
INSERT INTO data_warehouse_v2.raw_fitbit__sleep
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT source_id, 1, synced_at, data, md5((data - 'at')::text), false, false, api_version
FROM data_warehouse.raw_fitbit__sleep;
CREATE VIEW data_warehouse_v2.raw_fitbit__sleep_current AS
SELECT * FROM (SELECT DISTINCT ON (source_id) * FROM data_warehouse_v2.raw_fitbit__sleep ORDER BY source_id, revision DESC) t
WHERE deleted = false AND purged = false;

CREATE TABLE data_warehouse_v2.raw_fitbit__spo2 (
    source_id TEXT NOT NULL, revision INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL,
    content_hash TEXT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT false,
    purged BOOLEAN NOT NULL DEFAULT false, api_version TEXT,
    PRIMARY KEY (source_id, revision)
);
CREATE UNIQUE INDEX raw_fitbit__spo2_purge_unique
    ON data_warehouse_v2.raw_fitbit__spo2 (source_id) WHERE purged = true;
CREATE INDEX raw_fitbit__spo2_source_revision_desc
    ON data_warehouse_v2.raw_fitbit__spo2 (source_id, revision DESC);
INSERT INTO data_warehouse_v2.raw_fitbit__spo2
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT source_id, 1, synced_at, data, md5((data - 'at')::text), false, false, api_version
FROM data_warehouse.raw_fitbit__spo2;
CREATE VIEW data_warehouse_v2.raw_fitbit__spo2_current AS
SELECT * FROM (SELECT DISTINCT ON (source_id) * FROM data_warehouse_v2.raw_fitbit__spo2 ORDER BY source_id, revision DESC) t
WHERE deleted = false AND purged = false;

CREATE TABLE data_warehouse_v2.raw_fitbit__temperature_skin (
    source_id TEXT NOT NULL, revision INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL,
    content_hash TEXT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT false,
    purged BOOLEAN NOT NULL DEFAULT false, api_version TEXT,
    PRIMARY KEY (source_id, revision)
);
CREATE UNIQUE INDEX raw_fitbit__temperature_skin_purge_unique
    ON data_warehouse_v2.raw_fitbit__temperature_skin (source_id) WHERE purged = true;
CREATE INDEX raw_fitbit__temperature_skin_source_revision_desc
    ON data_warehouse_v2.raw_fitbit__temperature_skin (source_id, revision DESC);
INSERT INTO data_warehouse_v2.raw_fitbit__temperature_skin
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT source_id, 1, synced_at, data, md5((data - 'at')::text), false, false, api_version
FROM data_warehouse.raw_fitbit__temperature_skin;
CREATE VIEW data_warehouse_v2.raw_fitbit__temperature_skin_current AS
SELECT * FROM (SELECT DISTINCT ON (source_id) * FROM data_warehouse_v2.raw_fitbit__temperature_skin ORDER BY source_id, revision DESC) t
WHERE deleted = false AND purged = false;

-- ===== Tanita Health Planet ===================================================

CREATE TABLE data_warehouse_v2.raw_tanita_health_planet__blood_pressure (
    source_id TEXT NOT NULL, revision INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL,
    content_hash TEXT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT false,
    purged BOOLEAN NOT NULL DEFAULT false, api_version TEXT,
    PRIMARY KEY (source_id, revision)
);
CREATE UNIQUE INDEX raw_tanita_hp__blood_pressure_purge_unique
    ON data_warehouse_v2.raw_tanita_health_planet__blood_pressure (source_id) WHERE purged = true;
CREATE INDEX raw_tanita_hp__blood_pressure_source_revision_desc
    ON data_warehouse_v2.raw_tanita_health_planet__blood_pressure (source_id, revision DESC);
INSERT INTO data_warehouse_v2.raw_tanita_health_planet__blood_pressure
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT source_id, 1, synced_at, data, md5((data - 'at')::text), false, false, api_version
FROM data_warehouse.raw_tanita_health_planet__blood_pressure;
CREATE VIEW data_warehouse_v2.raw_tanita_health_planet__blood_pressure_current AS
SELECT * FROM (SELECT DISTINCT ON (source_id) * FROM data_warehouse_v2.raw_tanita_health_planet__blood_pressure ORDER BY source_id, revision DESC) t
WHERE deleted = false AND purged = false;

CREATE TABLE data_warehouse_v2.raw_tanita_health_planet__body_composition (
    source_id TEXT NOT NULL, revision INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL,
    content_hash TEXT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT false,
    purged BOOLEAN NOT NULL DEFAULT false, api_version TEXT,
    PRIMARY KEY (source_id, revision)
);
CREATE UNIQUE INDEX raw_tanita_hp__body_composition_purge_unique
    ON data_warehouse_v2.raw_tanita_health_planet__body_composition (source_id) WHERE purged = true;
CREATE INDEX raw_tanita_hp__body_composition_source_revision_desc
    ON data_warehouse_v2.raw_tanita_health_planet__body_composition (source_id, revision DESC);
INSERT INTO data_warehouse_v2.raw_tanita_health_planet__body_composition
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT source_id, 1, synced_at, data, md5((data - 'at')::text), false, false, api_version
FROM data_warehouse.raw_tanita_health_planet__body_composition;
CREATE VIEW data_warehouse_v2.raw_tanita_health_planet__body_composition_current AS
SELECT * FROM (SELECT DISTINCT ON (source_id) * FROM data_warehouse_v2.raw_tanita_health_planet__body_composition ORDER BY source_id, revision DESC) t
WHERE deleted = false AND purged = false;

-- ===== Zaim ===================================================================

CREATE TABLE data_warehouse_v2.raw_zaim__money (
    source_id TEXT NOT NULL, revision INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL,
    content_hash TEXT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT false,
    purged BOOLEAN NOT NULL DEFAULT false, api_version TEXT,
    PRIMARY KEY (source_id, revision)
);
CREATE UNIQUE INDEX raw_zaim__money_purge_unique
    ON data_warehouse_v2.raw_zaim__money (source_id) WHERE purged = true;
CREATE INDEX raw_zaim__money_source_revision_desc
    ON data_warehouse_v2.raw_zaim__money (source_id, revision DESC);
INSERT INTO data_warehouse_v2.raw_zaim__money
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT source_id, 1, synced_at, data, md5((data - 'at')::text), false, false, api_version
FROM data_warehouse.raw_zaim__money;
CREATE VIEW data_warehouse_v2.raw_zaim__money_current AS
SELECT * FROM (SELECT DISTINCT ON (source_id) * FROM data_warehouse_v2.raw_zaim__money ORDER BY source_id, revision DESC) t
WHERE deleted = false AND purged = false;

CREATE TABLE data_warehouse_v2.raw_zaim__category (
    source_id TEXT NOT NULL, revision INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL,
    content_hash TEXT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT false,
    purged BOOLEAN NOT NULL DEFAULT false, api_version TEXT,
    PRIMARY KEY (source_id, revision)
);
CREATE UNIQUE INDEX raw_zaim__category_purge_unique
    ON data_warehouse_v2.raw_zaim__category (source_id) WHERE purged = true;
CREATE INDEX raw_zaim__category_source_revision_desc
    ON data_warehouse_v2.raw_zaim__category (source_id, revision DESC);
INSERT INTO data_warehouse_v2.raw_zaim__category
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT source_id, 1, synced_at, data, md5((data - 'at')::text), false, false, api_version
FROM data_warehouse.raw_zaim__category;
CREATE VIEW data_warehouse_v2.raw_zaim__category_current AS
SELECT * FROM (SELECT DISTINCT ON (source_id) * FROM data_warehouse_v2.raw_zaim__category ORDER BY source_id, revision DESC) t
WHERE deleted = false AND purged = false;

CREATE TABLE data_warehouse_v2.raw_zaim__genre (
    source_id TEXT NOT NULL, revision INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL,
    content_hash TEXT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT false,
    purged BOOLEAN NOT NULL DEFAULT false, api_version TEXT,
    PRIMARY KEY (source_id, revision)
);
CREATE UNIQUE INDEX raw_zaim__genre_purge_unique
    ON data_warehouse_v2.raw_zaim__genre (source_id) WHERE purged = true;
CREATE INDEX raw_zaim__genre_source_revision_desc
    ON data_warehouse_v2.raw_zaim__genre (source_id, revision DESC);
INSERT INTO data_warehouse_v2.raw_zaim__genre
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT source_id, 1, synced_at, data, md5((data - 'at')::text), false, false, api_version
FROM data_warehouse.raw_zaim__genre;
CREATE VIEW data_warehouse_v2.raw_zaim__genre_current AS
SELECT * FROM (SELECT DISTINCT ON (source_id) * FROM data_warehouse_v2.raw_zaim__genre ORDER BY source_id, revision DESC) t
WHERE deleted = false AND purged = false;

CREATE TABLE data_warehouse_v2.raw_zaim__account (
    source_id TEXT NOT NULL, revision INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL,
    content_hash TEXT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT false,
    purged BOOLEAN NOT NULL DEFAULT false, api_version TEXT,
    PRIMARY KEY (source_id, revision)
);
CREATE UNIQUE INDEX raw_zaim__account_purge_unique
    ON data_warehouse_v2.raw_zaim__account (source_id) WHERE purged = true;
CREATE INDEX raw_zaim__account_source_revision_desc
    ON data_warehouse_v2.raw_zaim__account (source_id, revision DESC);
INSERT INTO data_warehouse_v2.raw_zaim__account
    (source_id, revision, created_at, data, content_hash, deleted, purged, api_version)
SELECT source_id, 1, synced_at, data, md5((data - 'at')::text), false, false, api_version
FROM data_warehouse.raw_zaim__account;
CREATE VIEW data_warehouse_v2.raw_zaim__account_current AS
SELECT * FROM (SELECT DISTINCT ON (source_id) * FROM data_warehouse_v2.raw_zaim__account ORDER BY source_id, revision DESC) t
WHERE deleted = false AND purged = false;

COMMIT;
