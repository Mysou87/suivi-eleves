// Accès aux données pour l'app élève. Aucun DOM ici : ce module est testable
// en ligne de commande (tools/test-data.mjs) autant qu'utilisable dans la page.

import { norm, studentKey } from './parser.js';
import { LEVELS, currentPeriod } from './rules.js';

/**
 * Reconstruit un « élève » au format attendu par rules.js depuis une ligne de
 * `suivi_counters`. Les dates des devoirs libres et des quiz sont conservées en
 * base précisément pour pouvoir recalculer les compteurs à n'importe quelle date.
 */
export function studentFromCounters(row) {
  const toEntries = (dates) =>
    (dates || []).map((d) => ({
      label: d,
      date: /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`) : null,
    }));

  return {
    dl: toEntries(row.dl_dates),
    quiz: toEntries(row.quiz_dates),
    bex: (row.bex || []).map((b) => ({
      index: b.index,
      label: b.label,
      attempts: Array.from({ length: b.attempts || 0 }, () => '1'),
    })),
    missions: Array.from({ length: row.missions || 0 }, () => ({})),
    depassements: Array.from({ length: row.depassements || 0 }, () => ({})),
    examLevel: row.exam_level || null,
  };
}

/** lignes de `suivi_thresholds` → { 1: { JS: {...}, … }, 2: …, 3: … } */
export function thresholdsFromRows(rows) {
  const periods = {};
  (rows || []).forEach((r) => {
    if (!periods[r.period]) periods[r.period] = {};
    periods[r.period][r.level] = {
      dl: r.dl,
      quiz: r.quiz,
      validations: r.validations,
      bexDiff: r.bex_diff,
      depassements: r.depassements,
      examCondition: r.exam_condition || undefined,
    };
  });
  return periods;
}

/**
 * Cherche un élève par prénom, nom et classe. La comparaison se fait côté
 * client pour être insensible à la casse et aux accents : une classe ne compte
 * qu'une trentaine d'élèves, le coût est négligeable.
 */
export async function findStudent(db, { firstName, lastName, className }) {
  const { data, error } = await db
    .from('students')
    .select('id, first_name, last_name, class_name, year_level')
    .eq('class_name', className);

  if (error) return { error: error.message };

  const key = studentKey(lastName, firstName);
  const exact = (data || []).filter((s) => studentKey(s.last_name, s.first_name) === key);
  if (exact.length === 1) return { student: exact[0] };
  if (exact.length > 1) return { error: 'Plusieurs élèves portent ce nom dans cette classe.' };

  // Repêchage : nom de famille seul, pour tolérer un prénom composé mal saisi.
  const sameLast = (data || []).filter((s) => norm(s.last_name) === norm(lastName));
  if (sameLast.length === 1) return { student: sameLast[0], approximate: true };

  return { notFound: true };
}

/** classes disponibles, pour la liste déroulante de connexion */
export async function loadClasses(db) {
  const { data, error } = await db.from('students').select('class_name');
  if (error) return [];
  return [...new Set((data || []).map((s) => s.class_name).filter(Boolean))].sort();
}

/**
 * Tout ce dont l'écran élève a besoin : ses cours, ses compteurs, les seuils et
 * le socle de chaque cours, les noms des BEX, et l'objectif qu'il s'est fixé.
 */
export async function loadDashboard(db, studentId, when = new Date()) {
  const period = currentPeriod(when);

  const { data: enrollments, error } = await db
    .from('suivi_enrollments')
    .select('course_id, class_name, suivi_courses(id, sheet_name, course_label, year_level, group_letter)')
    .eq('student_id', studentId)
    .eq('is_active', true);

  if (error) return { error: error.message };
  if (!enrollments || !enrollments.length) return { courses: [] };

  const courseIds = enrollments.map((e) => e.course_id);
  const labels = [...new Set(enrollments.map((e) => e.suivi_courses?.course_label).filter(Boolean))];

  const [countersRes, thresholdsRes, socleRes, itemsRes, targetsRes] = await Promise.all([
    db.from('suivi_counters').select('*').eq('student_id', studentId).in('course_id', courseIds),
    db.from('suivi_thresholds').select('*').in('course_label', labels),
    db.from('suivi_socle').select('*').in('course_label', labels),
    db.from('suivi_items').select('*').in('course_label', labels).eq('kind', 'bex'),
    db.from('suivi_targets').select('*').eq('student_id', studentId).eq('period', period),
  ]);

  const countersByCourse = new Map((countersRes.data || []).map((c) => [c.course_id, c]));
  const targetsByCourse = new Map((targetsRes.data || []).map((t) => [t.course_id, t.target_level]));

  const courses = enrollments
    .filter((e) => e.suivi_courses)
    .map((e) => {
      const course = e.suivi_courses;
      const label = course.course_label;
      const counterRow = countersByCourse.get(course.id);
      const socleRow = (socleRes.data || []).find((s) => s.course_label === label);
      const bexLabels = (itemsRes.data || [])
        .filter((i) => i.course_label === label)
        .sort((a, b) => a.position - b.position)
        .map((i) => i.label);

      return {
        id: course.id,
        sheetName: course.sheet_name,
        label,
        yearLevel: course.year_level,
        groupLetter: course.group_letter,
        counterRow: counterRow || null,
        student: counterRow ? studentFromCounters(counterRow) : null,
        thresholds: thresholdsFromRows(
          (thresholdsRes.data || []).filter((t) => t.course_label === label)
        ),
        socle: { socle: socleRow?.bex_numbers || [], socleByPeriod: { 3: socleRow?.bex_numbers || [] } },
        bexLabels,
        target: targetsByCourse.get(course.id) || null,
        updatedAt: counterRow?.updated_at || null,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  return { period, courses };
}

/** enregistre l'objectif choisi par l'élève */
export async function saveTarget(db, studentId, courseId, period, level) {
  if (!LEVELS.includes(level)) return { error: 'niveau inconnu' };
  const { error } = await db.from('suivi_targets').upsert(
    {
      student_id: studentId,
      course_id: courseId,
      period,
      target_level: level,
      chosen_at: new Date().toISOString(),
    },
    { onConflict: 'student_id,course_id,period' }
  );
  return { error: error?.message || null };
}

/** textes de conseil, tels que Laureline les a écrits dans l'admin */
export async function loadAdvice(db) {
  const { data } = await db.from('suivi_advice').select('key, body');
  const map = {};
  (data || []).forEach((a) => {
    map[a.key] = a.body;
  });
  return map;
}

/**
 * Ne garde que les relevés où quelque chose a bougé, avec l'écart par rapport
 * au précédent. Un import qui ne change rien ne doit pas apparaitre comme une
 * étape de la progression.
 */
export function compressHistory(rows) {
  const FIELDS = {
    dl: 'dl',
    quiz: 'quiz',
    validations: 'validations',
    bex_diff: 'bexDiff',
    depassements: 'depassements',
  };

  const out = [];
  let previous = null;

  (rows || []).forEach((row) => {
    const delta = {};
    let changed = false;

    Object.entries(FIELDS).forEach(([column, key]) => {
      const difference = (row[column] ?? 0) - (previous ? previous[column] ?? 0 : 0);
      if (difference !== 0) {
        delta[key] = difference;
        changed = true;
      }
    });

    if (changed) out.push({ ...row, delta });
    previous = row;
  });

  return out;
}

/** relevés successifs, pour la courbe de progression */
export async function loadHistory(db, studentId, courseId) {
  const { data } = await db
    .from('suivi_history')
    .select('captured_at, period, dl, quiz, validations, bex_diff, depassements, level')
    .eq('student_id', studentId)
    .eq('course_id', courseId)
    .order('captured_at');
  return data || [];
}

/**
 * Vue d'ensemble pour l'admin : tous les élèves, par cours, avec leurs
 * compteurs, le niveau atteint et l'objectif qu'ils se sont fixé.
 */
export async function loadAdminOverview(db, when = new Date()) {
  const period = currentPeriod(when);

  const [coursesRes, countersRes, studentsRes, thresholdsRes, socleRes, targetsRes, enrollmentsRes] =
    await Promise.all([
      db.from('suivi_courses').select('*').order('sheet_name'),
      db.from('suivi_counters').select('*'),
      db.from('students').select('id, first_name, last_name, class_name'),
      db.from('suivi_thresholds').select('*'),
      db.from('suivi_socle').select('*'),
      db.from('suivi_targets').select('student_id, course_id, target_level').eq('period', period),
      db.from('suivi_enrollments').select('student_id, course_id').eq('is_active', true),
    ]);

  const error = [coursesRes, countersRes, studentsRes].find((r) => r.error)?.error;
  if (error) return { error: error.message };

  const studentById = new Map((studentsRes.data || []).map((s) => [s.id, s]));
  const targetByPair = new Map(
    (targetsRes.data || []).map((t) => [`${t.student_id}|${t.course_id}`, t.target_level])
  );
  // Un élève parti (départ, changement de groupe) garde ses compteurs en base
  // pour l'historique, mais ne doit plus apparaitre comme actif dans ce cours.
  const activePairs = new Set(
    (enrollmentsRes.data || []).map((e) => `${e.student_id}|${e.course_id}`)
  );

  const courses = (coursesRes.data || []).map((course) => {
    const thresholdRows = (thresholdsRes.data || []).filter(
      (t) => t.course_label === course.course_label
    );
    const socleRow = (socleRes.data || []).find((s) => s.course_label === course.course_label);

    const rows = (countersRes.data || [])
      .filter((c) => c.course_id === course.id && activePairs.has(`${c.student_id}|${c.course_id}`))
      .map((counterRow) => ({
        student: studentById.get(counterRow.student_id) || null,
        counterRow,
        student_model: studentFromCounters(counterRow),
        target: targetByPair.get(`${counterRow.student_id}|${course.id}`) || null,
      }))
      .filter((r) => r.student)
      .sort((a, b) => a.student.last_name.localeCompare(b.student.last_name));

    return {
      ...course,
      thresholds: thresholdsFromRows(thresholdRows),
      socle: { socleByPeriod: { 3: socleRow?.bex_numbers || [] } },
      rows,
    };
  });

  return { period, courses };
}

/** bulletins figés, consultables par l'élève */
export async function loadSnapshots(db, studentId, courseId) {
  const { data } = await db
    .from('suivi_snapshots')
    .select('*')
    .eq('student_id', studentId)
    .eq('course_id', courseId)
    .order('period');
  return data || [];
}
