import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getToken, setToken, clearToken, safeLS } from "./api.js";
import { useStore } from "./useStore.js";
import Gantt, { Avatars } from "./Gantt.jsx";
import { TaskPanel, ProjectPanel, ClosuresPanel, FollowupsPanel } from "./Panel.jsx";
import ProjectView from "./ProjectView.jsx";
import { cascade } from "./logic.js";
import { PEOPLE, PROJECT_COLORS, assigneesOf } from "./constants.js";
import { toDay, toIso, todayDay } from "./dates.js";

// ── Porte d'entrée : mot de passe partagé ────────────────────────────────
function Login({ onOk }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      if (await api.checkPassword(pw)) { setToken(pw); onOk(); }
      else setErr("Mot de passe incorrect.");
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <Logo />
        <h1>Planning</h1>
        <p>Accès réservé à l'équipe Racines &amp; Perspectives.</p>
        <input type="password" autoFocus placeholder="Mot de passe" value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <div className="err">{err}</div>}
        <button className="btn primary" disabled={busy || !pw}>{busy ? "…" : "Entrer"}</button>
      </form>
    </div>
  );
}

function Logo() {
  return (
    <div className="brand">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#2E5932" />
        <rect x="6" y="8" width="14" height="4" rx="2" fill="#F5F5F0" />
        <rect x="11" y="14" width="15" height="4" rx="2" fill="#E0A77F" />
        <rect x="8" y="20" width="10" height="4" rx="2" fill="#F5F5F0" />
      </svg>
      <span>Racines &amp; Perspectives</span>
    </div>
  );
}

export default function App() {
  const [phase, setPhase] = useState("checking"); // checking | login | app
  useEffect(() => {
    api.config()
      .then(async (c) => {
        if (!c.authRequired) return setPhase("app");
        const t = getToken();
        setPhase(t && (await api.checkPassword(t).catch(() => false)) ? "app" : "login");
      })
      .catch(() => setPhase("login"));
  }, []);
  if (phase === "checking") return <div className="loading">Chargement…</div>;
  if (phase === "login") return <Login onOk={() => setPhase("app")} />;
  return <Planner onLogout={() => { clearToken(); setPhase("login"); }} />;
}

// ── Préférences locales (par navigateur) ──────────────────────────────────
function usePref(key, initial) {
  const k = "rp-planning:" + key;
  const [v, setV] = useState(() => {
    try { const s = safeLS.get(k); return s == null ? initial : JSON.parse(s); } catch { return initial; }
  });
  useEffect(() => { safeLS.set(k, JSON.stringify(v)); }, [k, v]);
  return [v, setV];
}

function Planner({ onLogout }) {
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const showToast = useCallback((msg, action) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, action, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), action ? 6000 : 3500);
  }, []);

  const store = useStore({ onAuthError: onLogout, onError: (m) => showToast(m) });
  const { projects, tasks, loaded } = store;

  const [colorMode, setColorMode] = usePref("colorMode", "project");
  const [who, setWho] = usePref("who", "all");
  const [showArchived, setShowArchived] = usePref("archived", false);
  const [collapsedArr, setCollapsedArr] = usePref("collapsed", []);
  const [showProspects, setShowProspects] = usePref("prospects", true);
  const [order, setOrder] = usePref("projectOrder", []); // ordre propre à ce navigateur
  const [theme, setTheme] = usePref("theme", "auto"); // auto | light | dark
  const [viewId, setViewId] = useState(null); // vue détail d'un projet
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);
  const collapsed = useMemo(() => new Set(collapsedArr), [collapsedArr]);
  const [selected, setSelected] = useState(null); // { type, id, isNew? }
  const gantt = useRef(null);

  // Ordre : d'abord l'ordre local (ce navigateur), puis l'ordre commun pour
  // les projets que ce navigateur n'a pas encore rangés.
  const sortedProjects = useMemo(() => {
    const idx = new Map(order.map((id, i) => [id, i]));
    return [...projects].sort((a, b) => {
      const ia = idx.get(a.id), ib = idx.get(b.id);
      if (ia != null && ib != null) return ia - ib;
      if (ia != null) return -1;
      if (ib != null) return 1;
      return a.position - b.position;
    });
  }, [projects, order]);
  const visibleProjects = useMemo(
    () => sortedProjects.filter((p) => (showArchived || !p.archived) && (showProspects || p.status !== "prospect")),
    [sortedProjects, showArchived, showProspects],
  );
  const dueFollowups = projects.filter((p) => p.status === "prospect" && !p.archived && p.followup_date && toDay(p.followup_date) <= todayDay()).length;
  const visibleTasks = useMemo(
    () => (who === "all" ? tasks : tasks.filter((t) => assigneesOf(t.assignee).includes(who))),
    [tasks, who],
  );

  // La sélection disparaît si l'objet a été supprimé (par l'autre, par ex.).
  useEffect(() => {
    if (!selected || selected.type === "closures" || selected.type === "followups") return;
    const list = selected.type === "task" ? tasks : projects;
    if (loaded && !list.some((x) => x.id === selected.id)) setSelected(null);
  }, [tasks, projects, selected, loaded]);

  const toggleCollapse = (id) =>
    setCollapsedArr((arr) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]));

  const nextTaskPos = (projectId) => {
    const its = tasks.filter((t) => t.project_id === projectId);
    return its.length ? Math.max(...its.map((t) => t.position)) + 1 : 0;
  };

  // Assignation par défaut d'une nouvelle tâche : la personne filtrée.
  const defaultAssignee = who === "all" ? "" : who;

  const createTask = (t) => {
    const task = store.addTask({ assignee: defaultAssignee, position: nextTaskPos(t.project_id), ...t });
    if (collapsed.has(t.project_id)) toggleCollapse(t.project_id);
    setSelected({ type: "task", id: task.id, isNew: true });
  };

  const quickAdd = (projectId) => {
    const g = gantt.current;
    const first = g?.firstVisibleDay() ?? todayDay();
    const today = todayDay();
    const start = today >= first && today < first + 20 ? today : first + 2;
    createTask({ project_id: projectId, start: toIso(start), end: toIso(start + 4) });
    g?.revealDay(start);
  };

  const addProject = () => {
    const used = new Set(projects.map((p) => p.color));
    const color = PROJECT_COLORS.find((c) => !used.has(c)) || PROJECT_COLORS[projects.length % PROJECT_COLORS.length];
    const pos = projects.length ? Math.max(...projects.map((p) => p.position)) + 1 : 0;
    const p = store.addProject({ name: "Nouveau projet", color, position: pos });
    setSelected({ type: "project", id: p.id, isNew: true });
  };

  // Monter / descendre un projet : ordre enregistré dans ce navigateur seulement.
  const moveProject = (id, dir) => {
    const vis = visibleProjects.map((p) => p.id);
    const i = vis.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= vis.length) return;
    const full = sortedProjects.map((p) => p.id);
    const a = full.indexOf(vis[i]), b = full.indexOf(vis[j]);
    [full[a], full[b]] = [full[b], full[a]];
    setOrder(full);
  };

  // Modifier une tâche en décalant celles qui la suivent (liens explicites).
  const patchTask = (id, patch) => {
    const ups = cascade(tasks, id, patch);
    if (ups.length > 1) {
      store.patchTasks(ups, "Décalage en cascade");
      showToast(`${ups.length - 1} tâche${ups.length > 2 ? "s" : ""} liée${ups.length > 2 ? "s" : ""} décalée${ups.length > 2 ? "s" : ""}`, { label: "Annuler", run: undo });
    } else store.patchTask(id, patch);
  };

  const undo = useCallback(() => {
    const item = store.undo();
    if (item) showToast(`Annulé — ${item.label}`);
  }, [store.undo, showToast]);

  const deleteTask = (id) => {
    store.removeTask(id);
    setSelected(null);
    showToast("Tâche supprimée", { label: "Annuler", run: undo });
  };

  // Raccourcis clavier.
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey && !typing) {
        e.preventDefault();
        undo();
      } else if (e.key === "Escape") {
        // Barre créée par erreur (encore vide) : Échap la supprime sans confirmation.
        const sel = selected?.type === "task" && selected.isNew ? tasks.find((t) => t.id === selected.id) : null;
        const typed = typing && document.activeElement.value;
        if (sel && !sel.title && !sel.note && !typed) {
          if (typing) document.activeElement.blur();
          store.removeTask(sel.id);
          setSelected(null);
          return;
        }
        if (typing) document.activeElement.blur();
        else setSelected(null);
      } else if (!typing && !e.ctrlKey && !e.metaKey) {
        if (e.key === "t" || e.key === "T") gantt.current?.today();
        else if (e.key === "+" || e.key === "=") gantt.current?.zoomIn();
        else if (e.key === "-") gantt.current?.zoomOut();
        else if ((e.key === "Delete" || e.key === "Backspace") && selected?.type === "task") deleteTask(selected.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const selTask = selected?.type === "task" ? tasks.find((t) => t.id === selected.id) : null;
  const selProject = selected?.type === "project" ? projects.find((p) => p.id === selected.id) : null;
  const viewProject = viewId ? projects.find((p) => p.id === viewId) : null;
  const panelOpen = selTask || selProject || selected?.type === "closures" || selected?.type === "followups";

  return (
    <div className={"app" + (panelOpen ? " has-panel" : "")}>
      <header className="toolbar">
        <Logo />
        <span className="app-name">Planning</span>

        <div className="tb-group">
          <button className="btn" onClick={() => gantt.current?.today()} title="Revenir à aujourd'hui (T)">Aujourd'hui</button>
          <div className="seg zoom">
            <button onClick={() => gantt.current?.zoomOut()} title="Dézoomer (−, ou Ctrl + molette)">−</button>
            <button onClick={() => gantt.current?.zoomIn()} title="Zoomer (+, ou Ctrl + molette)">+</button>
          </div>
        </div>

        <div className="tb-group">
          <span className="tb-label">Qui</span>
          <div className="seg">
            <button className={who === "all" ? "on" : ""} onClick={() => setWho("all")}>Tous</button>
            {Object.entries(PEOPLE).map(([k, p]) => (
              <button key={k} className={who === k ? "on" : ""} onClick={() => setWho(k)} title={`Seulement ${p.name}`}>
                <Avatars assignee={k} size={16} /><span className="hide-sm">{p.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="tb-group">
          <span className="tb-label">Couleurs</span>
          <div className="seg">
            <button className={colorMode === "project" ? "on" : ""} onClick={() => setColorMode("project")}>Projets</button>
            <button className={colorMode === "person" ? "on" : ""} onClick={() => setColorMode("person")}>Personnes</button>
          </div>
        </div>

        <label className="check tb-check">
          <input type="checkbox" checked={showProspects} onChange={(e) => setShowProspects(e.target.checked)} />
          <span>Prospects</span>
        </label>
        <label className="check tb-check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          <span>Archivés</span>
        </label>

        <div className="tb-spacer" />
        <button className={"btn" + (dueFollowups ? " warn" : "")} onClick={() => setSelected({ type: "followups" })} title="Prospects et relances">
          Relances{dueFollowups > 0 && <span className="badge">{dueFollowups}</span>}
        </button>
        <button className="btn" onClick={() => setSelected({ type: "closures" })} title="Fermetures de l'agence (vacances)">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 7.5a6 6 0 0 1 12 0zM8 7.5V14M8 14h2.5" /></svg>
          <span className="hide-lg">Fermetures</span>
        </button>
        <button className="icon-btn" title={`Thème : ${{ auto: "automatique", light: "clair", dark: "sombre" }[theme]} (cliquer pour changer)`}
          onClick={() => setTheme({ auto: "light", light: "dark", dark: "auto" }[theme])}>
          {theme === "dark" ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" strokeLinejoin="round" /></svg>
          ) : theme === "light" ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6" /><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" /></svg>
          )}
        </button>
        <SyncDot state={store.sync} />
        <button className="btn ghost" onClick={undo} disabled={!store.canUndo} title="Annuler (Ctrl+Z)">↶<span className="hide-lg"> Annuler</span></button>
        <button className="btn primary" onClick={addProject}>+ Projet</button>
        <button className="icon-btn" onClick={onLogout} title="Se déconnecter">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3H3.5v10H6M10 5l3 3-3 3M13 8H6" /></svg>
        </button>
      </header>

      {colorMode === "person" && (
        <div className="legend">
          <span><i style={{ background: PEOPLE.francois.color }} />François</span>
          <span><i style={{ background: PEOPLE.guillaume.color }} />Guillaume</span>
          <span><i style={{ background: `repeating-linear-gradient(135deg, ${PEOPLE.francois.color} 0 4px, ${PEOPLE.guillaume.color} 4px 8px)` }} />Les deux</span>
          <span><i style={{ background: "#9a9a92" }} />Personne</span>
        </div>
      )}

      <main className="main">
        {!loaded ? (
          <div className="loading">Chargement du planning…</div>
        ) : visibleProjects.length === 0 ? (
          <div className="empty">
            <h2>{projects.length ? "Tous les projets sont archivés" : "Aucun projet pour l'instant"}</h2>
            <p>Crée un projet, puis dessine ses phases (APS, APD, PC…) directement dans le calendrier.</p>
            <button className="btn primary" onClick={addProject}>+ Créer un projet</button>
          </div>
        ) : (
          <Gantt
            ref={gantt}
            projects={visibleProjects}
            tasks={visibleTasks}
            allTasks={tasks}
            closures={store.closures}
            collapsed={collapsed}
            colorMode={colorMode}
            selected={selected}
            onSelect={setSelected}
            onToggleCollapse={toggleCollapse}
            onPatchTask={patchTask}
            onPatchTasks={(ups, label) => { store.patchTasks(ups, label); showToast(label, { label: "Annuler", run: undo }); }}
            onBackgroundClick={() => setSelected(null)}
            onMoveProject={moveProject}
            onOpenProject={(id) => setViewId(id)}
            onCreateTask={createTask}
            onQuickAdd={quickAdd}
            onDragState={store.setPaused}
          />
        )}

        {selTask && (
          <TaskPanel
            key={selTask.id}
            task={selTask}
            tasks={tasks}
            closures={store.closures}
            projects={sortedProjects}
            isNew={!!selected.isNew}
            onPatch={(patch) => patchTask(selTask.id, patch)}
            onDelete={() => deleteTask(selTask.id)}
            onDuplicate={() => {
              const d = toDay(selTask.end) - toDay(selTask.start) + 1;
              const { id, ...rest } = selTask;
              const t = store.addTask({
                ...rest,
                start: toIso(toDay(selTask.end) + 1),
                end: toIso(toDay(selTask.end) + d),
                done: false,
                position: selTask.position + 0.5,
              });
              setSelected({ type: "task", id: t.id });
              gantt.current?.revealDay(toDay(t.start));
            }}
            onClose={() => setSelected(null)}
          />
        )}
        {selProject && (
          <ProjectPanel
            key={selProject.id}
            project={selProject}
            tasks={tasks}
            isNew={!!selected.isNew}
            onPatch={(patch) => store.patchProject(selProject.id, patch)}
            onDelete={() => {
              store.removeProject(selProject.id);
              setSelected(null);
              showToast("Projet supprimé", { label: "Annuler", run: undo });
            }}
            onAddTask={() => quickAdd(selProject.id)}
            onMove={(dir) => moveProject(selProject.id, dir)}
            onOpenView={() => setViewId(selProject.id)}
            onClose={() => setSelected(null)}
          />
        )}
        {selected?.type === "closures" && (
          <ClosuresPanel closures={store.closures} onAdd={store.addClosure} onPatch={store.patchClosure}
            onRemove={store.removeClosure} onClose={() => setSelected(null)} />
        )}
        {selected?.type === "followups" && (
          <FollowupsPanel projects={projects} onOpen={(id) => setSelected({ type: "project", id })}
            onPatch={(id, patch) => store.patchProject(id, patch)} onClose={() => setSelected(null)} />
        )}
      </main>

      {viewProject && (
        <ProjectView project={viewProject} tasks={tasks} closures={store.closures} onClose={() => setViewId(null)} />
      )}

      {toast && (
        <div className="toast" key={toast.id}>
          <span>{toast.msg}</span>
          {toast.action && (
            <button onClick={() => { setToast(null); toast.action.run(); }}>{toast.action.label}</button>
          )}
        </div>
      )}
    </div>
  );
}

function SyncDot({ state }) {
  const label = { ok: "Enregistré", saving: "Enregistrement…", offline: "Hors ligne" }[state];
  return (
    <span className={"sync " + state} title={label}>
      <i /> <span className="hide-sm hide-lg">{label}</span>
    </span>
  );
}
