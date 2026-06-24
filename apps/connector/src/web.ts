// GAS Web App entry point for on-demand sync — see docs/006.
//
// Request shape (from CF Worker /api/v1/warehouse/sync proxy):
//   POST <web app /exec>
//   Content-Type: application/json
//   Body: { auth_token: "<clerk jwt>", target: "toggl" | ... }
//
// GAS Web Apps cannot set arbitrary HTTP status codes — every response is 200.
// The caller must check the `ok` boolean in the JSON body.

interface DoPostBody {
  auth_token?: string;
  target?: string;
}

type SyncTarget = 'toggl' | 'google_health' | 'notion' | 'zaim' | 'tanita';

const SYNC_TARGETS: readonly SyncTarget[] = [
  'toggl',
  'google_health',
  'notion',
  'zaim',
  'tanita',
];

function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  const start = Date.now();
  let body: DoPostBody;
  try {
    body = JSON.parse(e.postData.contents) as DoPostBody;
  } catch {
    return jsonResponse({ ok: false, error: 'invalid json body' });
  }

  const token = body.auth_token;
  const target = body.target;
  if (!token) return jsonResponse({ ok: false, error: 'missing auth_token' });
  if (!target || !SYNC_TARGETS.includes(target as SyncTarget)) {
    return jsonResponse({ ok: false, error: `unknown target: ${target}` });
  }

  let claims;
  try {
    claims = verifyClerkJwt(token);
  } catch (err) {
    return jsonResponse({ ok: false, error: `unauthorized: ${(err as Error).message}` });
  }

  // Mutex per-script: a second "sync now" while one is running gets 409-style
  // immediate rejection rather than queuing. tryLock(0) wouldn't compile-trigger
  // exactly that semantic; 1s is a safe lower bound.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    return jsonResponse({ ok: false, error: 'sync already in progress' });
  }
  try {
    log(`=== On-demand sync via doPost: target=${target} user=${claims.sub} ===`);
    dispatchSync(target as SyncTarget);
    const durationMs = Date.now() - start;
    log(`=== On-demand sync complete: target=${target} durationMs=${durationMs} ===`);
    return jsonResponse({ ok: true, target, durationMs, user: claims.sub });
  } catch (err) {
    log(`On-demand sync failed: target=${target} err=${(err as Error).message}`);
    return jsonResponse({
      ok: false,
      target,
      durationMs: Date.now() - start,
      error: (err as Error).message,
    });
  } finally {
    lock.releaseLock();
  }
}

function dispatchSync(target: SyncTarget): void {
  switch (target) {
    case 'toggl':
      syncTimeEntries({ days: 1 });
      return;
    case 'google_health':
      syncGoogleHealthAll(7);
      return;
    case 'notion':
      notionAllSync();
      return;
    case 'zaim':
      syncZaimAll(30);
      return;
    case 'tanita':
      syncTanitaAll(30);
      return;
  }
}

function jsonResponse(body: unknown): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
