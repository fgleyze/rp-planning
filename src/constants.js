// ── Personnes, couleurs de projet et phases de mission ────────────────────

export const PEOPLE = {
  francois: { name: "François", initial: "F", color: "#1F5FA8" },
  guillaume: { name: "Guillaume", initial: "G", color: "#E08A00" },
};
export const ASSIGNEE_OPTIONS = [
  { value: "francois", label: "François" },
  { value: "guillaume", label: "Guillaume" },
  { value: "both", label: "Les deux" },
  { value: "", label: "Personne" },
];
export const assigneeLabel = (a) => ASSIGNEE_OPTIONS.find((o) => o.value === a)?.label || "Personne";
// Qui figure dans une assignation (pour filtrer / afficher les pastilles).
export const assigneesOf = (a) => (a === "both" ? ["francois", "guillaume"] : a ? [a] : []);

// Palette des projets : couleurs vives, choisies pour rester distinctes
// pour un daltonien deutéranope (base Okabe-Ito / Paul Tol).
export const PROJECT_COLORS = [
  "#009E73", // vert bleuté
  "#D55E00", // vermillon
  "#0072B2", // bleu
  "#E69F00", // orange
  "#AA4499", // magenta
  "#56B4E9", // ciel
  "#CC79A7", // rose
  "#44AA99", // turquoise
  "#882255", // vin
  "#332288", // indigo
  "#F0E442", // jaune
  "#5A5A5A", // gris
];

// Texte blanc ou encre selon la luminance de la couleur de fond.
export function inkOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.33 ? "#1d1d1b" : "#ffffff";
}

// Phases usuelles d'une mission (raccourcis dans le panneau de tâche).
export const PHASES = ["Relevé", "Diagnostic", "ESQ", "APS", "APD", "PC", "DP", "PRO", "DCE", "ACT", "VISA", "DET", "Chantier", "AOR", "Réunion", "Rendu"];

// Phase d'une tâche : études ou chantier. Vide = déduit de l'intitulé.
const CHANTIER_RE = /chantier|\b(det|aor|opc|visa|act|r[ée]ception|ex[ée]cution|travaux)\b/i;
export const stageOf = (t) => t.stage || (CHANTIER_RE.test(t.title || "") ? "chantier" : "etudes");
export const STAGE_LABEL = { etudes: "Études", chantier: "Chantier" };

// Fin « effective » d'une tâche, traîne de validation comprise (en jours).
export const effEnd = (t, toDay) => toDay(t.end) + (t.kind === "milestone" ? 0 : t.validation_days || 0);
