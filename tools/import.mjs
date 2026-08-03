// Import du classeur vers Supabase, en ligne de commande.
//   node tools/import.mjs ["chemin\\vers\\Feuilles de cotes.ods"] [--dry]
//
// --dry lit et affiche ce qui serait écrit, sans rien envoyer.

import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { parseWorkbook } from '../js/parser.js';
import { syncWorkbook } from '../js/sync.js';
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SCHOOL_YEAR_START,
  WORKBOOK_PATH,
  IGNORED_SHEETS,
} from '../js/config.js';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const file = args.find((a) => !a.startsWith('--')) || WORKBOOK_PATH;

console.log(`Lecture de ${file}`);
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

const parsed = parseWorkbook(sheets, {
  startYear: SCHOOL_YEAR_START,
  ignore: IGNORED_SHEETS,
});

const students = parsed.groups.reduce((n, g) => n + g.students.length, 0);
console.log(
  `  ${parsed.groups.length} onglets · ${students} inscriptions · ` +
    `${parsed.thresholds.length} grilles de seuils · ${parsed.nomenclature.length} nomenclatures`
);

if (dry) {
  console.log('\n--dry : rien n\'a été envoyé.');
  parsed.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  process.exit(0);
}

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
console.log('\nEnvoi vers Supabase…');

const report = await syncWorkbook(db, parsed, {
  fileName: file.split(/[\\/]/).pop(),
  source: 'manuel',
});

console.log('\nRésultat :');
Object.entries(report.steps).forEach(([k, v]) => console.log(`  ${k.padEnd(16)} ${v}`));

if (report.warnings.length) {
  console.log(`\nAvertissements (${report.warnings.length}) :`);
  report.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
}

if (report.errors.length) {
  console.log(`\nERREURS (${report.errors.length}) :`);
  report.errors.forEach((e) => console.log(`  ✗ ${e}`));
  process.exit(1);
}

console.log(`\nImport ${report.importId} terminé.`);
