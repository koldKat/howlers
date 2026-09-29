(function startHowlersRequests(root) {
  const tokenKey = root.HowlersDomain?.storage?.tokenKey;
  let token = '';
  try {
    token = tokenKey ? localStorage.getItem(tokenKey) || '' : '';
  } catch {
    // Storage restrictions fall back to the public feed.
  }

  function capture(promise) {
    return promise.then(data => ({ ok: true, data }), error => ({ ok: false, error }));
  }

  async function jsonRequest(url, headers = {}) {
    const response = await fetch(url, { headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Заявката е неуспешна.');
    return data;
  }

  root.HowlersStartup = {
    authenticated: Boolean(token),
    consumed: false,
    localePromise: capture(jsonRequest('/locales/bg.json')),
    dataPromise: capture(token
      ? jsonRequest('/api/state', { Authorization: `Bearer ${token}` })
      : jsonRequest('/api/feed?offset=0')),
  };
})(globalThis);
