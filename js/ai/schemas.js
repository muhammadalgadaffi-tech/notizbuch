// Antwortformate (JSON-Schema). Das Modell muss exakt in diesem Format antworten.

import { THEMEN } from '../core/constants.js';

const str = (description) => ({ type: 'string', description });
const strList = (description) => ({ type: 'array', items: { type: 'string' }, description });
const obj = (properties) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});

const PRUEFUNG = obj({
  fakten_getrennt: { type: 'boolean', description: 'Fakten, Wahrnehmung und Deutung sind getrennt.' },
  nichts_erfunden: { type: 'boolean', description: 'Nichts ist erfunden.' },
  keine_gedankenbehauptung: { type: 'boolean', description: 'Keine unbelegten Behauptungen über Gedanken oder Absichten anderer.' },
  alternativen_offen: { type: 'boolean', description: 'Alternative Erklärungen sind berücksichtigt.' },
  kein_scheinzusammenhang: { type: 'boolean', description: 'Kein Zusammenhang nur wegen Ähnlichkeit.' },
  gedeckt: { type: 'boolean', description: 'Alles ist durch die gespeicherten Informationen gedeckt.' },
  korrekturen: strList('Kurze Notizen, was am Entwurf geändert wurde.'),
});

export const ANALYSE = obj({
  beobachtung: str('Was laut Eintrag tatsächlich passiert ist.'),
  wahrnehmung: str('Was der Person aufgefallen ist, oder leer.'),
  erklaerungen: {
    type: 'array',
    description: '2 bis 4 mögliche Erklärungen.',
    items: obj({
      text: str('Die Erklärung.'),
      einordnung: { type: 'string', enum: ['naheliegend', 'möglich', 'spekulativ'] },
    }),
  },
  offen: str('Was sich nicht sicher sagen lässt, oder leer.'),
  verbindungen: {
    type: 'array',
    description: '0 bis 2 frühere Einträge mit konkretem Bezug.',
    items: obj({
      eintrag_id: str('id eines früheren Eintrags aus dem Material.'),
      text: str('Der Bezug, offen formuliert.'),
    }),
  },
  rueckfragen: strList('0 bis 3 Rückfragen.'),
  perspektive: str('Sicht der anderen Person, oder leer.'),
  uebersehen: str('Was die Person vielleicht übersieht, oder leer.'),
  denkfrage: str('Eine Frage zum Weiterdenken.'),
  hinweis: str('Nur bei Gesundheit über längere Zeit oder ernster Gefahr, sonst leer.'),
  personen: strList('Namen, die wörtlich im neuen Eintrag stehen.'),
  themen: { type: 'array', description: '0 bis 3 Themen aus der Liste.', items: { type: 'string', enum: THEMEN } },
});

export const ANALYSE_GEPRUEFT = obj({ pruefung: PRUEFUNG, ergebnis: ANALYSE });

export const FRAGE = obj({
  antwort: str('Direkte Antwort auf die Frage.'),
  belege: {
    type: 'array',
    description: 'Höchstens 8 Einträge, auf die sich die Antwort stützt.',
    items: obj({
      eintrag_id: str('id aus dem Material.'),
      bezug: str('Kurzer Bezug.'),
    }),
  },
  muster: str('Mögliches Muster, oder leer.'),
  offen: str('Was sich nicht sagen lässt, oder leer.'),
  denkfrage: str('Frage zum Weiterdenken, oder leer.'),
});

export const FRAGE_GEPRUEFT = obj({ pruefung: PRUEFUNG, ergebnis: FRAGE });

export const MUSTER = obj({
  aufgefallen: {
    type: 'array',
    description: '1 bis 4 Beobachtungen.',
    items: obj({
      text: str('Die Beobachtung.'),
      eintraege: strList('ids der Einträge, auf die sie sich stützt.'),
    }),
  },
  muster: {
    type: 'array',
    description: '0 bis 3 mögliche Muster.',
    items: obj({
      titel: str('Kurzer Titel.'),
      schritte: {
        type: 'array',
        items: obj({
          eintrag_id: str('id aus dem Material.'),
          kurz: str('Wenige Wörter.'),
        }),
      },
      deutung: str('Mögliche Verbindung, offen formuliert.'),
      sicherheit: { type: 'string', enum: ['schwach', 'mittel'] },
    }),
  },
  nachdenken: {
    type: 'array',
    description: '0 bis 2 Fragen.',
    items: obj({
      frage: str('Die Frage.'),
      bezug: strList('ids der Einträge.'),
    }),
  },
  offen: str('Was sich nicht sagen lässt, oder leer.'),
});

export const MUSTER_GEPRUEFT = obj({ pruefung: PRUEFUNG, ergebnis: MUSTER });
