const CONFIG_KEY = 'store_supabase_config';
const SESSION_KEY = 'store_supabase_session';

export function getCloudConfig() {
  const envUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const envKey = (
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    ''
  ).trim();
  if (envUrl && envKey) {
    return { url: envUrl, anonKey: envKey, source: 'env' };
  }
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { url: '', anonKey: '', source: 'none' };
    const parsed = JSON.parse(raw);
    const url = (parsed.url || '').trim().replace(/\/+$/, '');
    const anonKey = (parsed.anonKey || '').trim();
    return { url, anonKey, source: url && anonKey ? 'storage' : 'none' };
  } catch {
    return { url: '', anonKey: '', source: 'none' };
  }
}

export function saveCloudConfig(url, anonKey) {
  const cleanUrl = (url || '').trim().replace(/\/+$/, '');
  const cleanKey = (anonKey || '').trim();
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ url: cleanUrl, anonKey: cleanKey }));
  return getCloudConfig();
}

export function clearCloudConfig() {
  localStorage.removeItem(CONFIG_KEY);
  localStorage.removeItem(SESSION_KEY);
}

export function isCloudConfigured() {
  const cfg = getCloudConfig();
  return Boolean(cfg.url && cfg.anonKey);
}

function getStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  if (!session) {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
  const expiresAt =
    session.expires_at ||
    Math.floor(Date.now() / 1000) + (session.expires_in || 3600);
  const normalized = { ...session, expires_at: expiresAt };
  localStorage.setItem(SESSION_KEY, JSON.stringify(normalized));
  return normalized;
}

async function parseResponse(res) {
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!res.ok) {
    const msg =
      data?.error_description ||
      data?.msg ||
      data?.message ||
      data?.error ||
      `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function buildHeaders(extra = {}, accessToken = null) {
  const { anonKey } = getCloudConfig();
  const bearer = accessToken || (anonKey.startsWith('eyJ') ? anonKey : '');
  return {
    apikey: anonKey,
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    'Content-Type': 'application/json',
    ...extra,
  };
}

export async function cloudRefreshSession(force = false) {
  const { url } = getCloudConfig();
  const session = getStoredSession();
  if (!url || !session?.refresh_token) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (!force && session.expires_at && session.expires_at - nowSec > 60) {
    return session;
  }

  try {
    const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    const refreshed = await parseResponse(res);
    return saveSession(refreshed);
  } catch {
    saveSession(null);
    return null;
  }
}

export async function cloudGetSession() {
  const session = getStoredSession();
  if (!session) return null;
  return cloudRefreshSession(false);
}

export async function cloudSignIn(email, password) {
  const { url } = getCloudConfig();
  if (!url) throw new Error('ยังไม่ได้ตั้งค่า Supabase URL');
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({ email: email.trim(), password }),
  });
  const data = await parseResponse(res);
  return saveSession(data);
}

export async function cloudSignUp(email, password, displayName, role = 'staff') {
  const { url } = getCloudConfig();
  if (!url) throw new Error('ยังไม่ได้ตั้งค่า Supabase URL');
  const res = await fetch(`${url}/auth/v1/signup`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      email: email.trim(),
      password,
      data: {
        display_name: displayName?.trim() || email.split('@')[0],
        role,
      },
    }),
  });
  const data = await parseResponse(res);
  if (data?.access_token) {
    saveSession(data);
  }
  return data;
}

/**
 * Create a new staff/owner account using Supabase signup without overwriting
 * the currently logged-in owner's browser session.
 */
export async function cloudAdminInviteSignUp(email, password, displayName, role = 'staff') {
  const { url } = getCloudConfig();
  if (!url) throw new Error('ยังไม่ได้ตั้งค่า Supabase URL');
  const res = await fetch(`${url}/auth/v1/signup`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      email: email.trim(),
      password,
      data: {
        display_name: displayName?.trim() || email.split('@')[0],
        role,
      },
    }),
  });
  return parseResponse(res);
}

export async function cloudSignOut() {
  const { url } = getCloudConfig();
  const session = getStoredSession();
  if (url && session?.access_token) {
    try {
      await fetch(`${url}/auth/v1/logout`, {
        method: 'POST',
        headers: buildHeaders({}, session.access_token),
      });
    } catch {
      // Ignore network error during logout
    }
  }
  saveSession(null);
}

async function authorizedFetch(path, options = {}) {
  const { url } = getCloudConfig();
  if (!url) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase Cloud');
  const session = await cloudGetSession();
  const token = session?.access_token || null;

  const res = await fetch(`${url}${path}`, {
    ...options,
    headers: buildHeaders(options.headers || {}, token),
  });

  if (res.status === 401 && session?.refresh_token) {
    const refreshed = await cloudRefreshSession(true);
    if (refreshed?.access_token) {
      const retryRes = await fetch(`${url}${path}`, {
        ...options,
        headers: buildHeaders(options.headers || {}, refreshed.access_token),
      });
      return parseResponse(retryRes);
    }
  }
  return parseResponse(res);
}

function buildQuery(queryParams = {}) {
  const params = new URLSearchParams();
  Object.entries(queryParams).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    if (Array.isArray(v)) {
      v.forEach((item) => params.append(k, item));
    } else {
      params.append(k, String(v));
    }
  });
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function restGet(table, queryParams = {}) {
  return authorizedFetch(`/rest/v1/${table}${buildQuery(queryParams)}`, {
    method: 'GET',
  });
}

export async function restPost(table, body, extraHeaders = {}, queryParams = {}) {
  return authorizedFetch(`/rest/v1/${table}${buildQuery(queryParams)}`, {
    method: 'POST',
    headers: {
      Prefer: 'return=representation',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

export async function restPatch(table, queryParams = {}, body = {}, extraHeaders = {}) {
  return authorizedFetch(`/rest/v1/${table}${buildQuery(queryParams)}`, {
    method: 'PATCH',
    headers: {
      Prefer: 'return=representation',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

export async function restDelete(table, queryParams = {}) {
  return authorizedFetch(`/rest/v1/${table}${buildQuery(queryParams)}`, {
    method: 'DELETE',
    headers: {
      Prefer: 'return=representation',
    },
  });
}

export async function testCloudConnection(testUrl, testAnonKey) {
  const cleanUrl = (testUrl || '').trim().replace(/\/+$/, '');
  const cleanKey = (testAnonKey || '').trim();
  if (!cleanUrl || !cleanKey) throw new Error('กรุณากรอก URL และ Anon Key ให้ครบ');

  const headers = {
    apikey: cleanKey,
    ...(cleanKey.startsWith('eyJ') ? { Authorization: `Bearer ${cleanKey}` } : {}),
  };

  const res = await fetch(`${cleanUrl}/auth/v1/settings`, {
    method: 'GET',
    headers,
  });
  return parseResponse(res);
}
