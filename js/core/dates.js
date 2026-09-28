// Datums- und Zeitangaben auf Deutsch.

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const pad = (n) => String(n).padStart(2, '0');
export const toDate = (v) => (v instanceof Date ? v : new Date(v));

export function startOfDay(d) {
  const x = toDate(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate());
}

export function dayKey(d) {
  const x = toDate(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

/** Ganze Kalendertage zwischen a und b (b später → positiv). */
export function dayDiff(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
}

export const fmtTime = (d) => { const x = toDate(d); return `${pad(x.getHours())}:${pad(x.getMinutes())}`; };

export function fmtDateNumeric(d, withYear = true) {
  const x = toDate(d);
  return `${pad(x.getDate())}.${pad(x.getMonth() + 1)}.${withYear ? x.getFullYear() : ''}`;
}

export function fmtDateLong(d, now = new Date()) {
  const x = toDate(d);
  const year = x.getFullYear() !== now.getFullYear() ? ` ${x.getFullYear()}` : '';
  return `${WEEKDAYS[x.getDay()]}, ${x.getDate()}. ${MONTHS[x.getMonth()]}${year}`;
}

/** Überschrift für einen Tag: „Heute“, „Gestern“ oder „Mittwoch, 24. September“. */
export function fmtDayTitle(d, now = new Date()) {
  const diff = dayDiff(d, now);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Gestern';
  return fmtDateLong(d, now);
}

/** Kurze Angabe für Listen: „heute“, „gestern“, „Mi, 24.09.“ */
export function fmtShortDay(d, now = new Date()) {
  const x = toDate(d);
  const diff = dayDiff(x, now);
  if (diff === 0) return 'heute';
  if (diff === 1) return 'gestern';
  const withYear = x.getFullYear() !== now.getFullYear();
  return `${WEEKDAYS_SHORT[x.getDay()]}, ${fmtDateNumeric(x, withYear)}`;
}

/** „vor 3 Tagen“, „vor 2 Wochen“ – bezogen auf Kalendertage. */
export function fmtAgoDays(d, now = new Date()) {
  const diff = dayDiff(d, now);
  if (diff < 0) return 'später';
  if (diff === 0) return 'heute';
  if (diff === 1) return 'gestern';
  if (diff < 14) return `vor ${diff} Tagen`;
  if (diff < 60) return `vor ${Math.round(diff / 7)} Wochen`;
  if (diff < 365) return `vor ${Math.round(diff / 30)} Monaten`;
  const y = Math.round(diff / 365);
  return y === 1 ? 'vor einem Jahr' : `vor ${y} Jahren`;
}

/** Zeitangabe für das Modell – bereits ausgerechnet, damit es nicht selbst rechnen muss. */
export function fmtForModel(d, now = new Date()) {
  const x = toDate(d);
  const full = `${WEEKDAYS[x.getDay()]}, ${fmtDateNumeric(x)}, ${fmtTime(x)} Uhr`;
  const diff = dayDiff(x, now);
  if (diff === 0) return `heute (${full})`;
  if (diff === 1) return `gestern (${full})`;
  return `${fmtAgoDays(x, now)} (${full})`;
}

export function fmtNowForModel(now = new Date()) {
  return `${WEEKDAYS[now.getDay()]}, ${fmtDateNumeric(now)}, ${fmtTime(now)} Uhr`;
}

/** „vor 5 Min.“, „heute, 14:02“, „gestern, 09:10“, „Mi, 24.09.“ */
export function fmtStamp(d, now = new Date()) {
  const x = toDate(d);
  const mins = Math.round((now - x) / 60000);
  if (mins < 1) return 'gerade eben';
  if (mins < 60) return `vor ${mins} Min.`;
  const diff = dayDiff(x, now);
  if (diff === 0) return `heute, ${fmtTime(x)}`;
  if (diff === 1) return `gestern, ${fmtTime(x)}`;
  return fmtShortDay(x, now);
}

export function toInputValue(d) {
  const x = toDate(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

export function fromInputValue(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || '');
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

export function monthKey(d = new Date()) {
  const x = toDate(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}`;
}
