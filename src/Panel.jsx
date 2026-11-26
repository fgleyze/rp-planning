// ── Panneaux latéraux : édition d'une tâche ou d'un projet ────────────────
import React, { useEffect, useRef, useState } from "react";
import { ASSIGNEE_OPTIONS, PEOPLE, PHASES, PROJECT_COLORS, assigneesOf, stageOf, STAGE_LABEL, effEnd } from "./constants.js";
import { toDay, toIso, fmtShort, fmtLong, workingDays, todayDay } from "./dates.js";
import { Avatars } from "./Gantt.jsx";
import { closureDays, closuresFor, wouldLoop } from "./logic.js";

// Lien « Ajouter à Google Agenda » prérempli pour un jalon.
export function gcalUrl(task, project) {
  const ymd = (iso) => iso.replace(/-/g, "");
  let dates;
  if (task.time) {
    const [h, m] = task.time.split(":").map(Number);
    const endH = String(Math.min(23, h + 1)).padStart(2, "0");
    const hm = (hh, mm) => `${String(hh).padStart(2, "0")}${String(mm).padStart(2, "0")}00`;
    dates = `${ymd(task.start)}T${hm(h, m)}/${ymd(task.start)}T${h === 23 ? "235900" : endH + String(m).padStart(2, "0") + "00"}`;
  } else {
    dates = `${ymd(task.start)}/${ymd(toIso(toDay(task.start) + 1))}`;
  }
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: `${project ? project.name + " — " : ""}${task.title || "Jalon"}`,
    dates,
    ctz: "Europe/Paris",
    details: [task.note, "Ajouté depuis le planning Racines & Perspectives."].filter(Boolean).join("\n\n"),
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

function NumberField({ label, value, onChange, suffix, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="num-row">
        <input type="number" min="0" max="365" value={value || 0}
          onChange={(ev) => onChange(Math.max(0, Math.min(365, Math.round(Number(ev.target.value) || 0))))} />
        <small>{suffix}</small>
      </div>
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

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
export function TaskPanel({ task, tasks = [], closures = [], projects, isNew, onPatch, onDelete, onDuplicate, onClose }) {
  const cds = closuresFor(closureDays(closures), task);
  const project = projects.find((p) => p.id === task.project_id);
  // Tâches du même projet auxquelles on peut se lier (sans créer de boucle).
  const linkable = tasks
    .filter((t) => t.project_id === task.project_id && t.id !== task.id && !wouldLoop(tasks, task.id, t.id))
    .sort((a, b) => a.start.localeCompare(b.start));
  const pred = tasks.find((t) => t.id === task.after_id);
  const followers = tasks.filter((t) => t.after_id === task.id);
  const setAfter = (id) => {
    if (!id) return onPatch({ after_id: "" });
    const p = tasks.find((t) => t.id === id);
    const patch = { after_id: id };
    // Si la tâche commence avant la fin de celle qu'elle suit, on la cale juste après.
    const minStart = effEnd(p, toDay) + 1;
    if (toDay(task.start) < minStart) {
      const len = toDay(task.end) - toDay(task.start);
      patch.start = toIso(minStart);
      patch.end = toIso(minStart + len);
    }
    onPatch(patch);
  };
  const stage = stageOf(task);
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
        <>
          <div className="field-row">
            <label className="field">
              <span>Date du jalon</span>
              <input type="date" value={task.start} onChange={(ev) => setStart(ev.target.value)} />
            </label>
            <label className="field">
              <span>Heure</span>
              <input type="time" value={task.time || ""} onChange={(ev) => onPatch({ time: ev.target.value })} />
            </label>
          </div>
          <a className="btn gcal" href={gcalUrl(task, project)} target="_blank" rel="noopener noreferrer">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="12" height="11" rx="2" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" strokeLinecap="round" /></svg>
            Ajouter à Google Agenda
          </a>
        </>
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
            <span>· {workingDays(s, e, cds)} ouvré{workingDays(s, e, cds) > 1 ? "s" : ""}</span>
          </div>
        </>
      )}

      <div className="field">
        <span>Phase</span>
        <div className="seg">
          {["etudes", "chantier"].map((k) => (
            <button key={k} className={stage === k ? "on" : ""} onClick={() => onPatch({ stage: k })}>{STAGE_LABEL[k]}</button>
          ))}
        </div>
        {!task.stage && <small className="field-hint">Déduit de l'intitulé : clique pour fixer.</small>}
      </div>

      <label className="field">
        <span>Suit la tâche</span>
        <select value={task.after_id || ""} onChange={(ev) => setAfter(ev.target.value)}>
          <option value="">— aucune (pas de lien) —</option>
          {linkable.map((t) => <option key={t.id} value={t.id}>{t.title || "Sans titre"} ({fmtShort(toDay(t.start))} → {fmtShort(toDay(t.end))})</option>)}
          {task.after_id && !pred && <option value={task.after_id}>(tâche supprimée)</option>}
        </select>
        <small className="field-hint">
          Quand {pred ? `« ${pred.title || "Sans titre"} »` : "la tâche liée"} glisse, celle-ci se décale d'autant.
          {followers.length > 0 && <> Suivie par : {followers.map((f) => f.title || "Sans titre").join(", ")}.</>}
        </small>
      </label>

      <div className="field-row">
        {task.kind !== "milestone" && (
          <NumberField label="Validation client" value={task.validation_days} suffix="jours après"
            onChange={(v) => onPatch({ validation_days: v })} />
        )}
        <NumberField label="À caler" value={task.lead_days} suffix="jours avant"
          onChange={(v) => onPatch({ lead_days: v })} />
      </div>

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
export function ProjectPanel({ project, tasks, isNew, onPatch, onDelete, onAddTask, onMove, onOpenView, onClose }) {
  const [name, setName, flushName] = useDraft(project.name, (v) => v.trim() && onPatch({ name: v.trim() }));
  const [pnote, setPnote, flushPnote] = useDraft(project.note || "", (v) => onPatch({ note: v }), 800);
  const prospect = project.status === "prospect";
  const relanceIn = (n) => onPatch({ followup_date: toIso(todayDay() + n) });
  const nameRef = useRef(null);
  useEffect(() => { if (isNew) nameRef.current?.select(); }, [project.id, isNew]);

  const its = tasks.filter((t) => t.project_id === project.id);
  const span = its.length ? [Math.min(...its.map((t) => toDay(t.start))), Math.max(...its.map((t) => toDay(t.end)))] : null;
  const count = (k) => its.filter((t) => assigneesOf(t.assignee).includes(k)).length;
  const done = its.filter((t) => t.done).length;

  return (
    <Shell title={isNew ? "Nouveau projet" : prospect ? "Prospect" : "Projet"} onClose={() => { flushName(); flushPnote(); onClose(); }}>
      <label className="field">
        <span>Nom du projet</span>
        <input ref={nameRef} value={name} onChange={(ev) => setName(ev.target.value)} onBlur={flushName}
          onKeyDown={(ev) => { if (ev.key === "Enter") { flushName(); ev.currentTarget.blur(); } }} />
      </label>

      <div className="field">
        <span>Statut</span>
        <div className="seg">
          <button className={!prospect ? "on" : ""} onClick={() => onPatch({ status: "signed" })}>Signé</button>
          <button className={prospect ? "on" : ""} onClick={() => onPatch({ status: "prospect", proposal_date: project.proposal_date || toIso(todayDay()) })}>Prospect (non signé)</button>
        </div>
      </div>

      {prospect && (
        <div className="prospect-box">
          <div className="field-row">
            <label className="field">
              <span>Proposition envoyée le</span>
              <input type="date" value={project.proposal_date || ""} onChange={(ev) => onPatch({ proposal_date: ev.target.value })} />
            </label>
            <label className="field">
              <span>Relancer le</span>
              <input type="date" value={project.followup_date || ""} onChange={(ev) => onPatch({ followup_date: ev.target.value })} />
            </label>
          </div>
          <div className="chips">
            <button className="chip" onClick={() => relanceIn(7)}>Relancer dans 1 sem.</button>
            <button className="chip" onClick={() => relanceIn(14)}>2 sem.</button>
            <button className="chip" onClick={() => relanceIn(30)}>1 mois</button>
            {project.followup_date && <button className="chip" onClick={() => onPatch({ followup_date: "" })}>Pas de relance</button>}
          </div>
        </div>
      )}

      <label className="field">
        <span>Note</span>
        <textarea rows={3} value={pnote} placeholder={prospect ? "Devis, montant, contact, ce qu'on attend…" : "Contexte, contacts…"}
          onChange={(ev) => setPnote(ev.target.value)} onBlur={flushPnote} />
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
        <button className="btn" onClick={onOpenView}>Vue détail / export</button>
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

// ── Fermetures de l'agence et absences perso ──────────────────────────────
const WHO_OPTIONS = [
  { value: "", label: "Agence" },
  { value: "francois", label: "François" },
  { value: "guillaume", label: "Guillaume" },
];
function WhoSeg({ value, onChange }) {
  return (
    <div className="seg who-seg">
      {WHO_OPTIONS.map((o) => (
        <button key={o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}
          title={o.value ? `Absence de ${o.label} seulement` : "Toute l'agence est fermée"}>
          {o.value ? <Avatars assignee={o.value} size={14} /> : null}{o.label}
        </button>
      ))}
    </div>
  );
}

export function ClosuresPanel({ closures, onAdd, onPatch, onRemove, onClose }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [label, setLabel] = useState("");
  const [who, setWho] = useState("");
  const [filter, setFilter] = useState("all");
  const add = () => {
    if (!start) return;
    const e = end && end >= start ? end : start;
    onAdd({ start, end: e, label: label.trim(), who });
    setStart(""); setEnd(""); setLabel("");
  };
  const list = closures.filter((c) => filter === "all" || (c.who || "") === filter);
  return (
    <Shell title="Fermetures et absences" onClose={onClose}>
      <p className="hint">
        <b>Agence</b> : tout le monde est fermé, hachuré sur tout le planning. <b>François</b> ou <b>Guillaume</b> : absence perso,
        qui ne coupe que ses propres tâches (une tâche « les deux » n'est coupée que si les deux sont absents).
        Les absences perso n'apparaissent pas dans l'export client.
      </p>
      <div className="closure-add">
        <div className="field"><span>Pour qui</span><WhoSeg value={who} onChange={setWho} /></div>
        <div className="field-row">
          <label className="field"><span>Du</span><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="field"><span>Au</span><input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
        <label className="field"><span>Libellé</span><input value={label} placeholder={who ? "Congés, formation…" : "Vacances de Noël, pont…"} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} /></label>
        <button className="btn primary" disabled={!start} onClick={add}>+ Ajouter {who ? "l'absence" : "la fermeture"}</button>
      </div>
      <div className="seg closure-filter">
        {[{ value: "all", label: "Tout" }, ...WHO_OPTIONS].map((o) => (
          <button key={o.value} className={filter === o.value ? "on" : ""} onClick={() => setFilter(o.value)}>{o.label}</button>
        ))}
      </div>
      <div className="closure-list">
        {list.length === 0 && <p className="hint">Rien pour l'instant.</p>}
        {list.map((c) => (
          <div key={c.id} className={"closure-item" + (c.who ? " perso" : "")} style={c.who ? { "--pc": PEOPLE[c.who].color } : undefined}>
            <WhoSeg value={c.who || ""} onChange={(v) => onPatch(c.id, { who: v })} />
            <div className="field-row">
              <input type="date" value={c.start} onChange={(e) => e.target.value && onPatch(c.id, { start: e.target.value, end: c.end < e.target.value ? e.target.value : c.end })} />
              <input type="date" value={c.end} min={c.start} onChange={(e) => e.target.value && onPatch(c.id, { end: e.target.value })} />
            </div>
            <div className="closure-row2">
              <input defaultValue={c.label} placeholder="Libellé" onBlur={(e) => e.target.value !== c.label && onPatch(c.id, { label: e.target.value })} />
              <button className="icon-btn" title="Supprimer" onClick={() => onRemove(c.id)}>
                <svg width="14" height="14" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}

// ── Prospects et relances ─────────────────────────────────────────────────
export function FollowupsPanel({ projects, onOpen, onPatch, onClose }) {
  const today = todayDay();
  const list = projects
    .filter((p) => p.status === "prospect" && !p.archived)
    .sort((a, b) => (a.followup_date || "9999").localeCompare(b.followup_date || "9999"));
  return (
    <Shell title="Prospects et relances" onClose={onClose}>
      <p className="hint">Sujets non signés (devis ou proposition envoyés). Un prospect se crée comme un projet, avec le statut « Prospect ».</p>
      {list.length === 0 && <p className="hint">Aucun prospect en cours.</p>}
      {list.map((p) => {
        const f = p.followup_date ? toDay(p.followup_date) : null;
        const late = f != null && f <= today;
        return (
          <div key={p.id} className={"followup" + (late ? " late" : "")}>
            <button className="followup-name" onClick={() => onOpen(p.id)}>
              <span className="pdot lg" style={{ background: p.color }} />{p.name}
            </button>
            <div className="followup-dates">
              {p.proposal_date && <span>Proposition le {fmtShort(toDay(p.proposal_date))}</span>}
              {f != null
                ? <span className="relance">{late ? "⚠ Relancer " + (f === today ? "aujourd'hui" : "depuis le " + fmtShort(f)) : "Relancer le " + fmtLong(f)}</span>
                : <span>Pas de date de relance</span>}
            </div>
            {p.note && <div className="followup-note">{p.note}</div>}
            <div className="chips">
              <button className="chip" onClick={() => onPatch(p.id, { followup_date: toIso(today + 7) })}>Relancé → +1 sem.</button>
              <button className="chip" onClick={() => onPatch(p.id, { followup_date: toIso(today + 14) })}>+2 sem.</button>
              <button className="chip on" onClick={() => onPatch(p.id, { status: "signed", followup_date: "" })}>Signé ✓</button>
            </div>
          </div>
        );
      })}
    </Shell>
  );
}
