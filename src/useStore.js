// ── État partagé du planning ─────────────────────────────────────────────
// Mises à jour optimistes (l'écran bouge tout de suite), écritures envoyées au
// serveur en file (dans l'ordre), polling léger pour voir les modifs de l'autre,
// et une pile d'annulation (Ctrl+Z).
import { useCallback, useEffect, useRef, useState } from "react";
import { api, AuthError } from "./api.js";

const POLL_MS = 4000;

export const uid = () =>
  (crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^\w-]/g, "");

export function useStore({ onAuthError, onError }) {
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [closures, setClosures] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [sync, setSync] = useState("ok"); // ok | saving | offline
  const [canUndo, setCanUndo] = useState(false);

  const rev = useRef(-1);
  const queue = useRef(Promise.resolve());
  const pending = useRef(0);
  const writes = useRef(0); // compteur d'écritures, pour ignorer un poll périmé
  const paused = useRef(false); // pendant un glisser-déposer
  const undoStack = useRef([]);
  const tasksRef = useRef(tasks);
  const projectsRef = useRef(projects);
  tasksRef.current = tasks;
  projectsRef.current = projects;

  const cb = useRef({ onAuthError, onError });
  cb.current = { onAuthError, onError };

  const fail = (e) => {
    if (e instanceof AuthError) cb.current.onAuthError?.();
    else cb.current.onError?.(e.message || "Erreur réseau");
  };

  const load = useCallback(async (onlyIfChanged) => {
    const w = writes.current;
    try {
      const s = await api.state(onlyIfChanged ? rev.current : undefined);
      setSync((v) => (v === "offline" ? "ok" : v));
      if (!s.projects) return; // rien de neuf
      // Une écriture est partie entre-temps : on laissera le prochain tour relire.
      if (pending.current > 0 || paused.current || writes.current !== w) return;
      rev.current = s.rev;
      setProjects(s.projects);
      setTasks(s.tasks);
      setClosures(s.closures || []);
      setLoaded(true);
    } catch (e) {
      if (e instanceof AuthError) return fail(e);
      setSync("offline");
    }
  }, []);

  // Premier chargement + polling (+ relecture au retour sur l'onglet).
  useEffect(() => {
    load(false);
    const tick = () => {
      if (document.visibilityState === "visible" && pending.current === 0 && !paused.current) load(true);
    };
    const t = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [load]);

  // Envoi en file : garantit l'ordre des écritures sur le serveur.
  const send = useCallback((fn) => {
    pending.current++;
    writes.current++;
    setSync("saving");
    const p = queue.current.then(async () => {
      try {
        const r = await fn();
        // Si personne d'autre n'a écrit entre-temps, on est à jour.
        if (r && r.rev === rev.current + 1) rev.current = r.rev;
      } catch (e) {
        fail(e);
        pending.current--;
        rev.current = -1;
        await load(false); // on repart de la vérité serveur
        pending.current++;
      } finally {
        pending.current--;
        if (pending.current === 0) setSync("ok");
      }
    });
    queue.current = p;
    return p;
  }, [load]);

  const pushUndo = (label, undo) => {
    undoStack.current.push({ label, undo });
    if (undoStack.current.length > 50) undoStack.current.shift();
    setCanUndo(true);
  };

  // ── Projets ──
  const addProject = useCallback((p) => {
    const project = { id: uid(), archived: false, status: "signed", proposal_date: "", followup_date: "", note: "", ...p };
    setProjects((ps) => [...ps, project]);
    send(() => api.createProject(project));
    return project;
  }, [send]);

  const patchProject = useCallback((id, patch) => {
    setProjects((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    send(() => api.updateProject(id, patch));
  }, [send]);

  const removeProject = useCallback((id) => {
    const project = projectsRef.current.find((p) => p.id === id);
    const its = tasksRef.current.filter((t) => t.project_id === id);
    setProjects((ps) => ps.filter((p) => p.id !== id));
    setTasks((ts) => ts.filter((t) => t.project_id !== id));
    send(() => api.deleteProject(id));
    pushUndo(`Projet « ${project?.name} » supprimé`, () => {
      setProjects((ps) => [...ps, project].sort((a, b) => a.position - b.position));
      setTasks((ts) => [...ts, ...its]);
      send(() => api.createProject(project));
      its.forEach((t) => send(() => api.createTask(t)));
    });
  }, [send]);

  // ── Tâches ──
  const addTask = useCallback((t, { undo = true } = {}) => {
    const task = {
      id: uid(), title: "", note: "", assignee: "", kind: "task", done: false,
      stage: "", validation_days: 0, lead_days: 0, time: "", after_id: "", ...t,
    };
    setTasks((ts) => [...ts, task]);
    send(() => api.createTask(task));
    if (undo) pushUndo("Tâche créée", () => removeTaskRaw(task.id));
    return task;
  }, [send]);

  const removeTaskRaw = (id) => {
    setTasks((ts) => ts.filter((t) => t.id !== id));
    send(() => api.deleteTask(id));
  };

  const patchTask = useCallback((id, patch, { undo = true } = {}) => {
    const before = tasksRef.current.find((t) => t.id === id);
    if (!before) return;
    const changed = Object.keys(patch).filter((k) => patch[k] !== before[k]);
    if (!changed.length) return;
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    send(() => api.updateTask(id, patch));
    if (undo) {
      const prev = Object.fromEntries(changed.map((k) => [k, before[k]]));
      pushUndo("Modification", () => {
        if (!tasksRef.current.some((t) => t.id === id)) return;
        setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...prev } : t)));
        send(() => api.updateTask(id, prev));
      });
    }
  }, [send]);

  const removeTask = useCallback((id) => {
    const task = tasksRef.current.find((t) => t.id === id);
    if (!task) return;
    removeTaskRaw(id);
    pushUndo(`« ${task.title || "Sans titre"} » supprimée`, () => {
      if (!projectsRef.current.some((p) => p.id === task.project_id)) return;
      setTasks((ts) => [...ts, task]);
      send(() => api.createTask(task));
    });
  }, [send]);

  // Plusieurs tâches d'un coup, une seule entrée d'annulation.
  // updates : [{ id, patch }]
  const patchTasks = useCallback((updates, label = "Décalage") => {
    const cur = tasksRef.current;
    const prev = [];
    const real = [];
    for (const { id, patch } of updates) {
      const before = cur.find((t) => t.id === id);
      if (!before) continue;
      const changed = Object.keys(patch).filter((k) => patch[k] !== before[k]);
      if (!changed.length) continue;
      real.push({ id, patch });
      prev.push({ id, patch: Object.fromEntries(changed.map((k) => [k, before[k]])) });
    }
    if (!real.length) return;
    const apply = (list) => {
      const m = new Map(list.map((u) => [u.id, u.patch]));
      setTasks((ts) => ts.map((t) => (m.has(t.id) ? { ...t, ...m.get(t.id) } : t)));
      send(() => api.updateTasks(list));
    };
    apply(real);
    pushUndo(label, () => {
      const alive = prev.filter((u) => tasksRef.current.some((t) => t.id === u.id));
      if (alive.length) apply(alive);
    });
  }, [send]);

  // ── Fermetures de l'agence ──
  const addClosure = useCallback((c) => {
    const closure = { id: uid(), label: "", ...c };
    setClosures((cs) => [...cs, closure].sort((a, b) => a.start.localeCompare(b.start)));
    send(() => api.createClosure(closure));
  }, [send]);
  const patchClosure = useCallback((id, patch) => {
    setClosures((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    send(() => api.updateClosure(id, patch));
  }, [send]);
  const removeClosure = useCallback((id) => {
    setClosures((cs) => cs.filter((c) => c.id !== id));
    send(() => api.deleteClosure(id));
  }, [send]);

  const undo = useCallback(() => {
    const item = undoStack.current.pop();
    setCanUndo(undoStack.current.length > 0);
    item?.undo();
    return item;
  }, []);

  const lastUndoLabel = () => undoStack.current.at(-1)?.label;

  const setPaused = useCallback((v) => { paused.current = v; }, []);

  return {
    projects, tasks, closures, loaded, sync, canUndo,
    addProject, patchProject, removeProject,
    addTask, patchTask, patchTasks, removeTask,
    addClosure, patchClosure, removeClosure,
    undo, lastUndoLabel, setPaused, reload: () => load(false),
  };
}
