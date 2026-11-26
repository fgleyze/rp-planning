import "dotenv/config";
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as store from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = process.env.PORT || 3002;
const HOST = process.env.HOST || "127.0.0.1";
const PROD = process.env.NODE_ENV === "production";

const app = express();
app.use(express.json({ limit: "256kb" }));

// ── Auth : mot de passe partagé ──────────────────────────────────────────
// Si APP_PASSWORD est défini, toute requête /api exige `Authorization: Bearer <mdp>`.
// Le mot de passe sert directement de jeton (comparaison à temps constant).
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const safeEqual = (a, b) => {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

// Anti-force brute minimal : 20 échecs / 15 min par IP, puis 429.
const failures = new Map(); // ip -> { n, until }
const clientIp = (req) => req.headers["x-real-ip"] || req.socket.remoteAddress;

function auth(req, res, next) {
  if (!APP_PASSWORD) return next();
  const ip = clientIp(req);
  const f = failures.get(ip);
  if (f && f.n >= 20 && f.until > Date.now()) {
    return res.status(429).json({ error: "Trop de tentatives, réessaie dans quelques minutes." });
  }
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (token && safeEqual(token, APP_PASSWORD)) return next();
  if (token) {
    const cur = f && f.until > Date.now() ? f : { n: 0 };
    failures.set(ip, { n: cur.n + 1, until: Date.now() + 15 * 60 * 1000 });
  }
  res.status(401).json({ error: "Mot de passe requis ou invalide." });
}

// Indique au front si un mot de passe est exigé (route publique).
app.get("/api/config", (req, res) => res.json({ authRequired: !!APP_PASSWORD }));

app.use("/api", auth);

// Enveloppe : erreurs de validation → 400, le reste → 500.
const handle = (fn) => (req, res) => {
  try {
    res.json(fn(req));
  } catch (e) {
    if (e instanceof store.ValidationError) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── État complet (le planning tient largement en une requête) ─────────────
// ?rev=N : si rien n'a changé depuis N, on renvoie juste { rev } (polling léger).
app.get("/api/state", (req, res) => {
  const rev = store.getRev();
  if (req.query.rev !== undefined && Number(req.query.rev) === rev) return res.json({ rev });
  res.json(store.getState());
});

// ── Projets ──────────────────────────────────────────────────────────────
app.post("/api/projects", handle((req) => store.createProject(req.body || {})));
app.patch("/api/projects/:id", handle((req) => store.updateProject(req.params.id, req.body || {})));
app.delete("/api/projects/:id", handle((req) => store.deleteProject(req.params.id)));

// ── Tâches ───────────────────────────────────────────────────────────────
app.post("/api/tasks", handle((req) => store.createTask(req.body || {})));
app.patch("/api/tasks/:id", handle((req) => store.updateTask(req.params.id, req.body || {})));
app.delete("/api/tasks/:id", handle((req) => store.deleteTask(req.params.id)));

app.use("/api", (req, res) => res.status(404).json({ error: "Route inconnue." }));

// ── Front (prod) ─────────────────────────────────────────────────────────
if (PROD) {
  const dist = path.join(ROOT, "dist");
  app.use(express.static(dist, { index: false, maxAge: "1y", immutable: true }));
  app.get("*", (req, res) => {
    res.set("Cache-Control", "no-cache");
    res.sendFile(path.join(dist, "index.html"));
  });
}

// Sauvegarde au démarrage puis toutes les 6 h (une par jour, 30 conservées).
const runBackup = () => store.backup().catch((e) => console.error("Sauvegarde :", e));
runBackup();
setInterval(runBackup, 6 * 60 * 60 * 1000);

app.listen(PORT, HOST, () => {
  console.log(`R&P Planning — http://${HOST}:${PORT} (${PROD ? "prod" : "dev"})`);
});
