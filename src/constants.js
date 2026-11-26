// ── Personnes, couleurs de projet et phases de mission ────────────────────

export const PEOPLE = {
  francois: { name: "François", initial: "F", color: "#24324A" },
  guillaume: { name: "Guillaume", initial: "G", color: "#C98A1B" },
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

// Palette des projets : tons terre, lisibles sur fond crème.
export const PROJECT_COLORS = [
  "#2E5932", // vert R&P
  "#9A451C", // rouille R&P
  "#3F6C8A", // bleu ardoise
  "#B7862C", // ocre
  "#7A4B6E", // prune
  "#6F8F4E", // sauge
  "#C4623D", // terre cuite
  "#2F7F7A", // canard
  "#8A5A3C", // noyer
  "#5B5F97", // lavande
  "#A33B4E", // bordeaux
  "#55595F", // ardoise
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
