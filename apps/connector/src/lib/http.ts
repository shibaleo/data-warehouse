interface HttpOptions {
  method?: GoogleAppsScript.URL_Fetch.HttpMethod;
  headers?: Record<string, string>;
  payload?: string;
  contentType?: string;
  muteHttpExceptions?: boolean;
}

function httpFetch(url: string, options: HttpOptions = {}): GoogleAppsScript.URL_Fetch.HTTPResponse {
  const fetchOptions: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: options.method || 'get',
    headers: options.headers || {},
    muteHttpExceptions: options.muteHttpExceptions ?? true,
  };

  if (options.payload) {
    fetchOptions.payload = options.payload;
  }
  if (options.contentType) {
    fetchOptions.contentType = options.contentType;
  }

  const response = UrlFetchApp.fetch(url, fetchOptions);
  const code = response.getResponseCode();

  if (code === 429) {
    const retryAfter = parseInt(response.getHeaders()['Retry-After'] || '1', 10);
    log(`Rate limited. Waiting ${retryAfter}s...`);
    Utilities.sleep(retryAfter * 1000);
    return UrlFetchApp.fetch(url, fetchOptions);
  }

  if (code >= 500) {
    log(`Server error ${code}. Retrying once...`);
    Utilities.sleep(1000);
    return UrlFetchApp.fetch(url, fetchOptions);
  }

  if (code >= 400) {
    throw new Error(`HTTP ${code}: ${response.getContentText().substring(0, 500)}`);
  }

  return response;
}
