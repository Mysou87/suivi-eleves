// Import du classeur vers Supabase, en ligne de commande.
//   node tools/import.mjs ["chemin\\vers\\Feuilles de cotes.xlsx"] [--dry]
//
// --dry lit et affiche ce qui serait écrit, sans rien envoyer.
// La lecture et l'envoi vivent dans run-import.mjs, partagés avec le bouton
// « Mettre à jour maintenant » de l'administration.

import { readWorkbook, syncParsed, countInscriptions, workbookInfo } from './run-import.mjs';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const file = args.find((a) => !a.startsWith('--')) || null;

// Sans argument, le classeur est cherché tout seul : le chemin diffère d'un
// ordinateur à l'autre.
const info = await workbookInfo(file);
if (!info.exists) {
  console.error(`Classeur introuvable : ${info.path}`);
  console.error(
    "Indique son chemin en argument, ou exporte WORKBOOK_PATH depuis js/config.local.js."
  );
  process.exit(1);
}

console.log(`Lecture de ${info.path}  (${info.how})`);

function describe(parsed) {
  console.log(
    `  ${parsed.groups.length} onglets · ${countInscriptions(parsed)} inscriptions · ` +
      `${parsed.thresholds.length} grilles de seuils · ${parsed.nomenclature.length} nomenclatures`
  );
}

const parsed = await readWorkbook(info.path);
describe(parsed);

if (dry) {
  console.log('\n--dry : rien n\'a été envoyé.');
  parsed.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  process.exit(0);
}

console.log('\nEnvoi vers Supabase…');

let report;
try {
  report = await syncParsed(parsed, info.name, info.modifiedAt);
} catch (error) {
  // Typiquement la clé d'écriture absente : un message suffit, la pile d'appels
  // n'apprendrait rien.
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
}

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
