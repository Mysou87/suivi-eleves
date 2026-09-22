import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, loadLocalSecrets } from '../js/config.js';
import { markSeen } from '../js/data.js';

const { SUPABASE_SERVICE_KEY } = await loadLocalSecrets();
const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: someStudent } = await admin.from('students').select('id, first_name, last_name').limit(1).single();
console.log('Élève test :', someStudent.first_name, someStudent.last_name);

// Comme le ferait l'écran élève (clé anon), mais sans avaler l'erreur cette fois.
const { data: upsertData, error: upsertErr } = await anon
  .from('suivi_logins')
  .upsert({ student_id: someStudent.id, last_seen_at: new Date().toISOString() }, { onConflict: 'student_id' })
  .select();
console.log('Résultat upsert direct (clé anon) :', upsertData, upsertErr ? `ERREUR: ${upsertErr.message} (code ${upsertErr.code})` : 'ok');

const { data: row, error: readErr } = await admin.from('suivi_logins').select('*').eq('student_id', someStudent.id).single();
console.log('Lu avec la clé service_role :', row, readErr?.message || '');

// L'anon ne doit PAS pouvoir lire.
const { data: anonRead, error: anonReadErr } = await anon.from('suivi_logins').select('*').eq('student_id', someStudent.id);
console.log('Lecture avec la clé anon (doit être vide/refusée) :', anonRead, anonReadErr?.message || '');

// Deuxième connexion : doit mettre à jour la même ligne (upsert), pas en créer une deuxième.
await markSeen(anon, someStudent.id);
const { count } = await admin.from('suivi_logins').select('student_id', { count: 'exact', head: true }).eq('student_id', someStudent.id);
console.log('Nombre de lignes pour cet élève après 2 connexions (doit être 1) :', count);

// Nettoyage : on ne laisse pas de fausse trace de connexion sur un vrai élève.
await admin.from('suivi_logins').delete().eq('student_id', someStudent.id);
console.log('Nettoyé.');
