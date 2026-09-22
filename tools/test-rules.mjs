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
  yearJustStarted,
  periodProgress,
  paceGapTo,
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

rule('Lancement de l\'année (jusqu\'au 15 septembre)');
check('7/9 : lancement en cours', yearJustStarted('2026-09-07'), true);
check('15/9 : encore le lancement', yearJustStarted('2026-09-15'), true);
check('16/9 : lancement terminé', yearJustStarted('2026-09-16'), false);
check(
  'même élève très en retard, mais pendant le lancement → conseil ciblé (quiz à zéro) plutôt que many-behind',
  adviceKey(behind, makeStudent({ dl: 1 }), { yearJustStarted: true }),
  'behind-quiz'
);
const freshStart = gapTo('B', makeStudent({}), p1, ctx);
check(
  'élève qui n\'a encore rien rendu, pendant le lancement → period-start',
  adviceKey(freshStart, makeStudent({}), { yearJustStarted: true }),
  'period-start'
);
check(
  'le même élève vide, hors fenêtre de lancement → many-behind (pas de faux period-start)',
  adviceKey(freshStart, makeStudent({})),
  'many-behind'
);
check(
  'objectif déjà atteint pendant le lancement → reste target-reached',
  adviceKey(reached, mid, { yearJustStarted: true }),
  'target-reached'
);

// ---------------------------------------------------------------- au rythme

rule('Conseils adaptés au rythme réel (calendrier des semaines)');

// 8 des 20 dates de WEEKS tombent avant la fin de la P1 (13/11) : c'est le
// total « planifié » pour cette période.
check('8 semaines de DL prévues en P1', WEEKS.filter((d) => d <= '2026-11-13').length, 8);
check('sans calendrier connu : rythme = 1 (rien n\'est adouci)', periodProgress([], 1), 1);
check('période inconnue : rythme = 1', periodProgress(WEEKS, 99), 1);
check(
  '2 semaines écoulées sur 8 prévues → rythme = 0,25',
  periodProgress(WEEKS, 1, '2026-09-14'),
  0.25
);
check(
  'toutes les semaines de la période passées → rythme plafonné à 1',
  periodProgress(WEEKS, 1, '2026-12-01'),
  1
);

// Objectif B (6/4/2/2/0 en P1) : à 3 semaines écoulées sur 8 (rythme 0,375),
// seuils arrondis au SUPÉRIEUR à 3/2/1/1/0 (une seule BEX suffit déjà à
// satisfaire le rythme, mais il en faut au moins une — pas de faux « à
// l'heure » avec 0 BEX comme avec l'arrondi à l'inférieur).
const onTrackStudent = makeStudent({ dl: 3, quiz: 2, bex: [1, 0, 0, 0, 0, 0, 0, 0] });
const paceOnTrack = paceGapTo('B', onTrackStudent, p1, WEEKS, 1, { ...ctx, when: '2026-09-21' });
check('au rythme (3 DL, 2 quiz, 1 BEX sur 3 semaines/8) : aucun écart au rythme', paceOnTrack, {});
check(
  'mais l\'écart réel vers B reste important (pas encore atteint)',
  Object.keys(gapTo('B', onTrackStudent, p1, ctx).gaps).length >= 3,
  true
);
check(
  'conseil : dans les temps, pas en retard',
  adviceKey(gapTo('B', onTrackStudent, p1, ctx), onTrackStudent, { paceGaps: paceOnTrack }),
  'on-pace'
);

// Même rythme, mais un compteur (quiz) n'a vraiment pas suivi : lui seul
// ressort, pas un « many-behind » sur l'ensemble.
const laggingQuiz = makeStudent({ dl: 3, quiz: 1, bex: [1, 0, 0, 0, 0, 0, 0, 0] });
const paceLagging = paceGapTo('B', laggingQuiz, p1, WEEKS, 1, { ...ctx, when: '2026-09-21' });
check('un seul compteur réellement en retard sur le rythme', paceLagging, { quiz: 1 });
check(
  'conseil ciblé sur les quiz, pas many-behind',
  adviceKey(gapTo('B', laggingQuiz, p1, ctx), laggingQuiz, { paceGaps: paceLagging }),
  'behind-quiz'
);

// Une seule BEX exigée par le rythme (JS/S dès la P1) : 0 BEX validée ne peut
// plus jamais passer pour « à l'heure » une fois que le rythme est positif.
const noBexAtAll = makeStudent({ dl: 3, quiz: 2 });
const paceNoBex = paceGapTo('B', noBexAtAll, p1, WEEKS, 1, { ...ctx, when: '2026-09-21' });
check('0 BEX validée détecté comme en retard dès que le rythme est positif', paceNoBex.bexDiff > 0, true);

// Cas réel rencontré (Ilhan, 6e Chimie) : droit à l'oubli d'UN devoir libre —
// un seul DL manquant au rythme ne doit jamais, à lui seul, déclencher
// behind-dl (absence/maladie possible une fois). Deux DL manquants restent
// signalés : la tolérance ne doit pas devenir un blanc-seing.
const oneDlMissing = makeStudent({ dl: 2, quiz: 2, bex: [1, 0, 0, 0, 0, 0, 0, 0] });
const paceOneDlMissing = paceGapTo('B', oneDlMissing, p1, WEEKS, 1, { ...ctx, when: '2026-09-21' });
check('1 devoir libre manquant au rythme : pardonné, aucun écart', paceOneDlMissing.dl ?? 0, 0);
const twoDlMissing = makeStudent({ dl: 1, quiz: 2, bex: [1, 0, 0, 0, 0, 0, 0, 0] });
const paceTwoDlMissing = paceGapTo('B', twoDlMissing, p1, WEEKS, 1, { ...ctx, when: '2026-09-21' });
check('2 devoirs libres manquants au rythme : toujours signalé', paceTwoDlMissing.dl > 0, true);

// Aucun devoir libre rendu doit primer sur tout, BEX comprises : c'est le
// plus simple et le plus urgent à rattraper.
const zeroDl = makeStudent({ dl: 0, quiz: 2 });
const paceZeroDl = paceGapTo('B', zeroDl, p1, WEEKS, 1, { ...ctx, when: '2026-09-21' });
check(
  'aucun DL rendu, même avec des BEX qui manquent aussi → behind-dl prioritaire',
  adviceKey(gapTo('B', zeroDl, p1, ctx), zeroDl, { paceGaps: paceZeroDl }),
  'behind-dl'
);
// Un simple retard partiel sur les DL (pas zéro) ne doit PAS voler la priorité
// aux BEX : le passe-devant ne vaut que pour l'absence totale.
const partialDl = makeStudent({ dl: 1, quiz: 2 });
const pacePartialDl = paceGapTo('B', partialDl, p1, WEEKS, 1, { ...ctx, when: '2026-09-21' });
check(
  'DL entamés mais pas à zéro, BEX manquantes → need-new-bex garde la priorité',
  adviceKey(gapTo('B', partialDl, p1, ctx), partialDl, { paceGaps: pacePartialDl }),
  'need-new-bex'
);

// Même règle pour les quiz : aucun quiz réussi doit primer sur les BEX.
const zeroQuiz = makeStudent({ dl: 2, quiz: 0 });
const paceZeroQuiz = paceGapTo('B', zeroQuiz, p1, WEEKS, 1, { ...ctx, when: '2026-09-21' });
check(
  'aucun quiz réussi, même avec des BEX qui manquent aussi → behind-quiz prioritaire',
  adviceKey(gapTo('B', zeroQuiz, p1, ctx), zeroQuiz, { paceGaps: paceZeroQuiz }),
  'behind-quiz'
);
const partialQuiz = makeStudent({ dl: 2, quiz: 1 });
const pacePartialQuiz = paceGapTo('B', partialQuiz, p1, WEEKS, 1, { ...ctx, when: '2026-09-21' });
check(
  'quiz entamés mais pas à zéro, BEX manquantes → need-new-bex garde la priorité',
  adviceKey(gapTo('B', partialQuiz, p1, ctx), partialQuiz, { paceGaps: pacePartialQuiz }),
  'need-new-bex'
);

// Cas réel rencontré (Camille Ermans) : à l'heure sur DL/quiz, une seule BEX
// validée jusqu'ici — au rythme, le nombre de BEX différentes exigé (1) est
// déjà atteint, mais pas le nombre de validations (2). « Repasser une BEX
// déjà validée » n'aurait aucun sens avec une seule : il faut en tenter une
// nouvelle, pas revalider l'unique déjà faite.
const onlyOneBexOnPace = makeStudent({ dl: 3, quiz: 2, bex: [1, 0, 0, 0, 0, 0, 0, 0], dep: 1 });
const paceOnlyOneBex = paceGapTo('TB', onlyOneBexOnPace, p1, WEEKS, 1, { ...ctx, when: '2026-09-21' });
check(
  'au rythme : BEX différentes déjà bon, mais 1 validation manque encore',
  paceOnlyOneBex,
  { validations: 1 }
);
check(
  'conseil : valider une nouvelle BEX, pas en repasser une (une seule validée jusqu\'ici)',
  adviceKey(gapTo('TB', onlyOneBexOnPace, p1, ctx), onlyOneBexOnPace, { paceGaps: paceOnlyOneBex }),
  'need-new-bex'
);

// Cas réel rencontré (Dadkhah, 6e Chimie) : à l'heure pour DL/quiz, il ne lui
// manque QU'UNE BEX — validations et bexDiff manquent ensemble (une BEX
// validée augmenterait les deux à la fois), ça ne doit compter que pour UN
// domaine en retard, pas deux. Avec un dépassement en plus (2 domaines), on
// reste sous le seuil de many-behind : le conseil doit rester ciblé sur la BEX.
const missingOnlyBex = makeStudent({ dl: 3, quiz: 2 });
const paceMissingOnlyBex = paceGapTo('TB', missingOnlyBex, p1, WEEKS, 1, { ...ctx, when: '2026-09-21' });
check(
  'à l\'heure sur DL/quiz, seule la BEX manque (validations + bexDiff + dépassement = 2 domaines, pas 3)',
  adviceKey(gapTo('TB', missingOnlyBex, p1, ctx), missingOnlyBex, { paceGaps: paceMissingOnlyBex }),
  'need-new-bex'
);
// Un 3e domaine réellement différent (les DL, cette fois, au-delà de la
// tolérance d'un devoir libre oublié) fait bien basculer en many-behind : le
// regroupement ne masque pas un vrai retard sur 3 fronts.
const trulyBehindOnThree = makeStudent({ dl: 1, quiz: 2 });
const paceTrulyBehind = paceGapTo('TB', trulyBehindOnThree, p1, WEEKS, 1, { ...ctx, when: '2026-09-21' });
check(
  'un vrai 3e domaine (DL) fait toujours basculer en many-behind',
  adviceKey(gapTo('TB', trulyBehindOnThree, p1, ctx), trulyBehindOnThree, { paceGaps: paceTrulyBehind }),
  'many-behind'
);

// Sans calendrier connu pour ce cours (import pas encore refait) : le
// comportement historique (écart réel, non adouci) continue de s'appliquer.
const paceUnknown = paceGapTo('B', laggingQuiz, p1, [], 1, { ...ctx, when: '2026-09-21' });
check('pas de calendrier connu → paceGapTo renvoie null', paceUnknown, null);
check(
  'sans rythme calculé, comportement historique (many-behind) inchangé',
  adviceKey(gapTo('B', laggingQuiz, p1, ctx), laggingQuiz, { paceGaps: paceUnknown }),
  'many-behind'
);

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
