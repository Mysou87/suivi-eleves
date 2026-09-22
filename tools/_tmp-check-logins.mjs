import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, loadLocalSecrets } from '../js/config.js';
import { markSeen } from '../js/data.js';

const { SUPABASE_SERVICE_KEY } = await loadLocalSecrets();
const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: someStudent } = await admin.from('students').select('id, first_name, last_name').limit(1).single();
console.log('Élève test :', someStudent.first_name, someStudent.last_name);

await markSeen(anon, someStudent.id);
const first = await admin.from('suivi_logins').select('*').eq('student_id', someStudent.id).single();
console.log('Après 1re connexion :', first.data, first.error?.message || '');

await new Promise((r) => setTimeout(r, 1100));
await markSeen(anon, someStudent.id);
const second = await admin.from('suivi_logins').select('*').eq('student_id', someStudent.id).single();
console.log('Après 2e connexion (doit avoir avancé) :', second.data, second.error?.message || '');

const { count } = await admin.from('suivi_logins').select('student_id', { count: 'exact', head: true }).eq('student_id', someStudent.id);
console.log('Nombre de lignes pour cet élève (doit être 1) :', count);

const { error: writeAttempt } = await anon.from('suivi_logins').update({ last_seen_at: new Date().toISOString() }).eq('student_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa').select();
console.log('Écriture directe non passée par markSeen (sanity) :', writeAttempt?.message || 'ok');

await admin.from('suivi_logins').delete().eq('student_id', someStudent.id);
console.log('Nettoyé.');
