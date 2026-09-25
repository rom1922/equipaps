import { createSignal, createEffect } from "solid-js";

// Session admin (bureau). Remplace la saisie du mot de passe à chaque action :
// on se connecte une fois (login -> JWT { admin: true }), le jeton vit en
// localStorage et accompagne les appels d'administration.

const stored = (() => { try { return localStorage.getItem("adminToken") || ""; } catch { return ""; } })();
export const [adminToken, setAdminToken] = createSignal(stored);

createEffect(() => {
  try {
    const t = adminToken();
    if (t) localStorage.setItem("adminToken", t);
    else localStorage.removeItem("adminToken");
  } catch (_) { /* localStorage indisponible : la session reste en mémoire */ }
});

export const isAdmin = () => !!adminToken();

export async function sha256hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text || ""));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function adminLogin(password) {
  const hash = await sha256hex(password);
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hash }),
  });
  const j = await res.json().catch(() => ({}));
  if (res.ok && j.token) { setAdminToken(j.token); return true; }
  return false;
}

export function adminLogout() { setAdminToken(""); }

// En-têtes des appels d'administration protégés (avec le jeton de session).
export function adminHeaders(extra = {}) {
  return adminToken() ? { ...extra, authorization: adminToken() } : { ...extra };
}

// fetch admin : porte le jeton et PURGE la session si elle a expiré côté
// serveur (401) — la pastille disparaît au lieu de laisser croire à une
// session valide. Pour un upload multipart, ne pas mettre de Content-Type.
export async function adminFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: adminHeaders(opts.headers || {}) });
  if (res.status === 401) setAdminToken("");
  return res;
}
