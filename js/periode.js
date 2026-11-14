// Page « Périodes par cours » : fonctionne EN LIGNE, sans l'ordinateur de la prof.
//
// Faire passer un cours à la période suivante = 1) calculer les bulletins de ce
// cours (lecture seule, clé anon), 2) les envoyer avec le mot de passe à la
// fonction `suivi_switch_period` (sql/periode.sql), qui les fige et change la
// période du cours d'un seul coup. Le mot de passe est vérifié par la base.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { prepareFreeze } from './freeze.js';

const $ = (id) => document.getElementById(id);
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function showError(text) {
  $('error').textContent = text;
  $('error').hidden = !text;
}

async function render() {
  const box = $('courses');
  const { data: courses, error } = await db.from('suivi_courses').select('*').order('sheet_name');

  if (error) {
    box.textContent = `Lecture impossible : ${error.message}`;
    return;
  }
  if (courses.length && courses[0].active_period === undefined) {
    box.textContent = "La base n'est pas encore prête : exécute d'abord sql/periode.sql dans Supabase.";
    return;
  }

  box.innerHTML = '';
  courses.forEach((course) => box.append(courseRow(course)));
}

function courseRow(course) {
  const period = course.active_period;
  const row = document.createElement('div');
  row.className = 'course-row';

  const info = document.createElement('div');
  info.className = 'grow';
  info.innerHTML = `<strong></strong><br><span class="muted small">Les élèves voient la période ${period}</span>`;
  info.querySelector('strong').textContent = course.sheet_name;
  row.append(info);

  const status = document.createElement('span');
  status.className = 'status muted small';

  if (period < 3) {
    const next = document.createElement('button');
    next.type = 'button';
    next.textContent = `Figer la P${period} et passer en P${period + 1}`;
    next.addEventListener('click', () =>
      switchCourse(course, period + 1, true, status, row)
    );
    row.append(next);
  }

  if (period > 1) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'link';
    back.textContent = `revenir en P${period - 1}`;
    back.title = 'Les bulletins déjà figés restent tels quels.';
    back.addEventListener('click', () =>
      switchCourse(course, period - 1, false, status, row)
    );
    row.append(back);
  }

  row.append(status);
  return row;
}

async function switchCourse(course, target, freeze, status, row) {
  showError('');
  const password = $('password').value;
  if (!password) {
    showError("Tape d'abord le mot de passe.");
    $('password').focus();
    return;
  }

  const from = course.active_period;
  const question = freeze
    ? `${course.sheet_name} : figer les bulletins de la P${from} et passer en P${target} ?`
    : `${course.sheet_name} : revenir en P${target} ? (les bulletins figés ne bougent pas)`;
  if (!confirm(question)) return;

  row.querySelectorAll('button').forEach((b) => (b.disabled = true));

  let rows = [];
  if (freeze) {
    status.textContent = 'Calcul des bulletins…';
    const prepared = await prepareFreeze(db, from, { courseId: course.id });
    if (prepared.error) {
      status.textContent = '';
      showError(`Impossible de calculer les bulletins : ${prepared.error}`);
      row.querySelectorAll('button').forEach((b) => (b.disabled = false));
      return;
    }
    rows = prepared.rows;
  }

  status.textContent = 'Envoi…';
  const { data, error } = await db.rpc('suivi_switch_period', {
    p_password: password,
    p_course_id: course.id,
    p_period: target,
    p_snapshots: rows,
  });

  if (error) {
    status.textContent = '';
    showError(error.message);
    row.querySelectorAll('button').forEach((b) => (b.disabled = false));
    return;
  }

  const done = freeze
    ? `${course.sheet_name} : ${data} bulletin(s) de P${from} figé(s), passé en P${target}.`
    : `${course.sheet_name} : revenu en P${target}.`;
  await render();
  showError('');
  const note = document.createElement('p');
  note.className = 'saved';
  note.textContent = done;
  $('courses').prepend(note);
}

render();
