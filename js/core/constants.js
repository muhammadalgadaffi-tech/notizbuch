// Feste Auswahllisten. Themen dienen auch als Vorschläge der Analyse.

export const THEMEN = ['Schule', 'Freunde', 'Familie', 'Training', 'Motivation', 'Stress', 'Ziele', 'Gesundheit'];
export const KATEGORIEN = [...THEMEN, 'Sonstiges'];
export const STIMMUNGEN = ['gut', 'motiviert', 'ruhig', 'neutral', 'müde', 'angespannt', 'unwohl', 'traurig', 'genervt'];

export const AUTO_LOCK_OPTIONS = [
  { value: 0, label: 'Sofort' },
  { value: 1, label: 'Nach 1 Minute' },
  { value: 5, label: 'Nach 5 Minuten' },
  { value: 15, label: 'Nach 15 Minuten' },
  { value: 60, label: 'Nach 1 Stunde' },
];
