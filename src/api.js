// ── Client API ───────────────────────────────────────────────────────────
// Tout passe par /api (proxié vers Express en dev, servi par Express en prod).
// Le mot de passe est stocké en localStorage et envoyé en Bearer.

const TOKEN_KEY = "rp-planning:token";

const safeLS = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};
export { safeLS };

export const getToken = () => safeLS.get(TOKEN_KEY) || "";
export const setToken = (t) => safeLS.set(TOKEN_KEY, t);
export const clearToken = () => safeLS.del(TOKEN_KEY);

// Erreur levée sur 401 pour redemander le mot de passe.
export class AuthError extends Error {}

async function req(method, url, body) {
  const opts = { method, headers: {} };
  const t = getToken();
  if (t) opts.headers.Authorization = `Bearer ${t}`;
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url, opts);
  if (r.status === 401) throw new AuthError("Mot de passe requis ou invalide.");
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Erreur ${r.status}`);
  return data;
}

export const api = {
  config: () => fetch("/api/config").then((r) => r.json()),

  // Vérifie un mot de passe : renvoie true / false, ou lève sur 429.
  async checkPassword(pw) {
    const r = await fetch("/api/state?rev=-1", { headers: { Authorization: `Bearer ${pw}` } });
    if (r.status === 429) throw new Error((await r.json()).error);
    return r.ok;
  },

  state: (rev) => req("GET", rev === undefined ? "/api/state" : `/api/state?rev=${rev}`),
  createProject: (p) => req("POST", "/api/projects", p),
  updateProject: (id, patch) => req("PATCH", `/api/projects/${id}`, patch),
  deleteProject: (id) => req("DELETE", `/api/projects/${id}`),
  createTask: (t) => req("POST", "/api/tasks", t),
  updateTask: (id, patch) => req("PATCH", `/api/tasks/${id}`, patch),
  deleteTask: (id) => req("DELETE", `/api/tasks/${id}`),
};
