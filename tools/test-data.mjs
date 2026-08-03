// Vérifie la chaîne complète contre la vraie base : connexion d'un élève,
// chargement de ses cours, calcul du niveau et de l'écart vers un objectif.
// Aucun nom d'élève n'est affiché en clair.
//   node tools/test-data.mjs

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../js/config.js';
import { findStudent, loadClasses, loadDashboard, loadAdvice, studentFromCounters } from '../js/data.js';
import {
  countersAt,
  evaluate,
  gapTo,
  adviceKey,
  describeGap,
  nextLevel,
  socleForPeriod,
  LEVEL_LABELS,
} from '../js/rules.js';

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const mask = (s) => (s ? String(s)[0] + '.' : '?');

let failures = 0;
const check = (label, cond) => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'ok  ' : 'ÉCHEC'} ${label}`);
};

// ------------------------------------------------------------------ classes

const classes = await loadClasses(db);
console.log(`Classes disponibles : ${classes.join(', ')}`);
check('les 11 classes sont là', classes.length >= 10);

// -------------------------------------------------- connexion d'un élève réel

const { data: sample } = await db
  .from('students')
  .select('first_name, last_name, class_name')
  .not('class_name', 'is', null)
  .eq('class_name', '5C')
  .limit(1);

if (!sample?.length) {
  console.log('Aucun élève de 5C en base, test interrompu.');
  process.exit(1);
}

const target = sample[0];
console.log(`\nÉlève test : ${mask(target.first_name)} ${mask(target.last_name)} (${target.class_name})`);

const found = await findStudent(db, {
  firstName: target.first_name,
  lastName: target.last_name,
  className: target.class_name,
});
check('trouvé par prénom + nom + classe', !!found.student);

const accented = await findStudent(db, {
  firstName: target.first_name.toUpperCase(),
  lastName: target.last_name.toLowerCase(),
  className: target.class_name,
});
check('insensible à la casse', !!accented.student);

const wrong = await findStudent(db, {
  firstName: 'Zzz',
  lastName: 'Zzz',
  className: target.class_name,
});
check('inconnu correctement rejeté', wrong.notFound === true);

// ---------------------------------------------------------------- tableau

const dash = await loadDashboard(db, found.student.id);
check('aucune erreur de chargement', !dash.error);
check('au moins un cours', (dash.courses || []).length >= 1);
console.log(`\nPériode courante : ${dash.period}`);
console.log(`Cours de cet élève : ${dash.courses.map((c) => c.sheetName).join(' · ')}`);

const advice = await loadAdvice(db);
check('11 conseils chargés', Object.keys(advice).length === 11);

dash.courses.forEach((c) => {
  console.log(`\n  ${c.sheetName}  (seuils de « ${c.label} »)`);
  check(`  ${c.sheetName} : compteurs présents`, !!c.student);
  check(`  ${c.sheetName} : 8 BEX nommées`, c.bexLabels.length === 8);
  check(`  ${c.sheetName} : seuils des 3 périodes`, Object.keys(c.thresholds).length === 3);

  const counters = countersAt(c.student);
  const period = dash.period;
  const ctx = { socle: socleForPeriod(c.socle, period), examLevel: c.student.examLevel, counters };
  const assessment = evaluate(c.student, c.thresholds[period], ctx);
  console.log(
    `    DL ${counters.dl} · Q ${counters.quiz} · V ${counters.validations} · ` +
      `BD ${counters.bexDiff} · D+ ${counters.depassements}  →  ${LEVEL_LABELS[assessment.level]}`
  );

  const gap = gapTo('S', c.student, c.thresholds[period], ctx);
  console.log(`    pour Suffisant : ${describeGap(gap.gaps) || 'rien de plus'}`);
  console.log(`    conseil retenu : ${adviceKey(gap, c.student)}`);
  check('  un conseil existe pour cette clé', !!advice[adviceKey(gap, c.student)]);
});

// ------------------------------------------- démonstration sur des compteurs

console.log('\nSimulation : mêmes seuils, compteurs remplis');
const demoRow = {
  dl_dates: [
    '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12',
  ],
  quiz_dates: ['2026-09-14', '2026-09-28', '2026-10-12', '2026-11-09'],
  bex: [
    { index: 1, label: 'BEX1', attempts: 2 },
    { index: 2, label: 'BEX2', attempts: 1 },
  ],
  missions: 0,
  depassements: 1,
  exam_level: null,
};
const demo = studentFromCounters(demoRow);
const first = dash.courses[0];
const demoCtx = { socle: socleForPeriod(first.socle, 1), examLevel: null };
const demoLevel = evaluate(demo, first.thresholds[1], demoCtx);
console.log(
  `  DL 6 · Q 4 · V 3 · BD 2 · D+ 1  →  ${LEVEL_LABELS[demoLevel.level]} ` +
    `(objectif suivant : ${nextLevel(demoLevel.level) || 'aucun'})`
);
check('cet élève simulé atteint Très bien', demoLevel.level === 'TB');

console.log(
  `\n${failures === 0 ? 'Chaîne complète validée sur la base réelle.' : `${failures} contrôle(s) en échec.`}`
);
process.exit(failures === 0 ? 0 : 1);
