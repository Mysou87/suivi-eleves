// Contrôle des droits d'accès à la base, après sql/policies.sql.
//   npm run check:policies
//
// Vérifie trois choses avec la clé PUBLIÉE (celle que n'importe qui possède) :
//   1. elle lit toujours — sinon l'app élève est cassée ;
//   2. elle n'écrit plus les résultats — c'était le trou à refermer ;
//   3. elle enregistre encore l'objectif choisi par l'élève — seule exception.
// Puis que la clé privée, elle, écrit bien.
//
// Aucun test ne laisse de trace : les écritures tentées réutilisent les valeurs
// déjà en base, et l'insertion d'essai porte un élève inexistant, donc refusée
// par la clé étrangère même si les droits, eux, l'autorisaient.

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, loadLocalSecrets } from '../js/config.js';

const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const { SUPABASE_SERVICE_KEY } = await loadLocalSecrets();

let failures = 0;
const ok = (message) => console.log(`  ok   ${message}`);
const bad = (message) => {
  failures++;
  console.log(`  ÉCHEC ${message}`);
};

/** Une erreur de droits, par opposition à une erreur de données. */
function isDenied(error) {
  if (!error) return false;
  return (
    error.code === '42501' ||
    /row-level security|permission denied|violates row-level/i.test(error.message || '')
  );
}

/**
 * ⚠️ Piège : un UPDATE (ou un DELETE) interdit par RLS ne renvoie AUCUNE erreur.
 * Les lignes deviennent simplement invisibles à l'opération, qui en modifie zéro
 * et répond « tout va bien ». Un test qui ne regarde que l'erreur conclut donc
 * à tort que c'est protégé — ou, ici, à tort que ça ne l'est pas.
 *
 * La seule preuve est de demander les lignes touchées (`.select()`) et de
 * compter : zéro ligne = refusé, une ligne = l'écriture est bien passée.
 */
function verdict(label, { data, error }) {
  if (isDenied(error)) return ok(`${label} : refusée`);
  if (error) return ok(`${label} : refusée (${error.code || error.message})`);
  if (!data || data.length === 0) return ok(`${label} : refusée (0 ligne touchée)`);
  return bad(`${label} : ${data.length} ligne(s) MODIFIÉE(S) — l'écriture est encore possible`);
}

console.log('\nAvec la clé publiée (celle du dépôt public)\n');

// 1. la lecture doit continuer de marcher, sinon plus rien ne s'affiche
for (const table of ['suivi_counters', 'suivi_thresholds', 'suivi_advice', 'suivi_items']) {
  const { error } = await anon.from(table).select('*').limit(1);
  if (error) bad(`${table} : lecture refusée (${error.message})`);
  else ok(`${table} : lecture`);
}

// 2. l'écriture des résultats doit être refusée
const { data: counter } = await anon
  .from('suivi_counters')
  .select('student_id, course_id, dl')
  .limit(1)
  .maybeSingle();

if (!counter) {
  console.log('  (aucun compteur en base : test d\'écriture impossible)');
} else {
  // On réécrit la valeur déjà présente : si les droits ont été mal refermés,
  // la base n'est pas modifiée pour autant.
  verdict(
    'suivi_counters : modification',
    await anon
      .from('suivi_counters')
      .update({ dl: counter.dl })
      .eq('student_id', counter.student_id)
      .eq('course_id', counter.course_id)
      .select('student_id')
  );
}

const { data: advice } = await anon.from('suivi_advice').select('key, body').limit(1).maybeSingle();
if (advice) {
  verdict(
    'suivi_advice : modification',
    await anon.from('suivi_advice').update({ body: advice.body }).eq('key', advice.key).select('key')
  );
}

// Insertion d'essai sur un élève qui n'existe pas : rien ne peut être créé.
const GHOST = '00000000-0000-0000-0000-000000000000';
const { error: snapError } = await anon
  .from('suivi_snapshots')
  .insert({ student_id: GHOST, course_id: 1, period: 1 });
if (isDenied(snapError)) ok('suivi_snapshots : insertion refusée');
else if (snapError?.code === '23503')
  bad('suivi_snapshots : INSERTION AUTORISÉE (refusée seulement par la clé étrangère)');
else if (snapError) ok(`suivi_snapshots : insertion refusée (${snapError.code})`);
else bad('suivi_snapshots : INSERTION RÉUSSIE — RLS absent sur cette table');

for (const table of ['suivi_history', 'suivi_enrollments']) {
  const { error } = await anon.from(table).insert({ student_id: GHOST, course_id: 1 });
  if (isDenied(error)) ok(`${table} : insertion refusée`);
  else if (error?.code === '23503') bad(`${table} : INSERTION AUTORISÉE (bloquée par la clé étrangère seulement)`);
  else if (error) ok(`${table} : insertion refusée (${error.code})`);
  else bad(`${table} : INSERTION RÉUSSIE — écriture encore ouverte`);
}

// 3. l'élève doit pouvoir continuer à choisir son objectif
const { data: target } = await anon
  .from('suivi_targets')
  .select('student_id, course_id, period, target_level')
  .limit(1)
  .maybeSingle();

if (!target) {
  console.log('  (aucun objectif en base : test impossible sans en créer un)');
} else {
  const { error } = await anon.from('suivi_targets').upsert(
    { ...target, chosen_at: new Date().toISOString() },
    { onConflict: 'student_id,course_id,period' }
  );
  if (error) bad(`suivi_targets : l'élève ne peut plus choisir son objectif (${error.message})`);
  else ok('suivi_targets : objectif enregistré (comme il faut)');

  // Un élève doit pouvoir écrire son objectif, mais pas EFFACER celui d'un autre.
  // Si la suppression passait quand même, on remet aussitôt la ligne en place.
  const removed = await anon
    .from('suivi_targets')
    .delete()
    .eq('student_id', target.student_id)
    .eq('course_id', target.course_id)
    .eq('period', target.period)
    .select('student_id');

  verdict('suivi_targets : suppression', removed);

  if (removed.data?.length) {
    const { error: restoreError } = await anon.from('suivi_targets').insert(target);
    console.log(
      restoreError
        ? `         ⚠ objectif supprimé et NON restauré (${restoreError.message})`
        : '         (objectif remis en place)'
    );
  }
}

console.log('\nAvec la clé privée (js/config.local.js)\n');

if (!SUPABASE_SERVICE_KEY) {
  bad("clé d'écriture absente : l'import ne fonctionnera pas");
} else {
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: row, error: readError } = await admin
    .from('suivi_counters')
    .select('student_id, course_id, dl')
    .limit(1)
    .maybeSingle();
  if (readError) bad(`lecture refusée (${readError.message})`);
  else ok('lecture');

  if (row) {
    const { data: written, error } = await admin
      .from('suivi_counters')
      .update({ dl: row.dl })
      .eq('student_id', row.student_id)
      .eq('course_id', row.course_id)
      .select('student_id');
    if (error) bad(`écriture refusée (${error.message}) — l'import échouera`);
    else if (!written?.length) bad("écriture silencieusement ignorée — l'import n'enregistrerait rien");
    else ok('écriture (valeur inchangée)');
  }
}

console.log(
  failures
    ? `\n${failures} problème(s). Relis sql/policies.sql et relance-le dans Supabase.\n`
    : '\nDroits corrects : lecture pour tous, écriture pour toi seule.\n'
);
process.exit(failures ? 1 : 0);
