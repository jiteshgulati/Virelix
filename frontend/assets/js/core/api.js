// Fetch wrapper: JSON in/out, CSRF header on state-changing requests, typed errors.
export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = extra.fields || {};
    this.extra = extra;
  }
}

const listeners = new Set();
export const onUnauthenticated = (fn) => listeners.add(fn);

function csrfToken() {
  const m = document.cookie.match(/(?:^|;\s*)vx_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function ensureCsrf() {
  if (!csrfToken()) await fetch("/api/health", { credentials: "same-origin" });
}

const forbiddenListeners = new Set();
export const onForbidden = (fn) => forbiddenListeners.add(fn);

export async function api(path, { method = "GET", body, file, filename, signal, quiet401 = false, headers: extra = {} } = {}) {
  const headers = { Accept: "application/json", ...extra };
  const init = { method, headers, credentials: "same-origin", signal };
  if (method !== "GET" && method !== "HEAD") {
    await ensureCsrf();
    headers["X-CSRF-Token"] = csrfToken();
  }
  if (file) {
    headers["Content-Type"] = "text/plain";
    headers["X-Filename"] = encodeURIComponent(filename || file.name || "document.txt");
    init.body = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let resp;
  try {
    resp = await fetch(path, init);
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiError(0, "network_error", "Can't reach the Virelix server. Check that it is running and try again.");
  }
  let data = null;
  const text = await resp.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!resp.ok) {
    const e = data?.error || {};
    const { code, message, ...extra } = e;
    const error = new ApiError(resp.status, code || "http_error", message || `Request failed (${resp.status}).`, extra);
    if (resp.status === 401 && !quiet401) listeners.forEach((fn) => fn(error));
    if (resp.status === 403 && error.code === "forbidden") forbiddenListeners.forEach((fn) => fn(error));
    throw error;
  }
  return data;
}

export const get = (p, o) => api(p, o);
export const post = (p, body, o = {}) => api(p, { ...o, method: "POST", body: body ?? {} });
export const patch = (p, body, o = {}) => api(p, { ...o, method: "PATCH", body });
export const del = (p, o = {}) => api(p, { ...o, method: "DELETE" });
export const upload = (p, file, o = {}) => api(p, { ...o, method: "POST", file });

export function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
    sp.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
