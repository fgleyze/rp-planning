// ── Persistance SQLite : un seul fichier data/planning.db ─────────────────
// Deux tables (projets, tâches) + un compteur de révision global, incrémenté à
// chaque écriture : le front le compare pour savoir s'il doit se resynchroniser.
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, "..", "data");
export const BACKUP_DIR = path.join(DATA_DIR, "backups");
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "planning.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL,             -- #rrggbb
    position   REAL NOT NULL DEFAULT 0,   -- ordre d'affichage
    archived   INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT '',
    note       TEXT NOT NULL DEFAULT '',
    start_date TEXT NOT NULL,             -- YYYY-MM-DD
    end_date   TEXT NOT NULL,             -- YYYY-MM-DD, inclus
    assignee   TEXT NOT NULL DEFAULT '',  -- '' | francois | guillaume | both
    kind       TEXT NOT NULL DEFAULT 'task', -- task | milestone
    done       INTEGER NOT NULL DEFAULT 0,
    position   REAL NOT NULL DEFAULT 0,   -- ordre dans le projet
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id);
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  INSERT OR IGNORE INTO meta (key, value) VALUES ('rev', '0');
  CREATE TABLE IF NOT EXISTS closures (
    id         TEXT PRIMARY KEY,
    start_date TEXT NOT NULL,             -- YYYY-MM-DD
    end_date   TEXT NOT NULL,             -- YYYY-MM-DD, inclus
    label      TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );
`);

// ── Migrations : uniquement des AJOUTS de colonnes (jamais de perte) ──────
function addColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn("projects", "status", "TEXT NOT NULL DEFAULT 'signed'");   // signed | prospect
addColumn("projects", "proposal_date", "TEXT NOT NULL DEFAULT ''");  // proposition envoyée le
addColumn("projects", "followup_date", "TEXT NOT NULL DEFAULT ''");  // relancer le
addColumn("projects", "note", "TEXT NOT NULL DEFAULT ''");
addColumn("tasks", "stage", "TEXT NOT NULL DEFAULT ''");             // '' (auto) | etudes | chantier
addColumn("tasks", "validation_days", "INTEGER NOT NULL DEFAULT 0"); // traîne de validation client
addColumn("tasks", "lead_days", "INTEGER NOT NULL DEFAULT 0");       // « à caler » : pointillé avant
addColumn("tasks", "time", "TEXT NOT NULL DEFAULT ''");              // HH:MM (jalons)
addColumn("tasks", "after_id", "TEXT NOT NULL DEFAULT ''");          // lien : suit cette tâche

// Palette v2 (couleurs vives, lisibles par un daltonien deutéranope) :
// on remplace une seule fois les anciennes couleurs par leur équivalent.
const OLD_PALETTE = ["#2E5932", "#9A451C", "#3F6C8A", "#B7862C", "#7A4B6E", "#6F8F4E", "#C4623D", "#2F7F7A", "#8A5A3C", "#5B5F97", "#A33B4E", "#55595F"];
const NEW_PALETTE = ["#009E73", "#D55E00", "#0072B2", "#E69F00", "#AA4499", "#56B4E9", "#CC79A7", "#44AA99", "#882255", "#332288", "#F0E442", "#5A5A5A"];
if (!db.prepare("SELECT 1 FROM meta WHERE key='palette'").get()) {
  db.transaction(() => {
    const upd = db.prepare("UPDATE projects SET color=? WHERE upper(color)=upper(?)");
    OLD_PALETTE.forEach((c, i) => upd.run(NEW_PALETTE[i], c));
    db.prepare("INSERT INTO meta (key, value) VALUES ('palette', '2')").run();
    db.prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key='rev'").run();
  })();
}

// ── Validation ───────────────────────────────────────────────────────────
export class ValidationError extends Error {}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ID_RE = /^[\w-]{1,64}$/;
const ASSIGNEES = new Set(["", "francois", "guillaume", "both"]);
const KINDS = new Set(["task", "milestone"]);
const STATUSES = new Set(["signed", "prospect"]);
const STAGES = new Set(["", "etudes", "chantier"]);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const optDate = (v, msg) => { const d = String(v ?? ""); check(d === "" || DATE_RE.test(d), msg); return d; };
const days = (v) => Math.max(0, Math.min(365, Math.round(Number(v) || 0)));

const str = (v, max) => String(v ?? "").slice(0, max);
const check = (ok, msg) => { if (!ok) throw new ValidationError(msg); };
const now = () => new Date().toISOString();

// Ne garde que les champs connus et valides d'un patch de projet.
function cleanProject(p, full) {
  const out = {};
  if (full || "name" in p) { out.name = str(p.name, 120).trim(); check(out.name, "Nom de projet requis."); }
  if (full || "color" in p) { out.color = String(p.color); check(COLOR_RE.test(out.color), "Couleur invalide."); }
  if (full || "position" in p) { out.position = Number(p.position) || 0; }
  if (full || "archived" in p) { out.archived = p.archived ? 1 : 0; }
  if (full || "status" in p) { out.status = String(p.status || "signed"); check(STATUSES.has(out.status), "Statut invalide."); }
  if (full || "proposal_date" in p) out.proposal_date = optDate(p.proposal_date, "Date de proposition invalide.");
  if (full || "followup_date" in p) out.followup_date = optDate(p.followup_date, "Date de relance invalide.");
  if (full || "note" in p) out.note = str(p.note, 5000);
  return out;
}

function cleanTask(t, full) {
  const out = {};
  if (full || "project_id" in t) { out.project_id = String(t.project_id); check(ID_RE.test(out.project_id), "Projet invalide."); }
  if (full || "title" in t) out.title = str(t.title, 200);
  if (full || "note" in t) out.note = str(t.note, 5000);
  if (full || "start" in t) { out.start_date = String(t.start); check(DATE_RE.test(out.start_date), "Date de début invalide."); }
  if (full || "end" in t) { out.end_date = String(t.end); check(DATE_RE.test(out.end_date), "Date de fin invalide."); }
  if (full || "assignee" in t) { out.assignee = String(t.assignee ?? ""); check(ASSIGNEES.has(out.assignee), "Assignation invalide."); }
  if (full || "kind" in t) { out.kind = String(t.kind || "task"); check(KINDS.has(out.kind), "Type invalide."); }
  if (full || "done" in t) out.done = t.done ? 1 : 0;
  if (full || "position" in t) out.position = Number(t.position) || 0;
  if (full || "stage" in t) { out.stage = String(t.stage ?? ""); check(STAGES.has(out.stage), "Phase invalide."); }
  if (full || "validation_days" in t) out.validation_days = days(t.validation_days);
  if (full || "lead_days" in t) out.lead_days = days(t.lead_days);
  if (full || "time" in t) { out.time = String(t.time ?? ""); check(out.time === "" || TIME_RE.test(out.time), "Heure invalide."); }
  if (full || "after_id" in t) { out.after_id = String(t.after_id ?? ""); check(out.after_id === "" || ID_RE.test(out.after_id), "Lien invalide."); }
  return out;
}

// ── Lecture ──────────────────────────────────────────────────────────────
const stmts = {
  rev: db.prepare("SELECT value FROM meta WHERE key='rev'"),
  bump: db.prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key='rev'"),
  projects: db.prepare("SELECT * FROM projects ORDER BY position, rowid"),
  tasks: db.prepare("SELECT * FROM tasks ORDER BY position, rowid"),
  project: db.prepare("SELECT * FROM projects WHERE id=?"),
  task: db.prepare("SELECT * FROM tasks WHERE id=?"),
  delProject: db.prepare("DELETE FROM projects WHERE id=?"),
  delTask: db.prepare("DELETE FROM tasks WHERE id=?"),
  closures: db.prepare("SELECT * FROM closures ORDER BY start_date"),
  closure: db.prepare("SELECT * FROM closures WHERE id=?"),
  delClosure: db.prepare("DELETE FROM closures WHERE id=?"),
};

const rowToProject = (r) => ({
  id: r.id, name: r.name, color: r.color, position: r.position, archived: !!r.archived,
  status: r.status, proposal_date: r.proposal_date, followup_date: r.followup_date, note: r.note,
});
const rowToTask = (r) => ({
  id: r.id, project_id: r.project_id, title: r.title, note: r.note,
  start: r.start_date, end: r.end_date, assignee: r.assignee, kind: r.kind,
  done: !!r.done, position: r.position,
  stage: r.stage, validation_days: r.validation_days, lead_days: r.lead_days, time: r.time, after_id: r.after_id,
});
const rowToClosure = (r) => ({ id: r.id, start: r.start_date, end: r.end_date, label: r.label });

export const getRev = () => Number(stmts.rev.get().value);

export function getState() {
  return {
    rev: getRev(),
    projects: stmts.projects.all().map(rowToProject),
    tasks: stmts.tasks.all().map(rowToTask),
    closures: stmts.closures.all().map(rowToClosure),
  };
}

// ── Écriture : chaque mutation est une transaction qui incrémente `rev` ──
const write = (fn) => db.transaction((...args) => {
  const result = fn(...args);
  stmts.bump.run();
  return { result, rev: getRev() };
});

function insert(table, row) {
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map((c) => "@" + c).join(",")})`).run(row);
}
function update(table, id, row) {
  const cols = Object.keys(row);
  if (!cols.length) return;
  db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c}=@${c}`).join(",")} WHERE id=@id`).run({ ...row, id });
}

export const createProject = write((p) => {
  const id = String(p.id);
  check(ID_RE.test(id), "Identifiant invalide.");
  insert("projects", { id, ...cleanProject(p, true), updated_at: now() });
  return rowToProject(stmts.project.get(id));
});

export const updateProject = write((id, patch) => {
  check(stmts.project.get(id), "Projet introuvable.");
  update("projects", id, { ...cleanProject(patch, false), updated_at: now() });
  return rowToProject(stmts.project.get(id));
});

export const deleteProject = write((id) => { stmts.delProject.run(id); });

export const createTask = write((t) => {
  const id = String(t.id);
  check(ID_RE.test(id), "Identifiant invalide.");
  const row = cleanTask(t, true);
  check(row.end_date >= row.start_date, "La fin précède le début.");
  check(stmts.project.get(row.project_id), "Projet introuvable.");
  insert("tasks", { id, ...row, updated_at: now() });
  return rowToTask(stmts.task.get(id));
});

export const updateTask = write((id, patch) => {
  const cur = stmts.task.get(id);
  check(cur, "Tâche introuvable.");
  const row = cleanTask(patch, false);
  check((row.end_date ?? cur.end_date) >= (row.start_date ?? cur.start_date), "La fin précède le début.");
  if (row.project_id) check(stmts.project.get(row.project_id), "Projet introuvable.");
  update("tasks", id, { ...row, updated_at: now() });
  return rowToTask(stmts.task.get(id));
});

export const deleteTask = write((id) => { stmts.delTask.run(id); });

// Plusieurs tâches d'un coup (décalage en cascade, glisser tout un projet).
export const updateTasks = write((list) => {
  check(Array.isArray(list) && list.length <= 500, "Liste invalide.");
  for (const { id, patch } of list) {
    const cur = stmts.task.get(String(id));
    check(cur, "Tâche introuvable.");
    const row = cleanTask(patch || {}, false);
    check((row.end_date ?? cur.end_date) >= (row.start_date ?? cur.start_date), "La fin précède le début.");
    if (row.project_id) check(stmts.project.get(row.project_id), "Projet introuvable.");
    update("tasks", cur.id, { ...row, updated_at: now() });
  }
  return list.length;
});

// ── Fermetures de l'agence (vacances) ─────────────────────────────────────
function cleanClosure(c) {
  const out = { start_date: String(c.start), end_date: String(c.end), label: str(c.label, 120) };
  check(DATE_RE.test(out.start_date) && DATE_RE.test(out.end_date), "Dates invalides.");
  check(out.end_date >= out.start_date, "La fin précède le début.");
  return out;
}
export const createClosure = write((c) => {
  const id = String(c.id);
  check(ID_RE.test(id), "Identifiant invalide.");
  insert("closures", { id, ...cleanClosure(c), updated_at: now() });
  return rowToClosure(stmts.closure.get(id));
});
export const updateClosure = write((id, c) => {
  check(stmts.closure.get(id), "Fermeture introuvable.");
  const cur = rowToClosure(stmts.closure.get(id));
  update("closures", id, { ...cleanClosure({ ...cur, ...c }), updated_at: now() });
  return rowToClosure(stmts.closure.get(id));
});
export const deleteClosure = write((id) => { stmts.delClosure.run(id); });

// ── Sauvegarde : un fichier par jour, réécrit à chaque passage (30 gardés) ──
export async function backup() {
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(BACKUP_DIR, `planning-${day}.db`);
  await db.backup(file);
  const all = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith("planning-")).sort();
  for (const f of all.slice(0, -30)) fs.unlinkSync(path.join(BACKUP_DIR, f));
}
