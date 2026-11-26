// ── OAuth minimal pour le connecteur MCP ──────────────────────────────────
// Le bouton « Connecter » de claude.ai passe toujours par OAuth (découverte,
// inscription dynamique, autorisation, jeton). On fournit donc ce parcours,
// approuvé automatiquement : le vrai secret reste la clé dans l'URL du
// connecteur (/mcp/<MCP_KEY>), et le jeton obtenu n'ouvre rien d'autre.
//
// Rien n'est stocké durablement : les codes d'autorisation vivent 5 min en
// mémoire, les jetons ne sont pas vérifiés par /mcp (la clé suffit).
import crypto from "node:crypto";
import express from "express";

const rand = (n = 32) => crypto.randomBytes(n).toString("base64url");
const codes = new Map(); // code -> { challenge, redirect, exp }

// Seules les adresses de retour de Claude sont acceptées (pas de redirection
// ouverte vers n'importe quel site).
const ALLOWED_REDIRECT = /^https:\/\/([a-z0-9-]+\.)*(claude\.ai|claude\.com|anthropic\.com)(\/|$)/i;

export function mountOAuth(app) {
  const KEY = process.env.MCP_KEY || "";
  if (!KEY) return;

  const base = (req) => `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
  const asMeta = (req) => {
    const b = base(req);
    return {
      issuer: b,
      authorization_endpoint: `${b}/authorize`,
      token_endpoint: `${b}/token`,
      registration_endpoint: `${b}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["planning"],
    };
  };
  const keyOk = (k) => {
    const a = Buffer.from(String(k)), b = Buffer.from(KEY);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  // Métadonnées de la ressource protégée : seulement pour la bonne clé.
  app.get("/.well-known/oauth-protected-resource/mcp/:key", (req, res) => {
    if (!keyOk(req.params.key)) return res.status(404).json({ error: "Introuvable." });
    res.json({
      resource: `${base(req)}/mcp/${req.params.key}`,
      authorization_servers: [base(req)],
      scopes_supported: ["planning"],
      bearer_methods_supported: ["header"],
    });
  });
  // Métadonnées du serveur d'autorisation (à la racine, ou suffixées).
  app.get(["/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/*",
    "/.well-known/openid-configuration"], (req, res) => res.json(asMeta(req)));

  // Inscription dynamique d'un client (RFC 7591) : acceptée telle quelle.
  app.post("/register", express.json({ limit: "32kb" }), (req, res) => {
    const body = req.body || {};
    const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u) => ALLOWED_REDIRECT.test(u)) : [];
    if (!uris.length) return res.status(400).json({ error: "invalid_redirect_uri" });
    res.status(201).json({
      client_id: "claude-" + rand(12),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: String(body.client_name || "Claude").slice(0, 100),
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  // Autorisation : approuvée tout de suite, retour vers Claude avec un code.
  app.get("/authorize", (req, res) => {
    const { redirect_uri, state, code_challenge, code_challenge_method, response_type } = req.query;
    if (!redirect_uri || !ALLOWED_REDIRECT.test(String(redirect_uri))) {
      return res.status(400).json({ error: "invalid_request", error_description: "redirect_uri refusée" });
    }
    const back = new URL(String(redirect_uri));
    if (response_type && response_type !== "code") {
      back.searchParams.set("error", "unsupported_response_type");
    } else if (!code_challenge || (code_challenge_method && code_challenge_method !== "S256")) {
      back.searchParams.set("error", "invalid_request");
    } else {
      const code = rand();
      codes.set(code, { challenge: String(code_challenge), redirect: String(redirect_uri), exp: Date.now() + 5 * 60 * 1000 });
      back.searchParams.set("code", code);
    }
    if (state) back.searchParams.set("state", String(state));
    res.redirect(302, back.toString());
  });

  // Jeton : échange du code (PKCE vérifié) ou rafraîchissement.
  app.post("/token", express.urlencoded({ extended: false }), express.json(), (req, res) => {
    const b = req.body || {};
    const tokens = () => res.set("Cache-Control", "no-store").json({
      access_token: rand(), token_type: "Bearer", expires_in: 365 * 24 * 3600, refresh_token: rand(), scope: "planning",
    });
    if (b.grant_type === "refresh_token") return tokens();
    if (b.grant_type !== "authorization_code") return res.status(400).json({ error: "unsupported_grant_type" });
    const entry = codes.get(String(b.code));
    codes.delete(String(b.code));
    if (!entry || entry.exp < Date.now()) return res.status(400).json({ error: "invalid_grant" });
    if (b.redirect_uri && b.redirect_uri !== entry.redirect) return res.status(400).json({ error: "invalid_grant" });
    const hash = crypto.createHash("sha256").update(String(b.code_verifier || "")).digest("base64url");
    if (hash !== entry.challenge) return res.status(400).json({ error: "invalid_grant", error_description: "PKCE" });
    tokens();
  });

  // Ménage des codes expirés.
  setInterval(() => { const now = Date.now(); for (const [c, e] of codes) if (e.exp < now) codes.delete(c); }, 60 * 1000).unref();
}
