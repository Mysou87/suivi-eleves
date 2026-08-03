// Contrôles du filtrage de l'historique : seules les dates où quelque chose a
// bougé doivent apparaitre, avec l'écart par rapport au relevé précédent.
//   node tools/test-history.mjs

import { compressHistory } from '../js/data.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? 'ok  ' : 'ÉCHEC'} ${label}` +
      (ok ? '' : `\n         attendu ${JSON.stringify(expected)}\n         obtenu  ${JSON.stringify(actual)}`)
  );
};

const row = (date, dl, quiz, validations, bex, dep) => ({
  captured_at: date,
  dl,
  quiz,
  validations,
  bex_diff: bex,
  depassements: dep,
});

// Trois imports, dont deux identiques : une seule étape doit rester.
const doubled = compressHistory([
  row('2026-09-10', 2, 1, 1, 1, 0),
  row('2026-09-10', 2, 1, 1, 1, 0),
  row('2026-09-17', 3, 1, 2, 1, 0),
]);
check('les imports sans changement sont écartés', doubled.length, 2);
check('dates conservées', doubled.map((r) => r.captured_at), ['2026-09-10', '2026-09-17']);
check('premier relevé = valeurs initiales', doubled[0].delta, {
  dl: 2,
  quiz: 1,
  validations: 1,
  bexDiff: 1,
});
check('deuxième relevé = écart seulement', doubled[1].delta, { dl: 1, validations: 1 });

// Un élève qui ne fait rien pendant trois imports : aucune étape.
const flat = compressHistory([
  row('2026-09-10', 0, 0, 0, 0, 0),
  row('2026-09-17', 0, 0, 0, 0, 0),
  row('2026-09-24', 0, 0, 0, 0, 0),
]);
check('aucun mouvement, aucune ligne', flat.length, 0);

// Une correction à la baisse doit rester visible.
const corrected = compressHistory([
  row('2026-09-10', 5, 3, 2, 2, 0),
  row('2026-09-17', 4, 3, 2, 2, 0),
]);
check('une correction en moins apparait', corrected[1].delta, { dl: -1 });

check('liste vide supportée', compressHistory([]), []);
check('null supporté', compressHistory(null), []);

console.log(
  `\n${failures === 0 ? 'Filtrage de l\'historique validé.' : `${failures} contrôle(s) en échec.`}`
);
process.exit(failures === 0 ? 0 : 1);
