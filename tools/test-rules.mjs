// Vérification des règles de calcul sur les seuils réels du classeur.
// Le classeur étant vide de résultats, les élèves sont fabriqués ici.
//   node tools/test-rules.mjs

import XLSX from 'xlsx';
import { parseThresholdsSheet, norm } from '../js/parser.js';
import { WORKBOOK_PATH } from '../js/config.js';
import {
  countersAt,
  currentPeriod,
  periodAwaitingFreeze,
  evaluate,
  gapTo,
  nextLevel,
  adviceKey,
  describeGap,
  missingSocle,
  socleForPeriod,
} from '../js/rules.js';

const FILE = process.argv[2] || WORKBOOK_PATH;

const wb = XLSX.readFile(FILE, { cellDates: false });
const sheet = wb.SheetNames.find((n) => norm(n).startsWith('seuils'));
const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], {
  header: 1,
  raw: false,
  defval: '',
  blankrows: true,
});
const thresholds = parseThresholdsSheet(rows);
const course = thresholds.find((c) => norm(c.label) === '5e chimie');
const cc4 = thresholds.find((c) => norm(c.label) === '4e sciences');

// ------------------------------------------------------------------ fabrique

const WEEKS = [
  '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05',
  '2026-10-12', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23',
  '2026-12-07', '2027-01-05', '2027-01-11', '2027-01-18', '2027-02-01',
  '2027-02-15', '2027-03-15', '2027-03-22', '2027-04-05', '2027-05-10',
];

/**
 * `bex` = tableau de 8 nombres : combien de fois chaque BEX a été réussie.
 * Les devoirs libres et quiz sont placés sur les premières semaines.
 */
function makeStudent({ dl = 0, quiz = 0, bex = [], missions = 0, dep = 0 }) {
  return {
    lastName: 'Test',
    firstName: 'Élève',
    dl: WEEKS.slice(0, dl).map((d) => ({ label: d, date: new Date(d), value: '1' })),
    quiz: WEEKS.slice(0, quiz).map((d) => ({ label: d, date: new Date(d), value: '1' })),
    bex: Array.from({ length: 8 }, (_, i) => ({
      index: i + 1,
      label: `BEX${i + 1}`,
      attempts: Array.from({ length: bex[i] || 0 }, () => '1'),
    })),
    missions: Array.from({ length: missions }, (_, i) => ({ label: `Rôle ${i}`, value: 'M1' })),
    depassements: Array.from({ length: dep }, (_, i) => ({ label: `D${i}`, value: '1' })),
  };
}

// ------------------------------------------------------------------- harnais

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  ÉCHEC'} ${label}${ok ? '' : `\n         attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`}`);
}

const rule = (t) => console.log(`\n${t}\n${'-'.repeat(t.length)}`);

// --------------------------------------------------------------- calendrier

rule('Calendrier');
check('rentrée → période 1', currentPeriod('2026-09-07'), 1);
check('13/11 (dernier cours P1) → période 1', currentPeriod('2026-11-13'), 1);
check('14/11 → période 2', currentPeriod('2026-11-14'), 2);
check('19/2 → période 2', currentPeriod('2027-02-19'), 2);
check('20/2 → période 3', currentPeriod('2027-02-20'), 3);
check('17/11 : P1 en attente de conseil', periodAwaitingFreeze('2026-11-17'), 1);
check('21/11 : plus rien en attente', periodAwaitingFreeze('2026-11-21'), null);
check('10/3 : P2 en attente de conseil', periodAwaitingFreeze('2027-03-10'), 2);

// ----------------------------------------------------------------- coupures

rule('Coupure des compteurs à une date');
const s = makeStudent({ dl: 10, quiz: 8, bex: [1, 1, 0, 0, 0, 0, 0, 0], missions: 1 });
check('sans coupure : 10 DL', countersAt(s).dl, 10);
check('coupé au 13/11 : 8 DL', countersAt(s, '2026-11-13').dl, 8);
check('coupé au 13/11 : 8 quiz (tous avant la date)', countersAt(s, '2026-11-13').quiz, 8);
check('validations = 2 BEX + 1 mission', countersAt(s).validations, 3);
check('BEX différentes = 2', countersAt(s).bexDiff, 2);

// -------------------------------------------------------------- évaluation

rule('Niveau atteint — 5e Chimie, période 1 (seuils JS 4/2/1/1/0 … TB 6/4/3/2/1)');

const p1 = course.periods[1];
// En période 1, aucun socle n'est exigé.
const ctx = { socle: socleForPeriod(course, 1) };
const ctx3 = { socle: socleForPeriod(course, 3) };

check(
  'élève vide → insuffisant',
  evaluate(makeStudent({}), p1, ctx).level,
  'I'
);
check(
  'pile au seuil JS (DL4 Q2 V1 BD1) → JS',
  evaluate(makeStudent({ dl: 4, quiz: 2, bex: [1, 0, 0, 0, 0, 0, 0, 0] }), p1, ctx).level,
  'JS'
);
check(
  'un DL de moins que JS → insuffisant',
  evaluate(makeStudent({ dl: 3, quiz: 2, bex: [1, 0, 0, 0, 0, 0, 0, 0] }), p1, ctx).level,
  'I'
);
check(
  'DL6 Q4 V3 BD2 D+1 → TB',
  evaluate(makeStudent({ dl: 6, quiz: 4, bex: [2, 1, 0, 0, 0, 0, 0, 0], dep: 1 }), p1, ctx).level,
  'TB'
);
check(
  'même élève sans dépassement → Bien',
  evaluate(makeStudent({ dl: 6, quiz: 4, bex: [2, 1, 0, 0, 0, 0, 0, 0] }), p1, ctx).level,
  'B'
);
check(
  'tolérance DL : DL5 (seuil B=6) avec le reste au niveau B → Bien',
  evaluate(makeStudent({ dl: 5, quiz: 4, bex: [1, 1, 0, 0, 0, 0, 0, 0] }), p1, ctx).level,
  'B'
);
check(
  'tolérance désactivée : le même élève retombe à Suffisant',
  evaluate(makeStudent({ dl: 5, quiz: 4, bex: [1, 1, 0, 0, 0, 0, 0, 0] }), p1, {
    ...ctx,
    dlTolerance: false,
  }).level,
  'S'
);

// ------------------------------------------------------------------- socles

rule('BEX socles (5e Chimie : BEX 1, 2, 3)');
const p3 = course.periods[3];
const noSocle = makeStudent({ dl: 14, quiz: 10, bex: [0, 0, 0, 3, 3, 2, 1, 1], missions: 1 });
check('socle manquant repéré', missingSocle(noSocle, course.socle), [1, 2, 3]);
check(
  '5 BEX différentes mais aucun socle → insuffisant',
  evaluate(noSocle, p3, { ...ctx3, examLevel: 'S' }).level,
  'I'
);
check(
  'le même élève en période 1 : le socle ne joue pas, il atteint Bien',
  evaluate(noSocle, p1, ctx).level,
  'B' // pas TB : il lui manque le dépassement exigé par le TB de la P1
);
const withSocle = makeStudent({ dl: 14, quiz: 10, bex: [1, 1, 1, 2, 3, 2, 0, 0], missions: 1 });
check(
  'socle complet et 6 BEX → Suffisant',
  evaluate(withSocle, p3, { ...ctx3, examLevel: 'S' }).level,
  'S'
);

// ------------------------------------------------------------------ examen

rule('Condition d\'examen en période 3');
const strong = makeStudent({
  dl: 18, quiz: 18, bex: [3, 3, 3, 3, 2, 2, 2, 0], missions: 3, dep: 5,
});
const noExam = evaluate(strong, p3, { ...ctx3, examLevel: null });
check('examen pas encore passé → TB suspendu', noExam.pendingExam, 'TB');
check('  et niveau retenu inférieur', noExam.level, 'S');
check(
  'examen à Bien → TB acquis',
  evaluate(strong, p3, { ...ctx3, examLevel: 'B' }).level,
  'TB'
);
check(
  'examen à Suffisant → Bien seulement',
  evaluate(strong, p3, { ...ctx3, examLevel: 'S' }).level,
  'B'
);
check(
  'examen insuffisant → Suffisant',
  evaluate(strong, p3, { ...ctx3, examLevel: 'I' }).level,
  'S'
);

// -------------------------------------------------------------------- écart

rule('Écart vers un objectif');
const mid = makeStudent({ dl: 5, quiz: 3, bex: [1, 1, 0, 0, 0, 0, 0, 0] });
const gap = gapTo('TB', mid, p1, ctx);
check('écart vers TB', gap.gaps, { dl: 1, quiz: 1, validations: 1, depassements: 1 });
check(
  'formulation au singulier',
  describeGap(gap.gaps),
  '1 devoir libre, 1 quiz, 1 validation et 1 dépassement'
);
check('quatre compteurs en retard → priorisation', adviceKey(gap, mid), 'many-behind');

// Un seul compteur en retard : le conseil devient spécifique.
const almost = makeStudent({ dl: 6, quiz: 4, bex: [1, 1, 0, 0, 0, 0, 0, 0], dep: 1 });
const gapAlmost = gapTo('TB', almost, p1, ctx);
check('écart réduit à une validation', gapAlmost.gaps, { validations: 1 });
check('conseil : repasser une BEX', adviceKey(gapAlmost, almost), 'need-revalidation');

const reached = gapTo('JS', mid, p1, ctx);
check('objectif JS déjà atteint', reached.reached, true);
check('niveau suivant après S', nextLevel('S'), 'B');
check('rien après TB', nextLevel('TB'), null);

const behind = gapTo('B', makeStudent({ dl: 1 }), p1, ctx);
check('trois compteurs en retard → conseil de priorisation', adviceKey(behind, makeStudent({ dl: 1 })), 'many-behind');

// ---------------------------------------------------- différence entre cours

rule('4e Sciences vs 5e Chimie en période 3 (BEX DIFF du juste suffisant)');
check('4e Sciences : socle BEX 1 et 2', cc4.socle, [1, 2]);
check('4e Sciences JS demande 4 BEX différentes', cc4.periods[3].JS.bexDiff, 4);
check('5e Chimie JS demande 5 BEX différentes', course.periods[3].JS.bexDiff, 5);

const four = makeStudent({ dl: 12, quiz: 8, bex: [1, 1, 1, 1, 0, 0, 0, 0], missions: 4 });
check(
  '4 BEX dont le socle : JS en 4e Sciences',
  evaluate(four, cc4.periods[3], { socle: socleForPeriod(cc4, 3), examLevel: 'JS' }).level,
  'JS'
);
check(
  'le même élève en 5e Chimie : insuffisant (5 BEX exigées)',
  evaluate(four, course.periods[3], { socle: socleForPeriod(course, 3), examLevel: 'JS' }).level,
  'I'
);

// -------------------------------------------------------------------- bilan

console.log(
  `\n${failures === 0 ? 'Tous les contrôles passent.' : `${failures} contrôle(s) en échec.`}`
);
process.exit(failures === 0 ? 0 : 1);
