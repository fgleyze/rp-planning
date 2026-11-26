// ── Vue détail d'un projet : phase études / phase chantier, semaines de
// production et de chantier, emplacement du futur planning de chantier, et
// export imprimable pour le client.
import React, { useEffect, useState } from "react";
import { stageOf, STAGE_LABEL, assigneeLabel } from "./constants.js";
import { toDay, fmtShort, fmtLong, mondayOf, isoWeek, isOff, parts, MONTHS_SHORT, todayDay } from "./dates.js";
import { closureDays, inClosure, closuresFor } from "./logic.js";

// Semaines (lundis) où au moins un jour ouvré est couvert par une tâche.
function productionWeeks(tasks, cds) {
  const weeks = new Set();
  for (const t of tasks) {
    if (t.kind === "milestone") continue;
    for (let d = toDay(t.start); d <= toDay(t.end); d++) {
      if (!isOff(d) && !inClosure(d, closuresFor(cds, t))) weeks.add(mondayOf(d));
    }
  }
  return weeks.size;
}

function spanOf(tasks) {
  if (!tasks.length) return null;
  const a = Math.min(...tasks.map((t) => toDay(t.start)));
  const b = Math.max(...tasks.map((t) => toDay(t.end) + (t.kind === "milestone" ? 0 : t.validation_days || 0)));
  return { a, b, weeks: Math.round((mondayOf(b) - mondayOf(a)) / 7) + 1 };
}

// Frise simple en semaines pour une liste de tâches.
function Timeline({ tasks, color, cds }) {
  const span = spanOf(tasks);
  if (!span) return <p className="hint">Aucune tâche dans cette phase.</p>;
  const a = mondayOf(span.a), b = mondayOf(span.b) + 6;
  const total = b - a + 1;
  const pct = (d) => ((d - a) / total) * 100;
  const weeks = [];
  for (let w = a; w <= b; w += 7) weeks.push(w);
  const today = todayDay();
  return (
    <div className="pv-timeline">
      <div className="pv-weeks">
        <div className="pv-lab" />
        <div className="pv-track">
          {weeks.map((w) => (
            <div key={w} className="pv-week" style={{ left: pct(w) + "%", width: (700 / total) + "%" }}
              title={`Semaine ${isoWeek(w)} — ${fmtLong(w)}`}>
              {weeks.length <= 40 || isoWeek(w) % 2 ? <span>S{isoWeek(w)}</span> : null}
            </div>
          ))}
          {weeks.filter((w, i) => i === 0 || parts(w).m !== parts(w - 7).m).map((w) => (
            <div key={"m" + w} className="pv-month" style={{ left: pct(w) + "%" }}>{MONTHS_SHORT[parts(w).m]} {parts(w).y}</div>
          ))}
        </div>
      </div>
      {tasks.map((t) => {
        const s = toDay(t.start), e = toDay(t.end), vd = t.kind === "milestone" ? 0 : t.validation_days || 0;
        return (
          <div key={t.id} className="pv-row">
            <div className="pv-lab" title={t.note || ""}>
              <b>{t.title || "Sans titre"}</b>
              <small>{t.kind === "milestone" ? `${fmtShort(s)}${t.time ? " · " + t.time : ""}` : `${fmtShort(s)} → ${fmtShort(e)}`} · {assigneeLabel(t.assignee)}</small>
            </div>
            <div className="pv-track">
              {closuresFor(cds, t).filter((c) => c.b >= a && c.a <= b).map((c) => (
                <div key={c.id} className="pv-closure" style={{ left: pct(Math.max(c.a, a)) + "%", width: ((Math.min(c.b, b) - Math.max(c.a, a) + 1) / total) * 100 + "%" }} />
              ))}
              {today >= a && today <= b && <div className="pv-today" style={{ left: pct(today) + "%" }} />}
              {t.kind === "milestone" ? (
                <span className="pv-ms" style={{ left: `calc(${pct(s + 0.5)}% - 7px)`, background: color }} />
              ) : (
                <>
                  <span className={"pv-bar" + (t.done ? " done" : "")} style={{ left: pct(s) + "%", width: ((e - s + 1) / total) * 100 + "%", background: color }} />
                  {vd > 0 && <span className="pv-trail" style={{ left: pct(e + 1) + "%", width: (vd / total) * 100 + "%", "--bc": color }} />}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ProjectView({ project, tasks, closures, onClose, onSelectTask }) {
  const [notes, setNotes] = useState(false);
  const cds = closureDays(closures);
  const its = tasks.filter((t) => t.project_id === project.id).sort((a, b) => a.start.localeCompare(b.start) || a.position - b.position);
  const byStage = { etudes: its.filter((t) => stageOf(t) === "etudes"), chantier: its.filter((t) => stageOf(t) === "chantier") };

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="pv-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pv" role="dialog" aria-label={`Projet ${project.name}`}>
        <header className="pv-head">
          <span className="pdot lg" style={{ background: project.color }} />
          <h2>{project.name}</h2>
          {project.status === "prospect" && <span className="tag prospect">prospect</span>}
          <div className="tb-spacer" />
          <label className="check"><input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} /><span>Notes dans l'export</span></label>
          <button className="btn primary" onClick={() => exportForClient(project, its, closures, notes)}>Exporter pour le client</button>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <svg width="16" height="16" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </header>

        <div className="pv-body">
          <div className="pv-cards">
            {["etudes", "chantier"].map((k) => {
              const sp = spanOf(byStage[k]);
              return (
                <div key={k} className="pv-card">
                  <h3>Phase {STAGE_LABEL[k].toLowerCase()}</h3>
                  {sp ? (
                    <>
                      <div className="pv-big">{productionWeeks(byStage[k], cds)} <small>semaine{productionWeeks(byStage[k], cds) > 1 ? "s" : ""} {k === "etudes" ? "de production" : "de chantier"}</small></div>
                      <div className="hint">{fmtShort(sp.a)} → {fmtShort(sp.b)} · étalé sur {sp.weeks} semaine{sp.weeks > 1 ? "s" : ""}</div>
                    </>
                  ) : <div className="hint">Pas encore planifiée.</div>}
                </div>
              );
            })}
          </div>

          {["etudes", "chantier"].map((k) => (
            <section key={k} className="pv-section">
              <h3>{STAGE_LABEL[k]}</h3>
              <Timeline tasks={byStage[k]} color={project.color} cds={cds} />
            </section>
          ))}

          <section className="pv-section pv-future">
            <h3>Planning de chantier <span className="tag">bientôt</span></h3>
            <p className="hint">Ici viendront les interventions par entreprise (gros œuvre, charpente, menuiseries…), une ligne par lot, pendant la phase chantier.</p>
          </section>
          <p className="hint">Astuce : la phase (études / chantier) d'une tâche se règle dans son panneau ; par défaut elle est déduite de l'intitulé (Chantier, DET, AOR, VISA… = chantier).</p>
        </div>
      </div>
    </div>
  );
}

// ── Export client : page imprimable (Enregistrer en PDF) ──────────────────
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function exportForClient(project, tasks, closures, withNotes) {
  const cds = closureDays(closures);
  const row = (t) => {
    const s = toDay(t.start), e = toDay(t.end);
    const when = t.kind === "milestone"
      ? `${fmtLong(s)}${t.time ? " à " + t.time.replace(":", "h") : ""}`
      : `du ${fmtLong(s)} au ${fmtLong(e)}`;
    const vd = t.kind !== "milestone" && t.validation_days ? `<div class="sub">puis ${t.validation_days} jours de validation de votre part (jusqu'au ${fmtLong(e + t.validation_days)})</div>` : "";
    const note = withNotes && t.note ? `<div class="sub">${esc(t.note).replace(/\n/g, "<br>")}</div>` : "";
    return `<tr class="${t.kind}"><td class="t">${t.kind === "milestone" ? "◆ " : ""}${esc(t.title || "—")}${vd}${note}</td><td>${when}</td></tr>`;
  };
  const section = (k) => {
    const list = tasks.filter((t) => stageOf(t) === k && t.kind !== "milestone");
    if (!list.length) return "";
    return `<h2>${STAGE_LABEL[k]}</h2><table>${list.map(row).join("")}</table>`;
  };
  const meetings = tasks.filter((t) => t.kind === "milestone");
  const closuresTxt = cds.filter((c) => !c.who && tasks.some((t) => toDay(t.end) >= c.a && toDay(t.start) <= c.b));
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Planning — ${esc(project.name)}</title>
<style>
  @page { margin: 18mm 16mm; }
  body { font: 11pt/1.45 Georgia, "EB Garamond", serif; color: #1d1d1b; max-width: 760px; margin: 32px auto; padding: 0 16px; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid ${project.color}; padding-bottom: 10px; margin-bottom: 18px; }
  h1 { font-size: 24pt; margin: 0; font-weight: 600; }
  .brand { font: 600 10pt system-ui, sans-serif; color: #55554f; text-align: right; }
  h2 { font-size: 14pt; margin: 22px 0 6px; color: #2E5932; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 7px 8px; border-bottom: 1px solid #e4e3da; vertical-align: top; font-family: system-ui, sans-serif; font-size: 10pt; }
  td.t { width: 45%; font-weight: 600; }
  tr.milestone td { background: #f7f5ee; }
  .sub { font-weight: 400; color: #55554f; font-size: 9pt; margin-top: 2px; }
  .muted { color: #8a8a82; font: 9pt system-ui, sans-serif; margin-top: 28px; }
  .print { position: fixed; top: 12px; right: 12px; font: 600 10pt system-ui; padding: 8px 14px; border-radius: 8px; border: 0; background: #2E5932; color: #fff; cursor: pointer; }
  @media print { .print { display: none; } body { margin: 0; } }
</style></head><body>
<button class="print" onclick="window.print()">Imprimer / PDF</button>
<header><div><div class="brand" style="text-align:left">Planning prévisionnel</div><h1>${esc(project.name)}</h1></div>
<div class="brand">Racines &amp; Perspectives<br><span style="font-weight:400">édité le ${esc(fmtLong(todayDay()))}</span></div></header>
${meetings.length ? `<h2>Réunions et rendus</h2><table>${meetings.map(row).join("")}</table>` : ""}
${section("etudes")}${section("chantier")}
${closuresTxt.length ? `<h2>Fermetures de l'agence</h2><table>${closuresTxt.map((c) => `<tr><td class="t">${esc(c.label || "Fermeture")}</td><td>du ${fmtLong(c.a)} au ${fmtLong(c.b)}</td></tr>`).join("")}</table>` : ""}
<p class="muted">Planning indicatif, susceptible d'évoluer selon les validations, l'instruction des autorisations et les aléas de chantier.</p>
</body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("Le navigateur a bloqué la fenêtre d'export : autorise les fenêtres pour ce site."); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
