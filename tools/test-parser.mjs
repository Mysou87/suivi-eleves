// Vérification du lecteur de classeur sur le fichier réel.
//   node tools/test-parser.mjs ["chemin\\vers\\Feuilles de cotes.ods"]

import XLSX from 'xlsx';
import { parseWorkbook, parseCourseSheet, parseLevelValue } from '../js/parser.js';

const DEFAULT_FILE =
  'c:\\Users\\lvano\\Desktop\\Espace de travail\\Feuilles de cotes 2026-2027.ods';

const file = process.argv[2] || DEFAULT_FILE;
const START_YEAR = 2026;

const wb = XLSX.readFile(file, { cellDates: false });

const sheets = wb.SheetNames.map((name) => ({
  name,
  rows: XLSX.utils.sheet_to_json(wb.Sheets[name], {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
  }),
}));

const result = parseWorkbook(sheets, { startYear: START_YEAR });

const line = (s = '') => console.log(s);
const rule = () => line('-'.repeat(72));

line(`Fichier : ${file}`);
line(`Feuilles : ${sheets.map((s) => s.name).join(', ')}`);

rule();
line(`NOMENCLATURE (feuille Liste) — ${result.nomenclature.length} cours`);
result.nomenclature.forEach((c) => {
  line(`  ${c.label}`);
  line(`    QCM (${c.quiz.length}) : ${c.quiz.join(' · ') || '—'}`);
  line(`    BEX (${c.bex.length}) : ${c.bex.join(' · ') || '—'}`);
  line(`    Rôles (${c.roles.length}) : ${c.roles.join(' · ') || '—'}`);
  line(`    Dépassements (${c.depassements.length}) : ${c.depassements.join(' · ') || '—'}`);
});

rule();
line(`SEUILS — ${result.thresholds.length} cours`);
result.thresholds.forEach((c) => {
  line(`  ${c.label}   socle : ${c.socle.length ? 'BEX ' + c.socle.join(', ') : '—'}`);
  [1, 2, 3].forEach((p) => {
    const levels = c.periods[p];
    if (!levels) return line(`    P${p} : absent`);
    const fmt = (k) => {
      const v = levels[k];
      if (!v) return `${k}=?`;
      const base = `${k}: ${v.dl}/${v.quiz}/${v.validations}/${v.bexDiff}/${v.depassements}`;
      return v.examCondition ? `${base} (${v.examCondition})` : base;
    };
    line(`    P${p}  ${['JS', 'S', 'B', 'TB'].map(fmt).join('   ')}`);
  });
});
line('    (ordre des valeurs : DL / QUIZ / VALIDATIONS / BEX DIFF / DÉPASSEMENTS)');

rule();
line(`GROUPES DE COURS — ${result.groups.length}`);
result.groups.forEach((g) => {
  const l = g.layout;
  line(`  ${g.sheetName}  ·  ${g.students.length} élèves`);
  line(
    `    semaines DL : ${l.dlWeeks} · semaines quiz : ${l.quizWeeks} · colonne classe : ${
      l.hasClassColumn ? 'oui' : 'non'
    }`
  );
  line(`    BEX (${l.bexGroups.length}) : ${l.bexGroups.join(' · ')}`);
  line(`    Rôles (${l.missionGroups.length}) : ${l.missionGroups.join(' · ')}`);
  line(`    Dépassements (${l.depassementGroups.length}) : ${l.depassementGroups.join(' · ')}`);
  line(
    `    Colonne d'examen : ${l.examColumn === null ? 'aucune' : `colonne ${l.examColumn}`}`
  );

  const sample = g.students.slice(0, 3);
  sample.forEach((s) => {
    const c = s.counters;
    line(
      `      ${(s.classLetter || '·').padEnd(2)} ${s.lastName}, ${s.firstName}` +
        `  →  DL ${c.dl} · Q ${c.quiz} · V ${c.validations} · BD ${c.bexDiff} · D+ ${c.depassements}`
    );
  });
  if (g.students.length > 3) line(`      … et ${g.students.length - 3} autres`);
});

rule();
const totalStudents = result.groups.reduce((n, g) => n + g.students.length, 0);
const distinct = new Set();
result.groups.forEach((g) => g.students.forEach((s) => distinct.add(s.key)));
line(`TOTAL : ${totalStudents} inscriptions, ${distinct.size} élèves distincts`);

const classes = new Map();
result.groups.forEach((g) => {
  g.students.forEach((s) => {
    const label = s.className || '(classe inconnue)';
    classes.set(label, (classes.get(label) || 0) + 1);
  });
});
line(`CLASSES : ${[...classes.entries()].sort().map(([k, v]) => `${k} (${v})`).join(' · ')}`);

// -------------------------------------------------- contrôles synthétiques
// Le classeur est vide de résultats : on vérifie la lecture des valeurs sur un
// onglet fabriqué, structuré comme les vrais.

rule();
line('CONTRÔLES SYNTHÉTIQUES');

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  line(
    `  ${ok ? 'ok  ' : 'ÉCHEC'} ${label}` +
      (ok ? '' : `  (attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)})`)
  );
};

// Trois blocs « Bulletin » comme dans le vrai fichier : les colonnes de sous-
// en-têtes sont aux positions 4-9, 12-17 et 20-25.
const bulletinRows = (headers, leaValues, tomValues) => {
  const at = (base, values) => {
    const row = [];
    values.forEach((v, i) => {
      row[base + i * 8] = v;
    });
    return row;
  };
  const header = ['', '', '', ''];
  headers.forEach((h, i) => {
    const base = 4 + i * 8;
    ['DL', 'S', 'SF', 'C', 'D+', h].forEach((v, j) => {
      header[base + j] = v;
    });
  });
  const fill = (name, cls, values) => {
    const row = at(9, values);
    row[0] = cls;
    row[1] = name[0];
    row[2] = name[1];
    return Array.from({ length: 26 }, (_, i) => row[i] ?? '');
  };
  return [
    ['', '', '', '', 'Bulletin 1', '', '', '', '', 'Bulletin 2', '', '', '', '', 'Bulletin 3'],
    Array.from({ length: 26 }, (_, i) => header[i] ?? ''),
    fill(['Dupont', 'Léa'], 'B', leaValues),
    fill(['Martin', 'Tom'], 'C', tomValues),
  ];
};

const fakeSheet = (headers, lea = ['S', 'B', 'TB'], tom = ['', '', 'abs']) => [
  [],
  ['', '', '', '', 'DEVOIRS LIBRES'],
  ['', '', '', '', 'S1', 'S2', 'S3'],
  ['', '', '', '', '7/9', '14/9', '16/11'],
  ['B', 'Dupont', 'Léa', '', '1', '1', '1'],
  ['C', 'Martin', 'Tom', '', '1', '', ''],
  [],
  ['', '', '', '', 'SAVOIR-FAIRE (BEX)'],
  ['', '', '', '', '1 Un', '', '', '2 Deux', '', '', 'Dépassement'],
  ['B', 'Dupont', 'Léa', '', '1', '2', 'exam', '1', '', '', '1'],
  ['C', 'Martin', 'Tom', '', '1', '', '', '', '', '', ''],
  [],
  ['', '', '', '', 'SE DÉPASSER'],
  ['', '', '', '', '1 Un', '', '', '2 Deux'],
  ['B', 'Dupont', 'Léa', '', '1', '', '', '1'],
  ['C', 'Martin', 'Tom', '', '', '', '', ''],
  [],
  ...bulletinRows(headers, lea, tom),
];

const fake = parseCourseSheet('5e Chimie A', fakeSheet(['Auto', 'Auto', 'Exam']), {
  startYear: 2026,
});
const lea = fake.students.find((s) => s.firstName === 'Léa');
const tom = fake.students.find((s) => s.firstName === 'Tom');

check('deux élèves lus', fake.students.length, 2);
check('classe déduite de la colonne A', [lea.className, tom.className], ['5B', '5C']);
check('3 devoirs libres pour Léa', lea.counters.dl, 3);
check('dont 2 avant le 13/11', lea.dl.filter((d) => d.date <= new Date('2026-11-13')).length, 2);
check('4 validations (3 BEX + 1 exam)', lea.counters.validations, 4);
check('2 BEX différentes', lea.counters.bexDiff, 2);
check(
  "la colonne « Dépassement » du bloc BEX est ignorée",
  lea.bex.map((b) => b.label),
  ['1 Un', '2 Deux']
);
check('2 dépassements comptés dans le bloc du bas', lea.counters.depassements, 2);
check("« Exam » du bulletin 3 retenue, pas les « Auto » précédentes", lea.examLevel, 'TB');
check('« abs » n\'est pas une note', tom.examLevel, null);
check('aucun avertissement sur l\'examen', fake.warnings.filter((w) => w.includes('Auto')), []);
check('valeurs de niveau reconnues', ['TB', 'Très bien', 'js', 'I', 'abs'].map(parseLevelValue), [
  'TB',
  'TB',
  'JS',
  'I',
  null,
]);

// Tant que la colonne n'est pas renommée : on prend la dernière « Auto ».
const legacy = parseCourseSheet('5e Chimie A', fakeSheet(['Auto', 'Auto', 'Auto']), {
  startYear: 2026,
});
check('à défaut, la dernière « Auto »', legacy.students[0].examLevel, 'TB');
check(
  'et un avertissement',
  legacy.warnings.some((w) => w.includes('Auto')),
  true
);

rule();
if (result.warnings.length) {
  line(`AVERTISSEMENTS (${result.warnings.length}) :`);
  result.warnings.forEach((w) => line(`  ⚠ ${w}`));
} else {
  line('Aucun avertissement.');
}

line(failures === 0 ? '\nTous les contrôles synthétiques passent.' : `\n${failures} en échec.`);
process.exit(failures === 0 ? 0 : 1);
