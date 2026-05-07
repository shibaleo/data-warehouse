// Shared datetime helpers for connectors.
//
// Many upstream APIs (Fitbit, Zaim) return naive ISO datetime strings
// reflecting an account-side timezone setting without an explicit offset.
// Storing those naive into raw lets PostgreSQL ::timestamptz misinterpret
// them as UTC. CLAUDE.md "時間データの必須ルール" requires the connector
// to complete the ISO 8601 string before storage; this is the helper.

const JST_OFFSET = '+09:00';

/**
 * Complete a naive ISO 8601 datetime by appending the JST timezone offset.
 * Returns null/empty inputs unchanged. Already-offset strings are passed
 * through (idempotent), so callers can safely apply this without a guard.
 *
 * Asia/Tokyo never observes DST, so a fixed +09:00 is correct year-round.
 * If a future user moves zones, fetch their tz from the source API and
 * pass it in via a generalised version of this function.
 */
function withTokyoOffset(naive: string | null | undefined): string | null {
  if (naive == null || naive === '') return null;
  if (/(?:Z|[+\-]\d{2}:\d{2})$/.test(naive)) return naive;
  return naive + JST_OFFSET;
}
