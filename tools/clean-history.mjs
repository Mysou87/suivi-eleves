// Nettoyage de l'historique de progression.
//   node tools/clean-history.mjs          → montre ce qui serait supprimé
//   node tools/clean-history.mjs --apply  → supprime
//
// Les tout premiers imports (essais de mise en route) ont enregistré plusieurs
// fois le même état pour chaque élève. L'affichage les masque déjà, mais autant
// que la base dise la vérité.
//
// Règle : pour chaque élève et chaque cours, on garde la PREMIÈRE ligne, puis
// seulement celles dont les compteurs diffèrent de la dernière gardée. C'est
// exactement ce que l'élève voit (une étape = un changement) ; aucune vraie
// progression ne peut donc disparaitre.

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, loadLocalSecrets } from '../js/config.js';

const apply = process.argv.includes('--apply');
const { SUPABASE_SERVICE_KEY } = await loadLocalSecrets();
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const COUNTERS = ['dl', 'quiz', 'validations', 'bex_diff', 'depassements'];
const signature = (row) => COUNTERS.map((k) => row[k] ?? 0).join('|');

const { data: rows, error } = await db
  .from('suivi_history')
  .select('id, student_id, course_id, import_id, captured_at, period, level, dl, quiz, validations, bex_diff, depassements')
  .order('id');

if (error) {
  console.error(`Lecture impossible : ${error.message}`);
  process.exit(1);
}

console.log(`${rows.length} lignes d'historique en base.\n`);

const byImport = new Map();
rows.forEach((r) => {
  const key = r.import_id ?? '(sans import)';
  byImport.set(key, (byImport.get(key) || 0) + 1);
});
console.log('Réparties par import :');
[...byImport].forEach(([id, n]) => console.log(`  import ${String(id).padEnd(14)} ${String(n).padStart(4)} lignes`));

// Lignes portant une progression réelle : à conserver quoi qu'il arrive.
const meaningful = rows.filter((r) => COUNTERS.some((k) => r[k]));
console.log(`\n${meaningful.length} ligne(s) avec au moins un compteur non nul :`);
meaningful.forEach((r) =>
  console.log(
    `  id ${String(r.id).padStart(4)} · élève ${r.student_id.slice(0, 8)} · cours ${r.course_id} · ` +
      `DL ${r.dl} Q ${r.quiz} V ${r.validations} BD ${r.bex_diff} D+ ${r.depassements} → ${r.level}`
  )
);

// --- sélection
const lastKept = new Map();
const keep = [];
const drop = [];

rows.forEach((row) => {
  const key = `${row.student_id}|${row.course_id}`;
  const current = signature(row);
  if (lastKept.get(key) === current) drop.push(row);
  else {
    keep.push(row);
    lastKept.set(key, current);
  }
});

console.log(`\nÀ garder    : ${keep.length}`);
console.log(`À supprimer : ${drop.length} (états répétés à l'identique)`);

const droppedMeaningful = drop.filter((r) => COUNTERS.some((k) => r[k]));
console.log(
  droppedMeaningful.length
    ? `  dont ${droppedMeaningful.length} avec un compteur non nul — ce sont des répétitions de cet état, pas sa disparition`
    : '  aucune ligne non nulle supprimée'
);

// Sans `process.exit`, qui fait parfois planter Node sous Windows quand le
// client Supabase a encore une connexion ouverte.
if (!drop.length) {
  console.log('\nRien à nettoyer.');
} else if (!apply) {
  console.log('\nEssai seulement. Relance avec --apply pour supprimer.');
} else {
  let deleted = 0;
  let failed = null;

  for (let i = 0; i < drop.length && !failed; i += 100) {
    const ids = drop.slice(i, i + 100).map((r) => r.id);
    const { error: deleteError } = await db.from('suivi_history').delete().in('id', ids);
    if (deleteError) failed = deleteError.message;
    else deleted += ids.length;
  }

  const { count } = await db.from('suivi_history').select('id', { count: 'exact', head: true });

  if (failed) {
    console.error(`\nSuppression interrompue : ${failed}`);
    console.error(`${deleted} ligne(s) supprimée(s) avant l'erreur, il reste ${count} ligne(s).`);
    process.exitCode = 1;
  } else {
    console.log(`\n${deleted} ligne(s) supprimée(s). Il reste ${count} ligne(s) d'historique.`);
  }
}
