// ── Dates : on travaille en « numéro de jour » UTC pour éviter les pièges
// de l'heure d'été. Une date "YYYY-MM-DD" <-> un entier (jours depuis 1970).

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, "0");

export const toDay = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
};
export const toIso = (day) => {
  const dt = new Date(day * DAY);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};
export const todayDay = () => {
  const n = new Date();
  return Math.round(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY);
};
export const parts = (day) => {
  const dt = new Date(day * DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate(), wd: dt.getUTCDay() };
};
// Lundi de la semaine contenant `day` (le 1/1/1970 était un jeudi).
export const mondayOf = (day) => day - ((day + 3) % 7);
export const isWeekend = (day) => { const w = (day + 4) % 7; return w === 0 || w === 6; };

// Numéro de semaine ISO.
export function isoWeek(day) {
  const thursday = mondayOf(day) + 3;
  const y = parts(thursday).y;
  return Math.floor((thursday - toDay(`${y}-01-01`)) / 7) + 1;
}

export const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export const WEEKDAYS = ["D", "L", "M", "M", "J", "V", "S"];
export const WEEKDAYS_LONG = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

export const fmtShort = (day) => { const p = parts(day); return `${p.d} ${MONTHS_SHORT[p.m]}`; };
export const fmtLong = (day) => { const p = parts(day); return `${WEEKDAYS_LONG[p.wd]} ${p.d} ${MONTHS[p.m]} ${p.y}`; };

// ── Jours fériés français (métropole) ─────────────────────────────────────
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return toDay(`${y}-${pad(month)}-${pad(day)}`);
}
const holidayCache = new Map();
function holidaysOf(y) {
  if (holidayCache.has(y)) return holidayCache.get(y);
  const e = easter(y);
  const map = new Map([
    [toDay(`${y}-01-01`), "Jour de l'an"],
    [e + 1, "Lundi de Pâques"],
    [toDay(`${y}-05-01`), "Fête du Travail"],
    [toDay(`${y}-05-08`), "Victoire 1945"],
    [e + 39, "Ascension"],
    [e + 50, "Lundi de Pentecôte"],
    [toDay(`${y}-07-14`), "Fête nationale"],
    [toDay(`${y}-08-15`), "Assomption"],
    [toDay(`${y}-11-01`), "Toussaint"],
    [toDay(`${y}-11-11`), "Armistice"],
    [toDay(`${y}-12-25`), "Noël"],
  ]);
  holidayCache.set(y, map);
  return map;
}
export const holiday = (day) => holidaysOf(parts(day).y).get(day) || null;
export const isOff = (day) => isWeekend(day) || !!holiday(day);

// Jours ouvrés entre deux jours inclus (hors fermetures de l'agence si
// `cds` = [{ a, b }] est fourni).
export function workingDays(a, b, cds = []) {
  let n = 0;
  for (let d = a; d <= b; d++) if (!isOff(d) && !cds.some((c) => d >= c.a && d <= c.b)) n++;
  return n;
}
