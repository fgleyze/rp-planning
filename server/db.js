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
`);

// ── Validation ───────────────────────────────────────────────────────────
export class ValidationError extends Error {}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ID_RE = /^[\w-]{1,64}$/;
const ASSIGNEES = new Set(["", "francois", "guillaume", "both"]);
const KINDS = new Set(["task", "milestone"]);

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
};

const rowToProject = (r) => ({
  id: r.id, name: r.name, color: r.color, position: r.position, archived: !!r.archived,
});
const rowToTask = (r) => ({
  id: r.id, project_id: r.project_id, title: r.title, note: r.note,
  start: r.start_date, end: r.end_date, assignee: r.assignee, kind: r.kind,
  done: !!r.done, position: r.position,
});

export const getRev = () => Number(stmts.rev.get().value);

export function getState() {
  return {
    rev: getRev(),
    projects: stmts.projects.all().map(rowToProject),
    tasks: stmts.tasks.all().map(rowToTask),
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

// ── Sauvegarde : un fichier par jour, réécrit à chaque passage (30 gardés) ──
export async function backup() {
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(BACKUP_DIR, `planning-${day}.db`);
  await db.backup(file);
  const all = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith("planning-")).sort();
  for (const f of all.slice(0, -30)) fs.unlinkSync(path.join(BACKUP_DIR, f));
}
