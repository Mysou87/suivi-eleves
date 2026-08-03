// Validation du lecteur sur le classeur 2025-2026, qui contient de vraies
// données. Les valeurs attendues ont été relevées à la main dans le fichier.
// Ce contrôle protège du bug des fusions décalées : si les groupes de colonnes
// glissent d'un cran, les compteurs ci-dessous changent immédiatement.
//   node tools/check-2025.mjs

import XLSX from 'xlsx';
import { parseCourseSheet } from '../js/parser.js';

const FILE =
  process.argv[2] ||
  'c:\\Users\\lvano\\Desktop\\Classe adaptative\\Feuilles de cotes 2025-2026.ods';

const wb = XLSX.readFile(FILE, { cellDates: false });
const rows = XLSX.utils.sheet_to_json(wb.Sheets['4A Sciences'], {
  header: 1,
  raw: false,
  defval: '',
  blankrows: true,
});

const parsed = parseCourseSheet('4A Sciences', rows, { startYear: 2025 });

console.log(`Onglet « 4A Sciences » 2025-2026 : ${parsed.students.length} élèves`);
console.log(`Thèmes BEX détectés : ${parsed.layout.bexGroups.length}`);
if (parsed.warnings.length) parsed.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
console.log('');

// Relevé manuel : passages de chaque BEX, dans l'ordre des thèmes.
const EXPECTED = {
  Braibant: { attempts: [3, 3, 1, 2, 3, 2, 1, 1, 0, 0], validations: 16, bexDiff: 8 },
  Fayt: { attempts: [2, 2, 3, 1, 2, 1, 2, 2, 0, 0], validations: 15, bexDiff: 8 },
  Leroy: { attempts: [2, 2, 1, 1, 1, 2, 2, 1, 0, 1], validations: 13, bexDiff: 9 },
  Kawa: { attempts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], validations: 0, bexDiff: 0 },
};

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? 'ok  ' : 'ÉCHEC'} ${label}` +
      (ok ? '' : `\n         attendu ${JSON.stringify(expected)}\n         obtenu  ${JSON.stringify(actual)}`)
  );
};

Object.entries(EXPECTED).forEach(([name, exp]) => {
  const s = parsed.students.find((x) => x.lastName === name);
  if (!s) {
    failures++;
    return console.log(`  ÉCHEC ${name} introuvable`);
  }
  const attempts = s.bex.map((b) => b.attempts.length);
  check(`${name} : passages par BEX`, attempts, exp.attempts);
  check(`${name} : validations (BEX + missions ${s.missions.length})`, s.counters.validations, exp.validations + s.missions.length);
  check(`${name} : BEX différentes`, s.counters.bexDiff, exp.bexDiff);
});

// Contrôle croisé : la somme des passages doit égaler le nombre de cellules
// remplies dans la zone BEX de la ligne, sans en perdre ni en compter deux fois.
console.log('\nContrôle croisé sur l\'ensemble de la classe :');
const totalAttempts = parsed.students.reduce(
  (n, s) => n + s.bex.reduce((m, b) => m + b.attempts.length, 0),
  0
);
console.log(`  ${totalAttempts} validations de BEX lues sur ${parsed.students.length} élèves`);
const overlap = parsed.layout.bexGroups.length * 3;
console.log(`  ${parsed.layout.bexGroups.length} thèmes × 3 passages = ${overlap} colonnes attendues`);

console.log(
  `\n${failures === 0 ? 'Validation réussie sur données réelles.' : `${failures} contrôle(s) en échec.`}`
);
process.exit(failures === 0 ? 0 : 1);
