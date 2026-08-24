// Figeage des bulletins au conseil de guidance.
//
// Une fois figé, un bulletin ne bouge plus : les imports suivants n'y touchent
// pas. Les devoirs libres et les quiz sont recalculés à la date du DERNIER
// COURS de la période, pas à la date du conseil, pour qu'une case cochée
// pendant la semaine tampon ne gonfle pas le bulletin qui se clôture.

import { studentFromCounters, thresholdsFromRows } from './data.js';
import { countersAt, evaluate, periodByNumber, socleForPeriod } from './rules.js';

/**
 * Prépare les bulletins d'une période sans rien écrire : renvoie la liste des
 * lignes qui seraient créées, plus celles déjà figées.
 */
export async function prepareFreeze(db, period) {
  const definition = periodByNumber(period);
  if (!definition) return { error: `période ${period} inconnue` };

  const [countersRes, coursesRes, thresholdsRes, socleRes, targetsRes, existingRes, enrollmentsRes] =
    await Promise.all([
      db.from('suivi_counters').select('*'),
      db.from('suivi_courses').select('id, sheet_name, course_label'),
      db.from('suivi_thresholds').select('*'),
      db.from('suivi_socle').select('*'),
      db.from('suivi_targets').select('student_id, course_id, target_level').eq('period', period),
      db.from('suivi_snapshots').select('student_id, course_id').eq('period', period),
      db.from('suivi_enrollments').select('student_id, course_id').eq('is_active', true),
    ]);

  const error = [countersRes, coursesRes, thresholdsRes].find((r) => r.error)?.error;
  if (error) return { error: error.message };

  // Un élève parti entre le dernier import et le figeage ne reçoit pas de
  // bulletin pour ce cours : son inscription a été désactivée par l'import.
  const activePairs = new Set(
    (enrollmentsRes.data || []).map((e) => `${e.student_id}|${e.course_id}`)
  );

  const courseById = new Map((coursesRes.data || []).map((c) => [c.id, c]));
  const thresholdsByLabel = new Map();
  (thresholdsRes.data || []).forEach((row) => {
    if (!thresholdsByLabel.has(row.course_label)) thresholdsByLabel.set(row.course_label, []);
    thresholdsByLabel.get(row.course_label).push(row);
  });
  const socleByLabel = new Map((socleRes.data || []).map((s) => [s.course_label, s.bex_numbers || []]));
  const targetByPair = new Map(
    (targetsRes.data || []).map((t) => [`${t.student_id}|${t.course_id}`, t.target_level])
  );
  const alreadyFrozen = new Set(
    (existingRes.data || []).map((s) => `${s.student_id}|${s.course_id}`)
  );

  const rows = [];
  const skipped = [];

  (countersRes.data || []).forEach((counterRow) => {
    const course = courseById.get(counterRow.course_id);
    if (!course) return;

    const pair = `${counterRow.student_id}|${counterRow.course_id}`;
    if (!activePairs.has(pair)) return;
    if (alreadyFrozen.has(pair)) {
      skipped.push(pair);
      return;
    }

    const periods = thresholdsFromRows(thresholdsByLabel.get(course.course_label));
    const levels = periods[period];
    if (!levels) return;

    const student = studentFromCounters(counterRow);
    // Coupure à la date du dernier cours : les devoirs libres et les quiz sont
    // datés, les BEX et missions ne le sont pas et sont donc prises telles quelles.
    const counters = countersAt(student, definition.lastCourse);
    const socleCourse = { socleByPeriod: { 3: socleByLabel.get(course.course_label) || [] } };
    const assessment = evaluate(student, levels, {
      socle: socleForPeriod(socleCourse, period),
      examLevel: student.examLevel,
      counters,
    });

    rows.push({
      student_id: counterRow.student_id,
      course_id: counterRow.course_id,
      period,
      dl: counters.dl,
      quiz: counters.quiz,
      validations: counters.validations,
      bex_diff: counters.bexDiff,
      depassements: counters.depassements,
      exam_level: student.examLevel,
      level: assessment.level,
      target_level: targetByPair.get(pair) || null,
      detail: {
        bex: counterRow.bex,
        missions: counters.missions,
        bexValidations: counters.bexValidations,
        pendingExam: assessment.pendingExam || null,
        socleMissing: assessment.socleMissing,
        lastCourse: definition.lastCourse,
      },
    });
  });

  return { period, definition, rows, skipped };
}

/** écrit les bulletins préparés ; les bulletins déjà figés ne sont pas touchés */
export async function freezePeriod(db, period, options = {}) {
  const prepared = await prepareFreeze(db, period);
  if (prepared.error) return prepared;
  if (options.dry) return { ...prepared, written: 0 };

  let written = 0;
  for (let i = 0; i < prepared.rows.length; i += 200) {
    const part = prepared.rows.slice(i, i + 200);
    const { error } = await db.from('suivi_snapshots').insert(part);
    if (error) return { ...prepared, error: error.message, written };
    written += part.length;
  }

  return { ...prepared, written };
}

/**
 * Périodes dont le conseil de guidance est passé mais qui n'ont pas encore été
 * figées. Sert à proposer le figeage dans l'admin.
 */
export async function pendingFreezes(db, when = new Date()) {
  const now = new Date(when);
  const due = [1, 2, 3].filter((p) => new Date(periodByNumber(p).freeze) <= now);
  if (!due.length) return [];

  const { data } = await db.from('suivi_snapshots').select('period');
  const done = new Set((data || []).map((s) => s.period));
  return due.filter((p) => !done.has(p));
}
