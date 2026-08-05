// Compare, compteur par compteur, ce que dit le classeur et ce que contient la
// base. C'est le contrôle à faire à chaque doute : « l'app affiche-t-elle
// vraiment ce que j'ai encodé ? »
//   node tools/compare-live.mjs

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, normalizeSheetName } from '../js/config.js';
import { readWorkbook } from './run-import.mjs';
import { countersAt } from '../js/rules.js';

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const KEYS = ['dl', 'quiz', 'validations', 'bexDiff', 'depassements'];
const COLUMN = { dl: 'dl', quiz: 'quiz', validations: 'validations', bexDiff: 'bex_diff', depassements: 'depassements' };

const parsed = await readWorkbook();

const { data: courses } = await db.from('suivi_courses').select('id, sheet_name');
const { data: students } = await db.from('students').select('id, first_name, last_name');
const { data: counters } = await db
  .from('suivi_counters')
  .select('student_id, course_id, dl, quiz, validations, bex_diff, depassements');

const courseById = new Map(courses.map((c) => [c.id, normalizeSheetName(c.sheet_name)]));
const nameById = new Map(students.map((s) => [s.id, `${s.last_name} ${s.first_name}`]));
const key = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

// --- côté classeur
const fromWorkbook = new Map();
parsed.groups.forEach((group) => {
  group.students.forEach((student) => {
    const c = countersAt(student);
    fromWorkbook.set(`${normalizeSheetName(group.sheetName)}|${key(student.lastName + ' ' + student.firstName)}`, c);
  });
});

// --- côté base
const fromDb = new Map();
counters.forEach((row) => {
  const sheet = courseById.get(row.course_id);
  const name = nameById.get(row.student_id);
  if (!sheet || !name) return;
  fromDb.set(`${sheet}|${key(name)}`, row);
});

console.log(`classeur : ${fromWorkbook.size} inscriptions · base : ${fromDb.size}\n`);

const nonZero = (values, mapper) => KEYS.some((k) => Number(values[mapper(k)] ?? 0) !== 0);

console.log('Élèves avec au moins un compteur non nul');
console.log('  dans le classeur :');
let anyWorkbook = false;
for (const [k, v] of fromWorkbook) {
  if (!nonZero(v, (x) => x)) continue;
  anyWorkbook = true;
  console.log(`    ${k} → DL ${v.dl} Q ${v.quiz} V ${v.validations} BD ${v.bexDiff} D+ ${v.depassements}`);
}
if (!anyWorkbook) console.log('    aucun');

console.log('  dans la base :');
let anyDb = false;
for (const [k, v] of fromDb) {
  if (!nonZero(v, (x) => COLUMN[x])) continue;
  anyDb = true;
  console.log(`    ${k} → DL ${v.dl} Q ${v.quiz} V ${v.validations} BD ${v.bex_diff} D+ ${v.depassements}`);
}
if (!anyDb) console.log('    aucun');

// --- écarts
let differences = 0;
let missing = 0;
for (const [k, wb] of fromWorkbook) {
  const row = fromDb.get(k);
  if (!row) {
    missing++;
    continue;
  }
  const gaps = KEYS.filter((c) => Number(wb[c] ?? 0) !== Number(row[COLUMN[c]] ?? 0));
  if (gaps.length) {
    differences++;
    console.log(
      `\nÉCART ${k}\n  ` +
        gaps.map((c) => `${c} : classeur ${wb[c]} ≠ base ${row[COLUMN[c]]}`).join('\n  ')
    );
  }
}

console.log(
  differences || missing
    ? `\n${differences} élève(s) en écart, ${missing} absent(s) de la base.`
    : '\nAucun écart : la base dit exactement ce que dit le classeur.'
);
