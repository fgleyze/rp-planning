// ── Panneaux latéraux : édition d'une tâche ou d'un projet ────────────────
import React, { useEffect, useRef, useState } from "react";
import { ASSIGNEE_OPTIONS, PEOPLE, PHASES, PROJECT_COLORS, assigneesOf } from "./constants.js";
import { toDay, toIso, fmtShort, workingDays } from "./dates.js";
import { Avatars } from "./Gantt.jsx";

// Champ texte sauvegardé en différé (et à la sortie du champ).
function useDraft(value, save, delay = 500) {
  const [draft, setDraft] = useState(value);
  const timer = useRef(null);
  const latest = useRef({ draft: value, save });
  latest.current.save = save;
  // Valeur externe changée (autre utilisateur, annulation) : on la reprend
  // sauf si l'on est en train de taper.
  useEffect(() => { if (!timer.current) { setDraft(value); latest.current.draft = value; } }, [value]);
  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; latest.current.save(latest.current.draft); }
  };
  useEffect(() => flush, []);
  const onChange = (v) => {
    setDraft(v);
    latest.current.draft = v;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  };
  return [draft, onChange, flush];
}

function Shell({ title, onClose, children }) {
  return (
    <aside className="panel" role="dialog" aria-label={title}>
      <header className="panel-head">
        <h2>{title}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Fermer">
          <svg width="16" height="16" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </header>
      <div className="panel-body">{children}</div>
    </aside>
  );
}

function ConfirmButton({ label, confirm, onConfirm }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button className={"btn danger" + (armed ? " armed" : "")} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? confirm : label}
    </button>
  );
}

// ── Tâche ────────────────────────────────────────────────────────────────
export function TaskPanel({ task, projects, isNew, onPatch, onDelete, onDuplicate, onClose }) {
  const [title, setTitle, flushTitle] = useDraft(task.title, (v) => onPatch({ title: v }));
  const [note, setNote, flushNote] = useDraft(task.note, (v) => onPatch({ note: v }), 800);
  const titleRef = useRef(null);

  useEffect(() => {
    if (isNew) titleRef.current?.focus();
  }, [task.id, isNew]);

  const s = toDay(task.start), e = toDay(task.end);
  const setStart = (v) => {
    if (!v) return;
    const ns = toDay(v);
    // Déplacer le début garde la durée si la fin passerait avant.
    const ne = task.kind === "milestone" ? ns : Math.max(e, ns);
    onPatch({ start: toIso(ns), end: toIso(ne) });
  };
  const setEnd = (v) => {
    if (!v) return;
    const ne = toDay(v);
    onPatch({ end: toIso(Math.max(ne, s)), start: ne < s ? toIso(ne) : task.start });
  };
  const setDuration = (n) => {
    const d = Math.max(1, Math.min(2000, Number(n) || 1));
    onPatch({ end: toIso(s + d - 1) });
  };

  return (
    <Shell title={isNew ? "Nouvelle tâche" : "Tâche"} onClose={() => { flushTitle(); flushNote(); onClose(); }}>
      <label className="field">
        <span>Intitulé</span>
        <input ref={titleRef} value={title} placeholder="APS, relevé, réunion de chantier…"
          onChange={(ev) => setTitle(ev.target.value)} onBlur={flushTitle}
          onKeyDown={(ev) => { if (ev.key === "Enter") { flushTitle(); ev.currentTarget.blur(); } }} />
      </label>
      <div className="chips">
        {PHASES.map((ph) => (
          <button key={ph} className={"chip" + (title === ph ? " on" : "")} onClick={() => { setTitle(ph); setTimeout(flushTitle); }}>{ph}</button>
        ))}
      </div>

      <label className="field">
        <span>Projet</span>
        <select value={task.project_id} onChange={(ev) => onPatch({ project_id: ev.target.value })}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.archived ? " (archivé)" : ""}</option>)}
        </select>
      </label>

      <div className="field">
        <span>Assigné à</span>
        <div className="seg assign">
          {ASSIGNEE_OPTIONS.map((o) => (
            <button key={o.value} className={task.assignee === o.value ? "on" : ""} onClick={() => onPatch({ assignee: o.value })}>
              {o.value ? <Avatars assignee={o.value} size={16} /> : <span className="avatar none">–</span>}
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {task.kind === "milestone" ? (
        <label className="field">
          <span>Date du jalon</span>
          <input type="date" value={task.start} onChange={(ev) => setStart(ev.target.value)} />
        </label>
      ) : (
        <>
          <div className="field-row">
            <label className="field">
              <span>Début</span>
              <input type="date" value={task.start} onChange={(ev) => setStart(ev.target.value)} />
            </label>
            <label className="field">
              <span>Fin</span>
              <input type="date" value={task.end} min={task.start} onChange={(ev) => setEnd(ev.target.value)} />
            </label>
          </div>
          <div className="duration">
            <label>
              <input type="number" min="1" value={e - s + 1} onChange={(ev) => setDuration(ev.target.value)} />
              jour{e - s ? "s" : ""}
            </label>
            <span>· {workingDays(s, e)} ouvré{workingDays(s, e) > 1 ? "s" : ""}</span>
          </div>
        </>
      )}

      <div className="toggles">
        <label className="check">
          <input type="checkbox" checked={task.kind === "milestone"}
            onChange={(ev) => onPatch(ev.target.checked ? { kind: "milestone", end: task.start } : { kind: "task", end: toIso(s + 4) })} />
          <span>Jalon <small>(une date clé, en losange)</small></span>
        </label>
        <label className="check">
          <input type="checkbox" checked={task.done} onChange={(ev) => onPatch({ done: ev.target.checked })} />
          <span>Terminé</span>
        </label>
      </div>

      <label className="field">
        <span>Note</span>
        <textarea rows={5} value={note} placeholder="Un petit texte : contexte, livrables, contacts…"
          onChange={(ev) => setNote(ev.target.value)} onBlur={flushNote} />
      </label>

      <div className="panel-actions">
        <button className="btn" onClick={() => { flushTitle(); flushNote(); onDuplicate(); }}>Dupliquer</button>
        <ConfirmButton label="Supprimer" confirm="Confirmer la suppression" onConfirm={onDelete} />
      </div>
      <p className="hint">Astuce : glisse la barre pour la déplacer, ses bords pour la rallonger. Ctrl+Z annule.</p>
    </Shell>
  );
}

// ── Projet ───────────────────────────────────────────────────────────────
export function ProjectPanel({ project, tasks, isNew, onPatch, onDelete, onAddTask, onMove, onClose }) {
  const [name, setName, flushName] = useDraft(project.name, (v) => v.trim() && onPatch({ name: v.trim() }));
  const nameRef = useRef(null);
  useEffect(() => { if (isNew) nameRef.current?.select(); }, [project.id, isNew]);

  const its = tasks.filter((t) => t.project_id === project.id);
  const span = its.length ? [Math.min(...its.map((t) => toDay(t.start))), Math.max(...its.map((t) => toDay(t.end)))] : null;
  const count = (k) => its.filter((t) => assigneesOf(t.assignee).includes(k)).length;
  const done = its.filter((t) => t.done).length;

  return (
    <Shell title={isNew ? "Nouveau projet" : "Projet"} onClose={() => { flushName(); onClose(); }}>
      <label className="field">
        <span>Nom du projet</span>
        <input ref={nameRef} value={name} onChange={(ev) => setName(ev.target.value)} onBlur={flushName}
          onKeyDown={(ev) => { if (ev.key === "Enter") { flushName(); ev.currentTarget.blur(); } }} />
      </label>

      <div className="field">
        <span>Couleur</span>
        <div className="swatches">
          {PROJECT_COLORS.map((c) => (
            <button key={c} className={"swatch" + (project.color === c ? " on" : "")} style={{ background: c }}
              onClick={() => onPatch({ color: c })} aria-label={c} />
          ))}
        </div>
      </div>

      <div className="stats">
        <div><b>{its.length}</b> tâche{its.length > 1 ? "s" : ""}{done ? ` · ${done} terminée${done > 1 ? "s" : ""}` : ""}</div>
        {span && <div>{fmtShort(span[0])} → {fmtShort(span[1])}</div>}
        <div className="who">
          <span><Avatars assignee="francois" size={16} /> {PEOPLE.francois.name} : {count("francois")}</span>
          <span><Avatars assignee="guillaume" size={16} /> {PEOPLE.guillaume.name} : {count("guillaume")}</span>
        </div>
      </div>

      <div className="panel-actions wrap">
        <button className="btn primary" onClick={onAddTask}>+ Ajouter une tâche</button>
        <button className="btn" onClick={() => onMove(-1)} title="Monter le projet">↑ Monter</button>
        <button className="btn" onClick={() => onMove(1)} title="Descendre le projet">↓ Descendre</button>
      </div>

      <label className="check">
        <input type="checkbox" checked={project.archived} onChange={(ev) => onPatch({ archived: ev.target.checked })} />
        <span>Archivé <small>(masqué du planning, sauf si « Archivés » est coché)</small></span>
      </label>

      <div className="panel-actions">
        <ConfirmButton label="Supprimer le projet"
          confirm={its.length ? `Supprimer avec ses ${its.length} tâche${its.length > 1 ? "s" : ""} ?` : "Confirmer la suppression"}
          onConfirm={onDelete} />
      </div>
    </Shell>
  );
}
