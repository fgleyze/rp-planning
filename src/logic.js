// ── Logique du planning : liens entre tâches, fermetures ──────────────────
import { toDay, toIso } from "./dates.js";
import { effEnd } from "./constants.js";

// Décalage en cascade par liens explicites (« B suit A », champ after_id) :
// quand la fin effective de A bouge de N jours (traîne de validation comprise),
// toutes les tâches qui la suivent — et celles qui les suivent… — bougent de N.
// Renvoie la liste des mises à jour [{ id, patch }], la tâche modifiée en tête.
export function cascade(tasks, id, patch) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const old = byId.get(id);
  if (!old) return [];
  const next = { ...old, ...patch };
  const out = [{ id, patch }];
  const delta = effEnd(next, toDay) - effEnd(old, toDay);
  // Une tâche re-liée à un autre prédécesseur ne déclenche pas de cascade.
  if (!delta) return out;
  const children = new Map();
  for (const t of tasks) {
    if (!t.after_id) continue;
    if (!children.has(t.after_id)) children.set(t.after_id, []);
    children.get(t.after_id).push(t);
  }
  const seen = new Set([id]);
  const queue = [...(children.get(id) || [])];
  while (queue.length) {
    const t = queue.shift();
    if (seen.has(t.id)) continue; // protège des boucles
    seen.add(t.id);
    out.push({ id: t.id, patch: { start: toIso(toDay(t.start) + delta), end: toIso(toDay(t.end) + delta) } });
    queue.push(...(children.get(t.id) || []));
  }
  return out;
}

// Vrai si lier `id` après `predId` créerait une boucle.
export function wouldLoop(tasks, id, predId) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let cur = predId;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    if (cur === id) return true;
    seen.add(cur);
    cur = byId.get(cur)?.after_id;
  }
  return false;
}

// Fermetures de l'agence en numéros de jour, triées.
export const closureDays = (closures) =>
  closures.map((c) => ({ ...c, a: toDay(c.start), b: toDay(c.end) })).sort((x, y) => x.a - y.a);

export const inClosure = (day, cds) => cds.some((c) => day >= c.a && day <= c.b);

// Une fermeture s'applique-t-elle à une tâche ?
// Agence ('') : toujours. Perso : seulement si toutes les personnes assignées
// sont absentes (une tâche « les deux » n'est pas coupée par l'absence d'un seul).
export function appliesTo(c, task) {
  if (!c.who) return true;
  const who = task.assignee === "both" ? ["francois", "guillaume"] : task.assignee ? [task.assignee] : [];
  return who.length > 0 && who.every((w) => w === c.who);
}
export const closuresFor = (cds, task) => cds.filter((c) => appliesTo(c, task));
