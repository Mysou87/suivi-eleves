// Écriture du classeur lu vers Supabase.
//
// Le client Supabase a la même API en Node et dans le navigateur : ce module
// sert donc autant à l'import en ligne de commande (tools/import.mjs) qu'au
// panneau d'administration.

import { norm, studentKey } from './parser.js';
import { guessCourseLabel, normalizeSheetName } from './config.js';
import { currentPeriod, countersAt, evaluate, socleForPeriod } from './rules.js';

/** libellés canoniques d'un onglet : celui des seuils fait référence */
export function labelsFor(sheetName) {
  return guessCourseLabel(sheetName);
}

/** « 5e Chimie A » → « 5e » (format de year_level dans la table students) */
function yearLabel(year) {
  return year ? `${year}e` : null;
}

const chunk = (arr, size = 200) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/**
 * Pousse tout le contenu du classeur en base et renvoie un rapport.
 * `parsed` est le résultat de parseWorkbook().
 */
export async function syncWorkbook(db, parsed, options = {}) {
  const { fileName = null, source = 'manuel', when = new Date(), fileModifiedAt = null } = options;
  const report = { warnings: [...parsed.warnings], steps: {}, errors: [] };

  // On mémorise la date d'enregistrement du fichier importé, pas seulement
  // l'heure de l'import : c'est ce qui permet, depuis un autre ordinateur, de
  // détecter qu'on s'apprête à envoyer une copie plus ancienne que la dernière
  // importée — ce qui ferait redescendre des compteurs.
  const stamp = fileModifiedAt ? { file_modified_at: fileModifiedAt } : {};

  const fail = (label, error) => {
    if (error) report.errors.push(`${label} : ${error.message}`);
    return !error;
  };

  // ------------------------------------------------------------ 1. import
  const { data: imported, error: importError } = await db
    .from('suivi_imports')
    .insert({ file_name: fileName, source, warnings: parsed.warnings, summary: stamp })
    .select()
    .single();
  if (!fail('suivi_imports', importError)) return report;
  const importId = imported.id;

  // ------------------------------------------------------------- 2. cours
  const courseRows = parsed.groups.map((g) => ({
    sheet_name: normalizeSheetName(g.sheetName),
    course_label: labelsFor(g.sheetName).thresholds,
    year_level: g.year,
    group_letter: g.group,
  }));

  const { error: courseError } = await db
    .from('suivi_courses')
    .upsert(courseRows, { onConflict: 'sheet_name' });
  fail('suivi_courses', courseError);

  const { data: courses } = await db.from('suivi_courses').select('id, sheet_name, course_label');
  const courseIdBySheet = new Map(
    (courses || []).map((c) => [normalizeSheetName(c.sheet_name), c.id])
  );
  report.steps.courses = courseRows.length;

  // Correspondance des libellés, pour que l'admin puisse la relire et l'ajuster.
  const aliasRows = [];
  parsed.groups.forEach((g) => {
    const l = labelsFor(g.sheetName);
    aliasRows.push({ course_label: l.thresholds, alias: normalizeSheetName(g.sheetName) });
    if (l.list !== l.thresholds) aliasRows.push({ course_label: l.thresholds, alias: l.list });
  });
  await db.from('suivi_course_aliases').upsert(aliasRows, { onConflict: 'course_label,alias' });

  // ------------------------------------------------------ 3. nomenclature
  // La feuille « Liste » utilise ses propres libellés : on les ramène au
  // libellé canonique avant d'enregistrer.
  const canonicalByList = new Map();
  parsed.groups.forEach((g) => {
    const l = labelsFor(g.sheetName);
    canonicalByList.set(norm(l.list), l.thresholds);
  });

  const itemRows = [];
  parsed.nomenclature.forEach((entry) => {
    const canonical = canonicalByList.get(norm(entry.label)) || entry.label;
    const push = (kind, list) =>
      list.forEach((label, i) =>
        itemRows.push({ course_label: canonical, kind, position: i + 1, label })
      );
    push('bex', entry.bex);
    push('quiz', entry.quiz);
    push('role', entry.roles);
    push('depassement', entry.depassements);
  });

  for (const part of chunk(itemRows)) {
    const { error } = await db
      .from('suivi_items')
      .upsert(part, { onConflict: 'course_label,kind,position' });
    fail('suivi_items', error);
  }
  report.steps.items = itemRows.length;

  // ------------------------------------------------------------ 4. seuils
  const thresholdRows = [];
  const socleRows = [];
  parsed.thresholds.forEach((course) => {
    Object.entries(course.periods).forEach(([period, levels]) => {
      Object.entries(levels).forEach(([level, v]) => {
        thresholdRows.push({
          course_label: course.label,
          period: Number(period),
          level,
          dl: v.dl ?? 0,
          quiz: v.quiz ?? 0,
          validations: v.validations ?? 0,
          bex_diff: v.bexDiff ?? 0,
          depassements: v.depassements ?? 0,
          exam_condition: v.examCondition ?? null,
        });
      });
    });
    socleRows.push({ course_label: course.label, bex_numbers: course.socle || [] });
  });

  const { error: thresholdError } = await db
    .from('suivi_thresholds')
    .upsert(thresholdRows, { onConflict: 'course_label,period,level' });
  fail('suivi_thresholds', thresholdError);

  const { error: socleError } = await db
    .from('suivi_socle')
    .upsert(socleRows, { onConflict: 'course_label' });
  fail('suivi_socle', socleError);
  report.steps.thresholds = thresholdRows.length;

  // ----------------------------------------------------------- 5. élèves
  // Rapprochement par nom + prénom, insensible à la casse et aux accents, pour
  // ne pas dupliquer les élèves déjà présents (table partagée avec Leitner).
  const wanted = new Map();
  parsed.groups.forEach((g) => {
    g.students.forEach((s) => {
      const existing = wanted.get(s.key);
      if (existing && existing.year !== g.year) {
        report.warnings.push(
          `${s.lastName} ${s.firstName} apparait en ${existing.year}e et en ${g.year}e : homonymes ?`
        );
      }
      if (!existing) {
        wanted.set(s.key, {
          lastName: s.lastName,
          firstName: s.firstName,
          year: g.year,
          className: s.className,
        });
      } else if (!existing.className && s.className) {
        existing.className = s.className;
      }
    });
  });

  const { data: existingStudents, error: studentsError } = await db
    .from('students')
    .select('id, first_name, last_name, year_level, class_name');
  fail('students (lecture)', studentsError);

  const idByKey = new Map();
  (existingStudents || []).forEach((s) => {
    idByKey.set(studentKey(s.last_name, s.first_name), s.id);
  });

  const toCreate = [...wanted.entries()].filter(([key]) => !idByKey.has(key));
  for (const part of chunk(toCreate)) {
    const rows = part.map(([, s]) => ({
      first_name: s.firstName,
      last_name: s.lastName,
      year_level: yearLabel(s.year),
      class_name: s.className || null,
      is_active: true,
    }));
    const { data, error } = await db.from('students').insert(rows).select('id, first_name, last_name');
    if (fail('students (création)', error)) {
      (data || []).forEach((s) => idByKey.set(studentKey(s.last_name, s.first_name), s.id));
    }
  }
  report.steps.studentsCreated = toCreate.length;

  // Mise à jour de la classe et de l'année des élèves déjà connus.
  const updates = [];
  wanted.forEach((s, key) => {
    const id = idByKey.get(key);
    if (!id) return;
    const before = (existingStudents || []).find((e) => studentKey(e.last_name, e.first_name) === key);
    if (!before) return;
    if (before.class_name !== (s.className || null) || before.year_level !== yearLabel(s.year)) {
      updates.push({ id, class_name: s.className || null, year_level: yearLabel(s.year) });
    }
  });
  for (const u of updates) {
    const { error } = await db
      .from('students')
      .update({ class_name: u.class_name, year_level: u.year_level })
      .eq('id', u.id);
    fail('students (mise à jour)', error);
  }
  report.steps.studentsUpdated = updates.length;

  // ------------------------------------------- 6. inscriptions et compteurs
  const period = currentPeriod(when);
  const thresholdByLabel = new Map(parsed.thresholds.map((c) => [norm(c.label), c]));

  // État précédent, pour n'ajouter un relevé d'historique que si quelque chose
  // a bougé : un import qui ne change rien ne doit pas créer d'étape.
  const { data: previousCounters } = await db
    .from('suivi_counters')
    .select('student_id, course_id, dl, quiz, validations, bex_diff, depassements');
  const previousByPair = new Map(
    (previousCounters || []).map((c) => [`${c.student_id}|${c.course_id}`, c])
  );

  const enrollmentRows = [];
  const counterRows = [];
  const historyRows = [];
  let missing = 0;
  let unchanged = 0;

  parsed.groups.forEach((g) => {
    const courseId = courseIdBySheet.get(normalizeSheetName(g.sheetName));
    const canonical = labelsFor(g.sheetName).thresholds;
    const course = thresholdByLabel.get(norm(canonical));

    g.students.forEach((s) => {
      const studentId = idByKey.get(s.key);
      if (!studentId || !courseId) {
        missing++;
        return;
      }

      enrollmentRows.push({
        student_id: studentId,
        course_id: courseId,
        class_name: s.className || null,
        is_active: true,
      });

      const counters = countersAt(s);
      counterRows.push({
        student_id: studentId,
        course_id: courseId,
        dl: counters.dl,
        quiz: counters.quiz,
        validations: counters.validations,
        bex_diff: counters.bexDiff,
        depassements: counters.depassements,
        bex_validations: counters.bexValidations,
        missions: counters.missions,
        exam_level: s.examLevel,
        bex: s.bex.map((b) => ({ index: b.index, label: b.label, attempts: b.attempts.length })),
        dl_dates: s.dl.map((d) => (d.date ? d.date.toISOString().slice(0, 10) : d.label)),
        quiz_dates: s.quiz.map((d) => (d.date ? d.date.toISOString().slice(0, 10) : d.label)),
        import_id: importId,
        updated_at: new Date().toISOString(),
      });

      const levels = course?.periods?.[period];
      const assessment = levels
        ? evaluate(s, levels, {
            socle: socleForPeriod(course, period),
            examLevel: s.examLevel,
            counters,
          })
        : { level: null };

      const before = previousByPair.get(`${studentId}|${courseId}`);
      const same =
        before &&
        before.dl === counters.dl &&
        before.quiz === counters.quiz &&
        before.validations === counters.validations &&
        before.bex_diff === counters.bexDiff &&
        before.depassements === counters.depassements;

      if (same) {
        unchanged++;
      } else {
        historyRows.push({
          student_id: studentId,
          course_id: courseId,
          import_id: importId,
          period,
          dl: counters.dl,
          quiz: counters.quiz,
          validations: counters.validations,
          bex_diff: counters.bexDiff,
          depassements: counters.depassements,
          level: assessment.level,
        });
      }
    });
  });

  if (missing) report.warnings.push(`${missing} élève(s) non rattaché(s) faute d'identifiant`);

  for (const part of chunk(enrollmentRows)) {
    const { error } = await db
      .from('suivi_enrollments')
      .upsert(part, { onConflict: 'student_id,course_id' });
    fail('suivi_enrollments', error);
  }

  // Un élève qui a quitté un cours (départ, changement de groupe) n'apparait
  // plus dans les élèves de cet onglet : on désactive son inscription plutôt
  // que de la supprimer, pour garder son historique sans qu'il reste affiché
  // comme actif dans le tableau de bord ou chez l'admin.
  const stillWanted = new Set(enrollmentRows.map((e) => `${e.student_id}|${e.course_id}`));
  const importedCourseIds = [...courseIdBySheet.values()];
  const { data: currentlyActive } = await db
    .from('suivi_enrollments')
    .select('student_id, course_id')
    .eq('is_active', true)
    .in('course_id', importedCourseIds);

  const toDeactivate = (currentlyActive || []).filter(
    (e) => !stillWanted.has(`${e.student_id}|${e.course_id}`)
  );
  for (const part of chunk(toDeactivate)) {
    const { error } = await db
      .from('suivi_enrollments')
      .upsert(
        part.map((e) => ({ student_id: e.student_id, course_id: e.course_id, is_active: false })),
        { onConflict: 'student_id,course_id' }
      );
    fail('suivi_enrollments (désactivation)', error);
  }
  report.steps.enrollmentsDeactivated = toDeactivate.length;
  if (toDeactivate.length) {
    const namesById = new Map((existingStudents || []).map((s) => [s.id, `${s.last_name} ${s.first_name}`]));
    const names = toDeactivate.map((e) => namesById.get(e.student_id) || e.student_id);
    report.warnings.push(`${toDeactivate.length} inscription(s) désactivée(s) (parti ou changé de cours) : ${names.join(', ')}`);
  }
  for (const part of chunk(counterRows)) {
    const { error } = await db
      .from('suivi_counters')
      .upsert(part, { onConflict: 'student_id,course_id' });
    fail('suivi_counters', error);
  }
  for (const part of chunk(historyRows)) {
    const { error } = await db.from('suivi_history').insert(part);
    fail('suivi_history', error);
  }

  report.steps.enrollments = enrollmentRows.length;
  report.steps.counters = counterRows.length;
  report.steps.historyAdded = historyRows.length;
  report.steps.unchanged = unchanged;
  report.steps.period = period;

  await db
    .from('suivi_imports')
    .update({ warnings: report.warnings, summary: { ...report.steps, ...stamp } })
    .eq('id', importId);

  report.importId = importId;
  return report;
}
