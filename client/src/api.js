/**
 * api.js — Centralized API client.
 * - Injects Bearer token from localStorage
 * - Normalizes error envelope
 * - 401 → logout
 * - Retries once on 5xx
 */

const BASE = import.meta.env.VITE_API_URL || '/api';

function getToken() {
  return localStorage.getItem('token');
}

class ApiError extends Error {
  constructor(code, message, status, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function request(path, options = {}, retry = true) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${BASE}${path}`, { ...options, headers });
  } catch (networkErr) {
    throw new ApiError('NETWORK_ERROR', 'Network request failed. Check your connection.', 0);
  }

  // Retry once on 5xx
  if (res.status >= 500 && retry) {
    await new Promise(r => setTimeout(r, 1000));
    return request(path, options, false);
  }

  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.dispatchEvent(new Event('auth:logout'));
  }

  if (!res.ok) {
    let body;
    try { body = await res.json(); } catch { body = {}; }
    const err = body?.error || {};
    throw new ApiError(err.code || 'API_ERROR', err.message || `Request failed (${res.status})`, res.status, err.details);
  }

  if (res.status === 204) return null;
  return res.json();
}

const api = {
  get:    (path)         => request(path, { method: 'GET' }),
  post:   (path, body)   => request(path, { method: 'POST',   body: JSON.stringify(body) }),
  put:    (path, body)   => request(path, { method: 'PUT',    body: JSON.stringify(body) }),
  patch:  (path, body)   => request(path, { method: 'PATCH',  body: JSON.stringify(body) }),
  delete: (path)         => request(path, { method: 'DELETE' }),
};

export default api;
export { ApiError };
