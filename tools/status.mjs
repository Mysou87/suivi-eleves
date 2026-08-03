// État de la base, sans afficher de données personnelles.
//   node tools/status.mjs

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../js/config.js';

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TABLES = [
  'students',
  'suivi_courses',
  'suivi_items',
  'suivi_thresholds',
  'suivi_socle',
  'suivi_enrollments',
  'suivi_counters',
  'suivi_history',
  'suivi_targets',
  'suivi_snapshots',
  'suivi_imports',
  'suivi_advice',
];

for (const t of TABLES) {
  const { count, error } = await db.from(t).select('*', { count: 'exact', head: true });
  console.log(`  ${t.padEnd(20)} ${error ? 'ERREUR ' + error.message : count}`);
}

const { data: classes } = await db.from('students').select('class_name, year_level');
const byClass = new Map();
(classes || []).forEach((s) => {
  const key = s.class_name || `${s.year_level || '?'} sans classe`;
  byClass.set(key, (byClass.get(key) || 0) + 1);
});
console.log(
  `\n  classes : ${[...byClass.entries()].sort().map(([k, v]) => `${k} (${v})`).join(' · ')}`
);

const { data: courses } = await db
  .from('suivi_courses')
  .select('sheet_name, course_label, year_level, group_letter')
  .order('sheet_name');
console.log('\n  cours :');
(courses || []).forEach((c) =>
  console.log(
    `    ${c.sheet_name.padEnd(16)} → ${c.course_label.padEnd(16)} ${c.year_level}e ${
      c.group_letter ? 'groupe ' + c.group_letter : ''
    }`
  )
);
