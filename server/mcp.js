// ── Connecteur MCP (lecture seule) ────────────────────────────────────────
// Permet à Claude (claude.ai, appli, mobile, Claude Code) de lire le planning.
// Chacun l'ajoute comme « connecteur personnalisé » avec l'adresse :
//   https://planning.racines-perspectives.fr/mcp/<MCP_KEY>
// La clé dans l'adresse sert de secret (claude.ai n'envoie pas d'en-tête perso).
//
// Implémentation minimale du transport « Streamable HTTP » en mode sans état :
// chaque POST porte un message JSON-RPC et reçoit une réponse JSON.
import crypto from "node:crypto";
import * as store from "./db.js";

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const WHO = { "": "personne", francois: "François", guillaume: "Guillaume", both: "François et Guillaume" };

const todayParis = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const addDays = (iso, n) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fr = (iso) => {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function status(t, today) {
  if (t.done) return "terminé";
  if (t.end < today) return "en retard (non coché terminé)";
  if (t.start <= today) return "en cours";
  return "à venir";
}

function line(t, today) {
  const when = t.kind === "milestone" || t.start === t.end
    ? fr(t.start)
    : `${fr(t.start)} → ${fr(t.end)}`;
  const kind = t.kind === "milestone" ? "◆ jalon" : "tâche";
  let s = `- [${kind}] ${t.title || "(sans titre)"} — ${when}${t.time ? " à " + t.time : ""} — ${WHO[t.assignee] ?? t.assignee} — ${status(t, today)}`;
  if (t.validation_days && t.kind !== "milestone") s += ` — puis ${t.validation_days} j de validation client`;
  if (t.lead_days && !t.done) s += ` — à caler (${t.lead_days} j avant)`;
  if (t.after_id && t._pred) s += ` — suit « ${t._pred} »`;
  if (t.note) s += `\n    note : ${t.note.replace(/\n/g, "\n    ")}`;
  return s;
}

function matchAssignee(t, who) {
  if (!who) return true;
  return t.assignee === who || t.assignee === "both";
}

// ── Outils ───────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "planning_projets",
    title: "Planning complet par projet",
    description:
      "Planning de l'agence Racines & Perspectives (François et Guillaume) : chaque projet avec ses phases (APS, APD, PC…) et jalons, dates, qui s'en occupe, état et notes. Filtre optionnel sur un projet (recherche dans le nom).",
    inputSchema: {
      type: "object",
      properties: {
        projet: { type: "string", description: "Partie du nom du projet (facultatif)." },
        inclure_archives: { type: "boolean", description: "Inclure les projets archivés (défaut : non)." },
        inclure_terminees: { type: "boolean", description: "Inclure les tâches terminées (défaut : oui)." },
      },
    },
    annotations: { readOnlyHint: true },
    run({ projet, inclure_archives = false, inclure_terminees = true }) {
      const today = todayParis();
      const { projects, tasks } = store.getState();
      const q = norm(projet);
      const list = projects.filter((p) => (inclure_archives || !p.archived) && (!q || norm(p.name).includes(q)));
      if (!list.length) return projet ? `Aucun projet ne correspond à « ${projet} ».` : "Aucun projet.";
      const out = [`Aujourd'hui : ${fr(today)}.`, ""];
      for (const p of list) {
        const byId = new Map(tasks.map((t) => [t.id, t]));
        const ts = tasks
          .filter((t) => t.project_id === p.id && (inclure_terminees || !t.done))
          .map((t) => ({ ...t, _pred: byId.get(t.after_id)?.title }))
          .sort((a, b) => a.start.localeCompare(b.start));
        out.push(`## ${p.name}${p.archived ? " (archivé)" : ""}${p.status === "prospect" ? " — PROSPECT (non signé)" : ""}`);
        if (p.status === "prospect") {
          out.push(`Proposition envoyée le ${p.proposal_date ? fr(p.proposal_date) : "?"} ; relancer le ${p.followup_date ? fr(p.followup_date) : "(pas de date)"}`);
        }
        if (p.note) out.push(`Note : ${p.note}`);
        if (ts.length) {
          out.push(`Période : ${fr(ts[0].start)} → ${fr(ts.reduce((m, t) => (t.end > m ? t.end : m), ts[0].end))}`);
          out.push(...ts.map((t) => line(t, today)));
        } else out.push("(aucune tâche)");
        out.push("");
      }
      return out.join("\n");
    },
  },
  {
    name: "planning_a_venir",
    title: "Ce qui est en cours et à venir",
    description:
      "Tâches en cours, jalons et tâches qui démarrent dans les N prochains jours (défaut 30), plus les tâches en retard, triés par date. Filtre optionnel par personne.",
    inputSchema: {
      type: "object",
      properties: {
        jours: { type: "integer", minimum: 1, maximum: 365, description: "Horizon en jours (défaut 30)." },
        personne: { type: "string", enum: ["francois", "guillaume"], description: "Filtrer sur une personne (facultatif)." },
      },
    },
    annotations: { readOnlyHint: true },
    run({ jours = 30, personne }) {
      const today = todayParis();
      const horizon = addDays(today, Math.min(365, Math.max(1, Number(jours) || 30)));
      const { projects, tasks } = store.getState();
      const proj = new Map(projects.filter((p) => !p.archived).map((p) => [p.id, p]));
      const ts = tasks.filter((t) => proj.has(t.project_id) && !t.done && matchAssignee(t, personne));
      const late = ts.filter((t) => t.end < today);
      const now = ts.filter((t) => t.start <= today && t.end >= today);
      const next = ts.filter((t) => t.start > today && t.start <= horizon);
      const fmt = (arr) => arr
        .sort((a, b) => a.start.localeCompare(b.start))
        .map((t) => `${line(t, today)} — projet : ${proj.get(t.project_id).name}`);
      const who = personne ? ` pour ${WHO[personne]}` : "";
      const relances = projects
        .filter((p) => !p.archived && p.status === "prospect" && p.followup_date && p.followup_date <= horizon)
        .sort((a, b) => a.followup_date.localeCompare(b.followup_date))
        .map((p) => `- ${p.name} : relancer le ${fr(p.followup_date)}${p.followup_date <= today ? " (à faire !)" : ""}${p.note ? " — " + p.note : ""}`);
      const { closures = [] } = store.getState();
      const fermetures = closures.filter((c) => c.end >= today && c.start <= horizon)
        .map((c) => `- ${c.label || "Fermeture"} : du ${fr(c.start)} au ${fr(c.end)}`);
      return [
        `Aujourd'hui : ${fr(today)}. Horizon : jusqu'au ${fr(horizon)}${who}.`,
        ...(relances.length ? ["", "## Relances prospects", ...relances] : []),
        ...(fermetures.length ? ["", "## Fermetures de l'agence", ...fermetures] : []),
        "", "## En retard", ...(late.length ? fmt(late) : ["(rien)"]),
        "", "## En cours", ...(now.length ? fmt(now) : ["(rien)"]),
        "", "## À venir", ...(next.length ? fmt(next) : ["(rien)"]),
      ].join("\n");
    },
  },
  {
    name: "planning_charge",
    title: "Charge par semaine",
    description:
      "Charge de travail semaine par semaine sur les N prochaines semaines (défaut 12) : pour chaque semaine, les tâches actives de François et de Guillaume.",
    inputSchema: {
      type: "object",
      properties: { semaines: { type: "integer", minimum: 1, maximum: 52, description: "Nombre de semaines (défaut 12)." } },
    },
    annotations: { readOnlyHint: true },
    run({ semaines = 12 }) {
      const today = todayParis();
      const n = Math.min(52, Math.max(1, Number(semaines) || 12));
      const dow = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7; // 0 = lundi
      let monday = addDays(today, -dow);
      const { projects, tasks } = store.getState();
      const proj = new Map(projects.filter((p) => !p.archived).map((p) => [p.id, p]));
      const ts = tasks.filter((t) => proj.has(t.project_id) && !t.done && t.kind !== "milestone");
      const out = [`Aujourd'hui : ${fr(today)}.`, ""];
      for (let i = 0; i < n; i++, monday = addDays(monday, 7)) {
        const friday = addDays(monday, 4);
        const active = ts.filter((t) => t.start <= friday && t.end >= monday);
        out.push(`## Semaine du ${fr(monday)}`);
        for (const who of ["francois", "guillaume"]) {
          const mine = active.filter((t) => matchAssignee(t, who));
          out.push(`- ${WHO[who]} (${mine.length}) : ${mine.map((t) => `${proj.get(t.project_id).name} / ${t.title || "(sans titre)"}`).join(" ; ") || "—"}`);
        }
        const nobody = active.filter((t) => !t.assignee);
        if (nobody.length) out.push(`- Non assigné : ${nobody.map((t) => `${proj.get(t.project_id).name} / ${t.title}`).join(" ; ")}`);
        out.push("");
      }
      return out.join("\n");
    },
  },
];

// ── JSON-RPC ─────────────────────────────────────────────────────────────
function handleMessage(msg) {
  const { id, method, params = {} } = msg || {};
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const err = (code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== "2.0" || typeof method !== "string") return err(-32600, "Requête invalide.");
  if (id === undefined) return null; // notification : pas de réponse

  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "rp-planning", title: "R&P Planning", version: "1.0.0" },
        instructions:
          "Planning partagé de l'agence d'architecture Racines & Perspectives (François et Guillaume), prospects non signés compris. Lecture seule. Utilise planning_a_venir pour « qu'est-ce qui arrive », planning_projets pour le détail d'un projet, planning_charge pour la charge par semaine.",
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS.map(({ run, ...t }) => t) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return err(-32602, `Outil inconnu : ${params.name}`);
      try {
        return ok({ content: [{ type: "text", text: tool.run(params.arguments || {}) }] });
      } catch (e) {
        console.error("MCP", e);
        return ok({ content: [{ type: "text", text: "Erreur en lisant le planning." }], isError: true });
      }
    }
    default:
      return err(-32601, `Méthode inconnue : ${method}`);
  }
}

export function mountMcp(app) {
  const KEY = process.env.MCP_KEY || "";
  if (!KEY) { console.log("MCP désactivé (MCP_KEY vide)."); return; }
  const kb = Buffer.from(KEY);
  const valid = (k) => { const b = Buffer.from(String(k)); return b.length === kb.length && crypto.timingSafeEqual(b, kb); };

  app.all("/mcp/:key", (req, res) => {
    if (!valid(req.params.key)) return res.status(404).json({ error: "Introuvable." });
    if (req.method !== "POST") return res.status(405).set("Allow", "POST").end();
    const body = req.body;
    const msgs = Array.isArray(body) ? body : [body];
    const replies = msgs.map(handleMessage).filter(Boolean);
    if (!replies.length) return res.status(202).end();
    res.json(Array.isArray(body) ? replies : replies[0]);
  });
}
