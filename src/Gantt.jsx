// ── Diagramme de Gantt ───────────────────────────────────────────────────
// Un seul conteneur qui défile dans les deux sens : colonne des libellés
// collée à gauche (sticky), en-tête des dates collé en haut. Tout se manipule
// à la souris / au doigt :
//   • glisser une barre            → la déplacer
//   • glisser un bord de barre      → l'allonger / la raccourcir
//   • cliquer une barre             → ouvrir le panneau
//   • glisser sur la ligne « + »    → dessiner une nouvelle tâche
//   • glisser le fond               → faire défiler le calendrier
//   • glisser la poignée ⋮⋮         → réordonner / changer de projet
//   • Ctrl / ⌘ + molette, pincer    → zoomer
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  toDay, toIso, todayDay, parts, mondayOf, isOff, holiday, isoWeek,
  MONTHS, MONTHS_SHORT, WEEKDAYS, fmtShort, fmtLong, workingDays,
} from "./dates.js";
import { PEOPLE, assigneesOf, assigneeLabel, inkOn, effEnd } from "./constants.js";
import { safeLS } from "./api.js";
import { cascade, closureDays } from "./logic.js";

const ROW_H = { project: 40, task: 34, add: 30 };
const HEADER_H = 52;
const MIN_W = 3, MAX_W = 90;
const ZOOM_KEY = "rp-planning:dayW";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Fond d'une barre selon le mode de couleur.
function barStyle(task, project, colorMode) {
  if (colorMode === "person") {
    if (task.assignee === "both") {
      const a = PEOPLE.francois.color, b = PEOPLE.guillaume.color;
      return { background: `repeating-linear-gradient(135deg, ${a} 0 8px, ${b} 8px 16px)`, color: "#fff", textShadow: "0 0 3px #000, 0 0 1px #000", "--bc": a };
    }
    const p = PEOPLE[task.assignee];
    const bg = p ? p.color : "#9a9a92";
    return { background: bg, color: inkOn(bg), "--bc": bg };
  }
  return { background: project.color, color: inkOn(project.color), "--bc": project.color };
}

export function Avatars({ assignee, size = 18 }) {
  const who = assigneesOf(assignee);
  if (!who.length) return null;
  return (
    <span className="avatars" title={assigneeLabel(assignee)}>
      {who.map((k) => (
        <span key={k} className="avatar" style={{ background: PEOPLE[k].color, width: size, height: size, fontSize: size * 0.55 }}>
          {PEOPLE[k].initial}
        </span>
      ))}
    </span>
  );
}

const Gantt = forwardRef(function Gantt(
  { projects, tasks, allTasks, closures = [], collapsed, colorMode, selected, onSelect, onToggleCollapse,
    onPatchTask, onPatchTasks, onCreateTask, onQuickAdd, onDragState, onBackgroundClick,
    onMoveProject, onOpenProject },
  ref,
) {
  const scroller = useRef(null);
  const [dayW, setDayW] = useState(() => clamp(Number(safeLS.get(ZOOM_KEY)) || 30, MIN_W, MAX_W));
  const [sidebarW, setSidebarW] = useState(() => (window.innerWidth < 700 ? 150 : 280));
  const today = todayDay();

  // ── Plage affichée : toujours un lundi, étendue à la demande ──
  const [range, setRange] = useState(() => {
    let a = today - 35, b = today + 300;
    for (const t of tasks) { a = Math.min(a, toDay(t.start) - 14); b = Math.max(b, toDay(t.end) + 60); }
    a = mondayOf(a);
    return { start: a, days: Math.ceil((b - a) / 7) * 7 };
  });

  // Les références « live » lues pendant les glisser-déposer.
  const live = useRef({});
  live.current = { dayW, range, sidebarW };

  useEffect(() => { safeLS.set(ZOOM_KEY, String(dayW)); }, [dayW]);
  useEffect(() => {
    const onResize = () => setSidebarW(window.innerWidth < 700 ? 150 : 280);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Défilement à conserver après un changement de plage / de zoom.
  const pendingScroll = useRef(null);
  useLayoutEffect(() => {
    const s = scroller.current;
    if (s && pendingScroll.current != null) {
      s.scrollLeft = pendingScroll.current;
      pendingScroll.current = null;
    }
  });

  const xOfDay = (day) => (day - range.start) * dayW;
  const cds = useMemo(() => closureDays(closures), [closures]);

  // Jour (fractionnaire) sous un clientX.
  const dayAt = useCallback((clientX) => {
    const s = scroller.current;
    const { range, dayW, sidebarW } = live.current;
    const x = clientX - s.getBoundingClientRect().left + s.scrollLeft - sidebarW;
    return range.start + x / dayW;
  }, []);

  const scrollToDay = useCallback((day, align = 0.25, smooth = true) => {
    const s = scroller.current;
    if (!s) return;
    const { range, dayW, sidebarW } = live.current;
    if (day < range.start + 14 || day > range.start + range.days - 14) {
      // Hors plage : on l'étend d'abord.
      const a = mondayOf(Math.min(range.start, day - 60));
      const b = Math.max(range.start + range.days, day + 120);
      setRange({ start: a, days: Math.ceil((b - a) / 7) * 7 });
      pendingScroll.current = (day - a) * dayW - (s.clientWidth - sidebarW) * align;
      return;
    }
    const left = (day - range.start) * dayW - (s.clientWidth - sidebarW) * align;
    s.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Zoom en gardant fixe le jour sous `anchorX` (px depuis le bord gauche de la frise).
  const zoomTo = useCallback((w, anchorX) => {
    const s = scroller.current;
    const { dayW, range, sidebarW } = live.current;
    const nw = clamp(w, MIN_W, MAX_W);
    if (nw === dayW || !s) return;
    const ax = anchorX ?? (s.clientWidth - sidebarW) / 2;
    const anchorDay = range.start + (s.scrollLeft + ax) / dayW;
    pendingScroll.current = (anchorDay - range.start) * nw - ax;
    setDayW(nw);
  }, []);

  // Ne défile que si le jour est hors de l'écran.
  const revealDay = useCallback((day) => {
    const s = scroller.current;
    const { range, dayW, sidebarW } = live.current;
    const a = range.start + s.scrollLeft / dayW;
    const b = a + (s.clientWidth - sidebarW) / dayW;
    if (day < a + 1 || day > b - 2) scrollToDay(day, 0.2);
  }, [scrollToDay]);

  useImperativeHandle(ref, () => ({
    today: () => scrollToDay(todayDay()),
    zoomIn: () => zoomTo(live.current.dayW * 1.5),
    zoomOut: () => zoomTo(live.current.dayW / 1.5),
    scrollToDay,
    revealDay,
    firstVisibleDay: () => {
      const s = scroller.current;
      return Math.ceil(live.current.range.start + s.scrollLeft / live.current.dayW);
    },
  }), [scrollToDay, zoomTo, revealDay]);

  // Au premier affichage : aujourd'hui vers la gauche de l'écran.
  useLayoutEffect(() => { scrollToDay(today, 0.15, false); }, []);

  // Ctrl/⌘ + molette (et pincement trackpad) = zoom continu.
  useEffect(() => {
    const s = scroller.current;
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const ax = e.clientX - s.getBoundingClientRect().left - live.current.sidebarW;
      // Molette : ~×1.25 par cran ; pincement trackpad : petits deltas, plus fin.
      const step = clamp(-e.deltaY * 0.01, -0.22, 0.22);
      zoomTo(live.current.dayW * Math.exp(step), Math.max(0, ax));
    };
    s.addEventListener("wheel", onWheel, { passive: false });
    return () => s.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  // Étend la plage quand on approche d'un bord.
  const onScroll = () => {
    const s = scroller.current;
    const { range, dayW } = live.current;
    if (s.scrollLeft < 400) {
      const add = Math.ceil(600 / dayW / 7) * 7 + 28;
      pendingScroll.current = s.scrollLeft + add * dayW;
      if (dragRef.current?.kind === "pan") dragRef.current.sl0 += add * dayW;
      setRange({ start: range.start - add, days: range.days + add });
    } else if (s.scrollLeft + s.clientWidth > s.scrollWidth - 400) {
      const add = Math.ceil(600 / dayW / 7) * 7 + 28;
      setRange({ start: range.start, days: range.days + add });
    }
  };

  // ── Lignes : projet, ses tâches, puis la ligne « + » ──
  const rows = useMemo(() => {
    const out = [];
    let y = 0;
    for (const p of projects) {
      const its = tasks.filter((t) => t.project_id === p.id).sort((a, b) => a.position - b.position);
      out.push({ type: "project", key: "p" + p.id, project: p, tasks: its, y });
      y += ROW_H.project;
      if (collapsed.has(p.id)) continue;
      for (const t of its) {
        out.push({ type: "task", key: "t" + t.id, project: p, task: t, y });
        y += ROW_H.task;
      }
      out.push({ type: "add", key: "a" + p.id, project: p, y });
      y += ROW_H.add;
    }
    return { list: out, height: y };
  }, [projects, tasks, collapsed]);

  // ── Glisser-déposer ──────────────────────────────────────────────────
  const [drag, setDrag] = useState(null); // aperçu en cours
  const dragRef = useRef(null);
  const bodyRef = useRef(null);

  const startDrag = (e, d) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const s = scroller.current;
    const info = {
      ...d,
      cx0: e.clientX, cy0: e.clientY,
      sl0: s.scrollLeft, st0: s.scrollTop,
      day0: dayAt(e.clientX),
      moved: false,
      lastX: e.clientX, lastY: e.clientY,
    };
    dragRef.current = info;
    onDragState?.(true);
    if (d.kind !== "pan") setDrag({ ...info, ...computeDrag(info, e.clientX, e.clientY) });

    const move = (ev) => {
      const cur = dragRef.current;
      if (!cur) return;
      cur.lastX = ev.clientX; cur.lastY = ev.clientY;
      if (Math.abs(ev.clientX - cur.cx0) > 3 || Math.abs(ev.clientY - cur.cy0) > 3) cur.moved = true;
      if (cur.kind === "pan") {
        s.scrollLeft = cur.sl0 - (ev.clientX - cur.cx0);
        s.scrollTop = cur.st0 - (ev.clientY - cur.cy0);
        return;
      }
      setDrag({ ...cur, ...computeDrag(cur, ev.clientX, ev.clientY) });
    };

    // Défilement automatique quand on tire une barre contre un bord.
    let raf = 0;
    const loop = () => {
      const cur = dragRef.current;
      if (!cur) return;
      if (cur.kind !== "pan" && cur.moved) {
        const r = s.getBoundingClientRect();
        const { sidebarW } = live.current;
        if (cur.kind === "reorder") {
          if (cur.lastY < r.top + HEADER_H + 30) s.scrollTop -= 10;
          else if (cur.lastY > r.bottom - 30) s.scrollTop += 10;
        } else {
          if (cur.lastX < r.left + sidebarW + 40) s.scrollLeft -= 12;
          else if (cur.lastX > r.right - 40) s.scrollLeft += 12;
        }
        setDrag({ ...cur, ...computeDrag(cur, cur.lastX, cur.lastY) });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const up = (ev) => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const cur = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      onDragState?.(false);
      if (cur && ev.type !== "pointercancel") finishDrag(cur, computeDrag(cur, ev.clientX, ev.clientY));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  // Calcule l'aperçu (dates / position) pour un pointeur donné.
  function computeDrag(d, clientX, clientY) {
    if (d.kind === "pan") return {};
    if (d.kind === "reorder") return { slot: slotAt(clientY, d.task.id) };
    const cur = dayAt(clientX);
    if (d.kind === "create") {
      const a = Math.floor(d.day0), b = Math.floor(cur);
      return { start: Math.min(a, b), end: Math.max(a, b) };
    }
    const delta = Math.round(cur - d.day0);
    if (d.kind === "move-project") return { delta };
    const s0 = toDay(d.task.start), e0 = toDay(d.task.end);
    if (d.kind === "move") return { start: s0 + delta, end: e0 + delta };
    if (d.kind === "resize-l") return { start: Math.min(s0 + delta, e0), end: e0 };
    if (d.kind === "resize-r") return { start: s0, end: Math.max(e0 + delta, s0) };
    return {};
  }

  function finishDrag(d, res) {
    if (d.kind === "pan") { if (!d.moved) onBackgroundClick?.(); return; }
    if (d.kind === "move-project") {
      if (!d.moved) return onSelect({ type: "project", id: d.project.id });
      if (!res.delta) return;
      const its = (allTasks || tasks).filter((t) => t.project_id === d.project.id);
      onPatchTasks?.(its.map((t) => ({
        id: t.id,
        patch: { start: toIso(toDay(t.start) + res.delta), end: toIso(toDay(t.end) + res.delta) },
      })), `Projet « ${d.project.name} » décalé`);
      return;
    }
    if (d.kind === "create") {
      // Simple clic sur la ligne « + » : une tâche d'une semaine.
      const start = d.moved ? res.start : Math.floor(d.day0);
      const end = d.moved ? res.end : start + 4;
      onCreateTask({ project_id: d.project.id, start: toIso(start), end: toIso(end) });
      return;
    }
    if (d.kind === "reorder") {
      if (d.moved && res.slot) onPatchTask(d.task.id, { project_id: res.slot.projectId, position: res.slot.position });
      else if (!d.moved) onSelect({ type: "task", id: d.task.id });
      return;
    }
    if (!d.moved) return onSelect({ type: "task", id: d.task.id });
    const start = toIso(res.start), end = toIso(res.end);
    if (start !== d.task.start || end !== d.task.end) onPatchTask(d.task.id, { start, end });
  }

  // Où tomberait une tâche lâchée à la hauteur clientY ?
  function slotAt(clientY, dragId) {
    const body = bodyRef.current;
    if (!body) return null;
    const y = clientY - body.getBoundingClientRect().top;
    const list = rows.list;
    if (!list.length) return null;
    let row = list.find((r) => y >= r.y && y < r.y + ROW_H[r.type]) || (y < 0 ? list[0] : list[list.length - 1]);
    const p = row.project;
    const siblings = rows.list.filter((r) => r.type === "task" && r.project.id === p.id && r.task.id !== dragId).map((r) => r.task);
    let index, lineY;
    if (row.type === "project") { index = 0; lineY = row.y + ROW_H.project; }
    else if (row.type === "add") { index = siblings.length; lineY = row.y; }
    else {
      const after = y > row.y + ROW_H.task / 2;
      const i = siblings.findIndex((t) => t.id === row.task.id);
      if (row.task.id === dragId) {
        // Au-dessus de sa propre ligne : ne bouge pas.
        const own = rows.list.filter((r) => r.type === "task" && r.project.id === p.id).findIndex((r) => r.task.id === dragId);
        index = own; lineY = row.y;
      } else { index = i + (after ? 1 : 0); lineY = row.y + (after ? ROW_H.task : 0); }
    }
    const prev = siblings[index - 1], next = siblings[index];
    const position = prev && next ? (prev.position + next.position) / 2
      : prev ? prev.position + 1 : next ? next.position - 1 : 0;
    return { projectId: p.id, position, lineY };
  }

  // ── Rendu ────────────────────────────────────────────────────────────
  const width = range.days * dayW;
  const end = range.start + range.days;

  const header = useMemo(() => {
    const top = [], bottom = [];
    // Ligne haute : mois (ou années quand on est très dézoomé).
    const byYear = dayW < 5;
    let d = range.start;
    while (d < end) {
      const p = parts(d);
      const next = byYear ? toDay(`${p.y + 1}-01-01`) : toDay(`${p.m === 11 ? p.y + 1 : p.y}-${String(p.m === 11 ? 1 : p.m + 2).padStart(2, "0")}-01`);
      const a = Math.max(d, range.start), b = Math.min(next, end);
      const raw = byYear ? String(p.y) : dayW * (b - a) > 110 ? `${MONTHS[p.m]} ${p.y}` : MONTHS_SHORT[p.m];
      const label = raw[0].toUpperCase() + raw.slice(1);
      top.push(<div key={"m" + a} className="h-cell h-top" style={{ left: (a - range.start) * dayW, width: (b - a) * dayW }}><span>{label}</span></div>);
      d = next;
    }
    // Ligne basse : jours, semaines ou mois selon le zoom.
    if (dayW >= 20) {
      for (let x = range.start; x < end; x++) {
        const p = parts(x), off = isOff(x), hol = holiday(x);
        bottom.push(
          <div key={x} className={"h-cell h-day" + (off ? " off" : "") + (x === today ? " today" : "")}
            style={{ left: (x - range.start) * dayW, width: dayW }} title={hol ? `${fmtLong(x)} — ${hol}` : fmtLong(x)}>
            {dayW >= 28 && <small>{WEEKDAYS[p.wd]}</small>}
            <span>{p.d}</span>
          </div>,
        );
      }
    } else if (dayW >= 5) {
      for (let x = range.start; x < end; x += 7) {
        const p = parts(x);
        bottom.push(
          <div key={x} className={"h-cell h-week" + (today >= x && today < x + 7 ? " today" : "")}
            style={{ left: (x - range.start) * dayW, width: 7 * dayW }} title={`Semaine ${isoWeek(x)} — ${fmtLong(x)}`}>
            <span>{dayW * 7 >= 60 ? `S${isoWeek(x)} · ${p.d}` : dayW * 7 >= 34 ? `S${isoWeek(x)}` : p.d}</span>
          </div>,
        );
      }
    } else {
      let x = range.start;
      while (x < end) {
        const p = parts(x);
        const next = toDay(`${p.m === 11 ? p.y + 1 : p.y}-${String(p.m === 11 ? 1 : p.m + 2).padStart(2, "0")}-01`);
        const a = Math.max(x, range.start), b = Math.min(next, end);
        bottom.push(<div key={x} className="h-cell h-week" style={{ left: (a - range.start) * dayW, width: (b - a) * dayW }}><span>{MONTHS_SHORT[p.m].slice(0, 3)}</span></div>);
        x = next;
      }
    }
    return { top, bottom };
  }, [range, dayW, today]);

  // Colonnes grisées : week-ends et fériés (seulement si on voit les jours).
  const offCols = useMemo(() => {
    if (dayW < 5) return [];
    const out = [];
    for (let x = range.start; x < end; x++) {
      if (isOff(x)) {
        let y = x;
        while (y + 1 < end && isOff(y + 1)) y++;
        out.push(<div key={x} className={"off-col" + (holiday(x) || holiday(y) ? " hol" : "")} style={{ left: (x - range.start) * dayW, width: (y - x + 1) * dayW }} />);
        x = y;
      }
    }
    return out;
  }, [range, dayW]);

  const gridStyle = {
    width,
    backgroundImage: dayW >= 14
      ? `linear-gradient(to right, var(--grid) 1px, transparent 1px), linear-gradient(to right, var(--grid-strong) 1px, transparent 1px)`
      : `linear-gradient(to right, var(--grid) 1px, transparent 1px)`,
    backgroundSize: dayW >= 14 ? `${dayW}px 100%, ${dayW * 7}px 100%` : `${dayW * 7}px 100%`,
  };

  const preview = drag && drag.kind !== "reorder" && drag.kind !== "pan" && drag.kind !== "create" ? drag : null;
  // Aperçu des dates pendant un glisser : tâche + ses suivantes, ou projet entier.
  const previewMap = useMemo(() => {
    const m = new Map();
    if (!preview || !preview.moved && preview.kind !== "move-project") return m;
    if (preview.kind === "move-project") {
      if (!preview.delta) return m;
      for (const t of allTasks || tasks) if (t.project_id === preview.project.id)
        m.set(t.id, { start: toDay(t.start) + preview.delta, end: toDay(t.end) + preview.delta });
      return m;
    }
    const patch = { start: toIso(preview.start), end: toIso(preview.end) };
    for (const u of cascade(allTasks || tasks, preview.task.id, patch))
      m.set(u.id, { start: toDay(u.patch.start), end: toDay(u.patch.end) });
    return m;
  }, [preview?.kind, preview?.start, preview?.end, preview?.delta, preview?.moved, tasks, allTasks]);
  const datesOf = (t) => previewMap.get(t.id) || { start: toDay(t.start), end: toDay(t.end) };

  // Morceaux de fermeture qui « coupent » un intervalle [s, e] (px relatifs).
  const cutsOf = (s, e) => cds
    .filter((c) => c.b >= s && c.a <= e)
    .map((c) => {
      const a = Math.max(c.a, s), b = Math.min(c.b, e);
      return <span key={c.id} className="cut" style={{ left: (a - s) * dayW, width: (b - a + 1) * dayW }} title={c.label || "Fermeture"} />;
    });

  const renderBar = (t, p) => {
    const isPrev = previewMap.has(t.id);
    const { start: s, end: e } = datesOf(t);
    const x = xOfDay(s), w = (e - s + 1) * dayW;
    const sel = selected?.type === "task" && selected.id === t.id;
    const style = barStyle(t, p, colorMode);
    const title = t.title || "Sans titre";
    const extra = [
      t.time && t.kind === "milestone" ? `à ${t.time}` : "",
      t.validation_days && t.kind !== "milestone" ? `+ ${t.validation_days} j de validation client` : "",
      t.lead_days ? `à caler : ${t.lead_days} j avant` : "",
    ].filter(Boolean).join(" · ");
    const tip = `${title}\n${fmtShort(s)} → ${fmtShort(e)} · ${e - s + 1} j (${workingDays(s, e, cds)} ouvrés)\n${assigneeLabel(t.assignee)}${extra ? "\n" + extra : ""}${t.note ? "\n\n" + t.note : ""}`;
    // « À caler » : pointillé avant la tâche.
    const lead = t.lead_days > 0 && !t.done ? (
      <span className="lead" style={{ left: x - t.lead_days * dayW, width: t.lead_days * dayW, "--bc": style["--bc"] }}
        title={`À caler dès que possible (${t.lead_days} j avant)`}><i>à caler</i></span>
    ) : null;

    if (t.kind === "milestone") {
      const size = 18;
      return (
        <>
          {lead}
          <div className={"milestone" + (sel ? " sel" : "") + (t.done ? " done" : "") + (isPrev ? " dragging" : "")}
            style={{ left: x + dayW / 2 - size / 2 }} title={tip}
            onPointerDown={(ev) => startDrag(ev, { kind: "move", task: t })}>
            <span className="diamond" style={{ background: style.background }} />
            <span className="ms-label">{t.done && "✓ "}{title}{t.time && <small className="ms-time">{t.time}</small>}<Avatars assignee={t.assignee} size={15} /></span>
          </div>
        </>
      );
    }

    const inside = w > title.length * 7 + (t.assignee ? 40 : 18);
    const vd = t.validation_days || 0;
    return (
      <>
      {lead}
      {vd > 0 && (
        <span className={"trail" + (t.done ? " done" : "")} style={{ left: x + w, width: vd * dayW, "--bc": style["--bc"] }}
          title={`Validation client : ${vd} j (jusqu'au ${fmtShort(e + vd)})`}>
          {vd * dayW > 70 && <i>validation</i>}
        </span>
      )}
      <div className={"bar" + (sel ? " sel" : "") + (t.done ? " done" : "") + (isPrev ? " dragging" : "")}
        style={{ left: x, width: w, ...style }} title={isPrev ? undefined : tip}
        onPointerDown={(ev) => startDrag(ev, { kind: "move", task: t })}>
        {cutsOf(s, e)}
        <span className="grip l" onPointerDown={(ev) => startDrag(ev, { kind: "resize-l", task: t })} />
        {inside && (
          <span className="bar-in">
            {colorMode === "project" ? <Avatars assignee={t.assignee} size={16} /> : <span className="pdot" style={{ background: p.color }} />}
            <span className="bar-title">{t.done && "✓ "}{title}</span>
            {t.note && <NoteIcon />}
          </span>
        )}
        <span className="grip r" onPointerDown={(ev) => startDrag(ev, { kind: "resize-r", task: t })} />
        {!inside && (
          <span className="bar-out" style={{ left: w + 6 + vd * dayW }}>
            {colorMode === "project" && <Avatars assignee={t.assignee} size={15} />}
            {t.done && "✓ "}{title}{t.note && <NoteIcon />}
          </span>
        )}
        {isPrev && drag?.task?.id === t.id && drag.moved && (
          <span className="drag-tip">{fmtShort(s)} → {fmtShort(e)} · {e - s + 1} j</span>
        )}
      </div>
      </>
    );
  };

  const onBgDown = (e) => {
    if (e.pointerType === "touch") return; // au doigt : défilement natif
    startDrag(e, { kind: "pan" });
  };

  const reorderLine = drag?.kind === "reorder" && drag.moved && drag.slot ? drag.slot.lineY : null;

  return (
    <div className={"gantt" + (drag ? " is-dragging drag-" + drag.kind : "")} ref={scroller} onScroll={onScroll}
      style={{ "--sidebar": sidebarW + "px", "--dayw": dayW + "px" }}>
      <div className="g-inner" style={{ width: sidebarW + width }}>
        {/* En-tête */}
        <div className="g-head" style={{ height: HEADER_H }}>
          <div className="g-corner" style={{ width: sidebarW }}>
            <span>{projects.length} projet{projects.length > 1 ? "s" : ""}</span>
          </div>
          <div className="g-scale" style={{ width }}>
            <div className="h-row top">{header.top}</div>
            <div className="h-row bottom">{header.bottom}</div>
            {today >= range.start && today < end && (
              <div className="h-today" style={{ left: xOfDay(today) + dayW / 2 }} />
            )}
          </div>
        </div>

        {/* Corps */}
        <div className="g-body" ref={bodyRef} style={{ minHeight: rows.height + 40 }}>
          <div className="g-sidefill" style={{ width: sidebarW }} />
          <div className="g-grid" style={{ left: sidebarW, ...gridStyle }} onPointerDown={onBgDown}>
            {offCols}
            {cds.filter((c) => c.b >= range.start && c.a < end).map((c) => (
              <div key={c.id} className="closure-col" style={{ left: xOfDay(c.a), width: (c.b - c.a + 1) * dayW }}
                title={`${c.label || "Fermeture de l'agence"} : ${fmtShort(c.a)} → ${fmtShort(c.b)}`}>
                {(c.b - c.a + 1) * dayW > 50 && <span>{c.label || "Fermeture"}</span>}
              </div>
            ))}
            {today >= range.start && today < end && <div className="today-line" style={{ left: xOfDay(today) + dayW / 2 }} />}
          </div>

          {rows.list.map((r) => {
            if (r.type === "project") {
              const p = r.project;
              const isCol = collapsed.has(p.id);
              const its = r.tasks;
              const sel = selected?.type === "project" && selected.id === p.id;
              let span = null;
              if (its.length) {
                const a = Math.min(...its.map((t) => datesOf(t).start - (t.done ? 0 : t.lead_days || 0)));
                const b = Math.max(...its.map((t) => datesOf(t).end + (t.kind === "milestone" ? 0 : t.validation_days || 0)));
                span = { a, b };
              }
              const prospect = p.status === "prospect";
              return (
                <div key={r.key} className={"row row-project" + (prospect ? " prospect" : "")} style={{ top: r.y, height: ROW_H.project }}>
                  <div className={"label label-project" + (sel ? " sel" : "")} style={{ width: sidebarW }}>
                    <button className="chev" onClick={() => onToggleCollapse(p.id)} aria-label={isCol ? "Déplier" : "Replier"}>
                      <svg width="12" height="12" viewBox="0 0 12 12" style={{ transform: isCol ? "rotate(-90deg)" : "none" }}><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                    <button className="pname" onClick={() => onSelect({ type: "project", id: p.id })} title="Modifier le projet">
                      <span className="pdot lg" style={{ background: p.color }} />
                      <span className="ptext">{p.name}</span>
                      {prospect && <span className="tag prospect">prospect</span>}
                      {p.archived && <span className="tag">archivé</span>}
                    </button>
                    <span className="porder">
                      <button onClick={() => onMoveProject?.(p.id, -1)} title="Monter le projet" aria-label="Monter">▲</button>
                      <button onClick={() => onMoveProject?.(p.id, 1)} title="Descendre le projet" aria-label="Descendre">▼</button>
                    </span>
                    <button className="padd pview" onClick={() => onOpenProject?.(p.id)} title="Vue détail du projet" aria-label="Vue détail">
                      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8.5 1.5h4v4M12.5 1.5 7.5 6.5M5.5 2.5h-3v9h9v-3" /></svg>
                    </button>
                    <span className="pcount">{its.length}</span>
                    <button className="padd" onClick={() => onQuickAdd(p.id)} title="Ajouter une tâche">+</button>
                  </div>
                  {span && (
                    <div className="summary" onPointerDown={(ev) => { if (ev.pointerType === "touch") return; startDrag(ev, { kind: "move-project", project: p }); }}
                      style={{ left: sidebarW + xOfDay(span.a), width: (span.b - span.a + 1) * dayW, "--pc": p.color }}
                      title={`${p.name} : ${fmtShort(span.a)} → ${fmtShort(span.b)}\nGlisser pour décaler tout le projet`}>
                      {drag?.kind === "move-project" && drag.project.id === p.id && drag.moved && (
                        <span className="drag-tip">{drag.delta > 0 ? "+" : ""}{drag.delta} j</span>
                      )}
                    </div>
                  )}
                </div>
              );
            }
            if (r.type === "task") {
              const t = r.task;
              const sel = selected?.type === "task" && selected.id === t.id;
              const isDragged = drag?.kind === "reorder" && drag.task.id === t.id && drag.moved;
              return (
                <div key={r.key} className={"row row-task" + (isDragged ? " ghosted" : "") + (sel ? " row-sel" : "") + (r.project.status === "prospect" ? " prospect" : "")} style={{ top: r.y, height: ROW_H.task }}>
                  <div className={"label label-task" + (sel ? " sel" : "")} style={{ width: sidebarW }}
                    onClick={() => { onSelect({ type: "task", id: t.id }); revealDay(toDay(t.start)); }}>
                    <span className="handle" title="Glisser pour réordonner"
                      onPointerDown={(ev) => startDrag(ev, { kind: "reorder", task: t })}>
                      <svg width="8" height="14" viewBox="0 0 8 14"><g fill="currentColor">{[2, 7, 12].map((cy) => <React.Fragment key={cy}><circle cx="2" cy={cy} r="1.2" /><circle cx="6" cy={cy} r="1.2" /></React.Fragment>)}</g></svg>
                    </span>
                    {t.kind === "milestone" && <span className="ms-mini" style={{ background: r.project.color }} />}
                    {t.after_id && <span className="link-ico" title="Suit une autre tâche (se décale avec elle)">↳</span>}
                    <span className={"ttext" + (t.title ? "" : " empty") + (t.done ? " done" : "")}>{t.title || "Sans titre"}</span>
                    <Avatars assignee={t.assignee} size={17} />
                  </div>
                  <div className="track" style={{ left: sidebarW, width }}>{renderBar(t, r.project)}</div>
                </div>
              );
            }
            // Ligne « + » : cliquer ou glisser pour créer.
            const p = r.project;
            const creating = drag?.kind === "create" && drag.project.id === p.id;
            return (
              <div key={r.key} className="row row-add" style={{ top: r.y, height: ROW_H.add }}>
                <div className="label label-add" style={{ width: sidebarW }} onClick={() => onQuickAdd(p.id)}>
                  <span>+ Ajouter une tâche</span>
                </div>
                <div className="track add-track" style={{ left: sidebarW, width, "--pc": p.color }}
                  onPointerDown={(ev) => startDrag(ev, { kind: "create", project: p })}
                  onPointerMove={(ev) => { if (!drag) ev.currentTarget.style.setProperty("--hx", Math.floor(dayAt(ev.clientX) - range.start) * dayW + "px"); }}>
                  <span className="add-hint" />
                  {creating && (
                    <div className="bar creating" style={{ left: xOfDay(drag.start), width: (drag.end - drag.start + 1) * dayW, background: p.color, color: inkOn(p.color) }}>
                      <span className="drag-tip">{fmtShort(drag.start)} → {fmtShort(drag.end)} · {drag.end - drag.start + 1} j</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          <Links rows={rows.list} datesOf={datesOf} xOfDay={xOfDay} dayW={dayW} left={sidebarW} width={width} height={rows.height} />

          {reorderLine != null && <div className="reorder-line" style={{ top: reorderLine - 1, width: sidebarW + width }} />}
        </div>
      </div>
    </div>
  );
});

// Flèches des liens « B suit A » : de la fin (validation comprise) de A au début de B.
function Links({ rows, datesOf, xOfDay, dayW, left, width, height }) {
  const pos = new Map();
  for (const r of rows) if (r.type === "task") pos.set(r.task.id, { r, y: r.y + ROW_H.task / 2 });
  const paths = [];
  for (const [id, { r, y }] of pos) {
    const t = r.task;
    const from = t.after_id && pos.get(t.after_id);
    if (!from) continue;
    const pt = from.r.task;
    const pe = datesOf(pt).end + 1 + (pt.kind === "milestone" ? 0 : pt.validation_days || 0);
    const x1 = pt.kind === "milestone" ? xOfDay(datesOf(pt).start) + dayW / 2 + 9 : xOfDay(pe);
    const x2 = t.kind === "milestone" ? xOfDay(datesOf(t).start) + dayW / 2 - 9 : xOfDay(datesOf(t).start);
    const y1 = from.y, y2 = y;
    const mx = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 14));
    const d = x2 - 6 >= x1 + 8
      ? `M${x1},${y1} H${mx} V${y2} H${x2 - 2}`
      : `M${x1},${y1} h8 V${(y1 + y2) / 2} H${x2 - 14} V${y2} H${x2 - 2}`;
    paths.push(<path key={id} d={d} />);
  }
  if (!paths.length) return null;
  return (
    <svg className="links" style={{ left, width, height }} width={width} height={height}>
      <defs>
        <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
        </marker>
      </defs>
      <g markerEnd="url(#arrow)">{paths}</g>
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg className="note-ico" width="12" height="12" viewBox="0 0 12 12" aria-label="Note">
      <path d="M2 2.5h8v5.5H5.5L3 10V8H2z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export default Gantt;
