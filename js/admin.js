// Panneau d'administration : import du classeur, tableau de bord, textes de
// conseil, figeage des bulletins.

import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SCHOOL_YEAR_START,
  IGNORED_SHEETS,
  loadLocalSecrets,
} from './config.js';
import { parseWorkbook } from './parser.js';
import { syncWorkbook } from './sync.js';
import { loadAdminOverview, loadAdvice } from './data.js';
import { prepareFreeze, freezePeriod } from './freeze.js';
import {
  LEVELS,
  LEVEL_LABELS,
  COUNTERS,
  counterLabel,
  countersAt,
  evaluate,
  gapTo,
  socleForPeriod,
  currentPeriod,
  periodByNumber,
  PERIODS,
} from './rules.js';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const state = { parsed: null, fileName: null, overview: null };

// --------------------------------------------------------------------- accès

// Le mot de passe vient d'un fichier local, jamais publié. En ligne, ce fichier
// est absent : l'administration est donc inaccessible, et c'est le but.
const secrets = await loadLocalSecrets();

if (!secrets.ADMIN_PASSWORD) {
  $('gate-error').textContent =
    "L'administration ne fonctionne que depuis l'ordinateur de la professeure.";
  $('gate-error').hidden = false;
  $('password').disabled = true;
  $('gate-form').querySelector('button').disabled = true;
}

$('gate-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!secrets.ADMIN_PASSWORD || $('password').value !== secrets.ADMIN_PASSWORD) {
    $('gate-error').textContent = 'Mot de passe incorrect.';
    $('gate-error').hidden = false;
    return;
  }
  $('gate').hidden = true;
  $('admin').hidden = false;
  const period = currentPeriod();
  const definition = periodByNumber(period);
  $('period-info').textContent =
    `Période ${period} · dernier cours le ${formatDate(definition.lastCourse)} · ` +
    `conseil le ${formatDate(definition.freeze)}`;
  renderAdvice();
  renderFreeze();
});

// -------------------------------------------------------------------- onglets

$('admin-tabs').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-panel]');
  if (!button) return;
  const wanted = button.dataset.panel;

  document.querySelectorAll('#admin-tabs button').forEach((b) => {
    b.setAttribute('aria-current', String(b.dataset.panel === wanted));
  });
  document.querySelectorAll('.panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== wanted;
  });

  if (wanted === 'overview') renderOverview();
});

// --------------------------------------------------------------------- import

$('file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const buffer = await file.arrayBuffer();
  const wb = window.XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheets = wb.SheetNames.map((name) => ({
    name,
    rows: window.XLSX.utils.sheet_to_json(wb.Sheets[name], {
      header: 1,
      raw: false,
      defval: '',
      blankrows: true,
    }),
  }));

  state.parsed = parseWorkbook(sheets, {
    startYear: SCHOOL_YEAR_START,
    ignore: IGNORED_SHEETS,
  });
  state.fileName = file.name;
  renderPreview();
});

function renderPreview() {
  const parsed = state.parsed;
  const box = $('preview-body');
  box.innerHTML = '';
  $('import-result').hidden = true;

  const inscriptions = parsed.groups.reduce((n, g) => n + g.students.length, 0);
  const counted = parsed.groups.reduce(
    (n, g) => n + g.students.filter((s) => countersAt(s).validations > 0).length,
    0
  );

  box.append(
    reportGrid({
      Onglets: parsed.groups.length,
      Inscriptions: inscriptions,
      'Avec au moins une validation': counted,
      'Grilles de seuils': parsed.thresholds.length,
      Nomenclatures: parsed.nomenclature.length,
    })
  );

  const table = document.createElement('table');
  table.innerHTML =
    '<thead><tr><th>Onglet</th><th>Élèves</th><th>BEX</th><th>Semaines DL</th><th>Semaines quiz</th><th>Examen</th></tr></thead>';
  const body = document.createElement('tbody');
  parsed.groups.forEach((g) => {
    const row = document.createElement('tr');
    row.innerHTML =
      `<td>${escape(g.sheetName)}</td>` +
      `<td class="num">${g.students.length}</td>` +
      `<td class="num">${g.layout.bexGroups.length}</td>` +
      `<td class="num">${g.layout.dlWeeks}</td>` +
      `<td class="num">${g.layout.quizWeeks}</td>` +
      `<td>${g.layout.examColumn === null ? '—' : 'colonne ' + g.layout.examColumn}</td>`;
    body.append(row);
  });
  table.append(body);
  const scroll = document.createElement('div');
  scroll.className = 'table-scroll';
  scroll.append(table);
  box.append(scroll);

  if (parsed.warnings.length) {
    const title = document.createElement('p');
    title.className = 'muted small';
    title.textContent = `${parsed.warnings.length} remarque(s) de lecture :`;
    const list = document.createElement('ul');
    list.className = 'warn-list';
    parsed.warnings.forEach((w) => {
      const li = document.createElement('li');
      li.textContent = w;
      list.append(li);
    });
    box.append(title, list);
  }

  $('preview').hidden = false;
}

$('cancel-import').addEventListener('click', () => {
  state.parsed = null;
  $('file').value = '';
  $('preview').hidden = true;
});

$('do-import').addEventListener('click', async () => {
  if (!state.parsed) return;
  const button = $('do-import');
  button.disabled = true;
  button.textContent = 'Envoi…';

  const report = await syncWorkbook(db, state.parsed, {
    fileName: state.fileName,
    source: 'manuel',
  });

  button.disabled = false;
  button.textContent = "Envoyer vers l'application";

  const box = $('import-result');
  box.innerHTML = '';
  box.hidden = false;

  const heading = document.createElement('h3');
  heading.textContent = report.errors.length ? 'Import terminé avec des erreurs' : 'Import terminé';
  box.append(heading, reportGrid(labelSteps(report.steps)));

  if (report.errors.length) {
    const list = document.createElement('ul');
    list.className = 'warn-list';
    report.errors.forEach((e) => {
      const li = document.createElement('li');
      li.textContent = e;
      list.append(li);
    });
    box.append(list);
  }

  $('preview').hidden = true;
  state.overview = null;
});

function labelSteps(steps) {
  return {
    Cours: steps.courses ?? 0,
    'Noms (BEX, quiz, rôles)': steps.items ?? 0,
    Seuils: steps.thresholds ?? 0,
    'Élèves créés': steps.studentsCreated ?? 0,
    'Élèves mis à jour': steps.studentsUpdated ?? 0,
    Inscriptions: steps.enrollments ?? 0,
    Compteurs: steps.counters ?? 0,
    'Nouvelles étapes': steps.historyAdded ?? 0,
    'Sans changement': steps.unchanged ?? 0,
  };
}

// ----------------------------------------------------------- tableau de bord

async function renderOverview() {
  const box = $('overview');
  if (!state.overview) {
    box.textContent = 'Chargement…';
    state.overview = await loadAdminOverview(db);
    const select = $('course-filter');
    select.innerHTML = '<option value="">Tous les cours</option>';
    state.overview.courses.forEach((course) => {
      const option = document.createElement('option');
      option.value = course.id;
      option.textContent = `${course.sheet_name} (${course.rows.length})`;
      select.append(option);
    });
    select.addEventListener('change', renderOverview);
    $('only-behind').addEventListener('change', renderOverview);
  }

  const { period, courses } = state.overview;
  const filter = $('course-filter').value;
  const onlyBehind = $('only-behind').checked;
  box.innerHTML = '';

  courses
    .filter((course) => !filter || String(course.id) === filter)
    .forEach((course) => {
      const levels = course.thresholds[period];
      if (!levels) return;

      const heading = document.createElement('h3');
      heading.textContent = `${course.sheet_name} — seuils de « ${course.course_label} »`;

      const table = document.createElement('table');
      table.innerHTML =
        '<thead><tr><th>Élève</th><th>Classe</th>' +
        COUNTERS.map((k) => `<th class="num">${shortLabel(k)}</th>`).join('') +
        '<th>Niveau</th><th>Objectif</th><th></th></tr></thead>';

      const body = document.createElement('tbody');
      let shown = 0;

      course.rows.forEach((entry) => {
        const counters = countersAt(entry.student_model);
        const context = {
          socle: socleForPeriod(course.socle, period),
          examLevel: entry.student_model.examLevel,
          counters,
        };
        const assessment = evaluate(entry.student_model, levels, context);
        const behind = assessment.level === 'I';
        if (onlyBehind && !behind) return;
        shown++;

        // Un objectif atteint surtout grâce aux missions mérite un œil : les
        // savoir-faire individuels restent la base de la note.
        const missionsHeavy =
          counters.missions >= 3 && counters.bexValidations <= counters.bexDiff;

        const row = document.createElement('tr');
        row.className = behind ? 'behind' : assessment.level === 'TB' ? 'top' : '';
        row.innerHTML =
          `<td>${escape(entry.student.last_name)}, ${escape(entry.student.first_name)}</td>` +
          `<td>${escape(entry.student.class_name || '—')}</td>` +
          COUNTERS.map((k) => `<td class="num">${counters[k] ?? 0}</td>`).join('') +
          `<td><span class="pill ${assessment.level}">${LEVEL_LABELS[assessment.level]}</span></td>` +
          `<td>${entry.target ? LEVEL_LABELS[entry.target] : '—'}</td>` +
          `<td class="flag">${missionsHeavy ? 'surtout des missions' : ''}` +
          `${assessment.pendingExam ? ' examen attendu' : ''}</td>`;
        body.append(row);
      });

      table.append(body);
      const scroll = document.createElement('div');
      scroll.className = 'table-scroll';
      scroll.append(table);

      const count = document.createElement('p');
      count.className = 'muted small';
      count.textContent = `${shown} élève(s) affiché(s) sur ${course.rows.length}`;

      box.append(heading, scroll, count);
    });

  if (!box.children.length) {
    box.textContent = 'Aucun élève à afficher.';
  }
}

function shortLabel(key) {
  return { dl: 'DL', quiz: 'Quiz', validations: 'Valid.', bexDiff: 'BEX', depassements: 'Dép.' }[key];
}

// -------------------------------------------------------------------- conseils

async function renderAdvice() {
  const box = $('advice-list');
  const advice = await loadAdvice(db);
  box.innerHTML = '';

  Object.entries(advice)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([key, body]) => {
      const row = document.createElement('div');
      row.className = 'advice-row';

      const label = document.createElement('label');
      const name = document.createElement('code');
      name.textContent = key;
      const area = document.createElement('textarea');
      area.value = body;
      label.append(name, area);

      const save = document.createElement('button');
      save.type = 'button';
      save.textContent = 'Enregistrer';
      const saved = document.createElement('span');
      saved.className = 'saved';

      save.addEventListener('click', async () => {
        save.disabled = true;
        const { error } = await db
          .from('suivi_advice')
          .update({ body: area.value, updated_at: new Date().toISOString() })
          .eq('key', key);
        save.disabled = false;
        saved.textContent = error ? `Erreur : ${error.message}` : 'Enregistré';
        setTimeout(() => {
          saved.textContent = '';
        }, 3000);
      });

      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.append(save, saved);

      row.append(label, actions);
      box.append(row);
    });
}

// -------------------------------------------------------------------- figeage

async function renderFreeze() {
  const box = $('freeze-list');
  box.innerHTML = '';
  const now = new Date();

  for (const definition of PERIODS) {
    const prepared = await prepareFreeze(db, definition.number);
    const row = document.createElement('div');
    row.className = 'freeze-row';

    const info = document.createElement('div');
    info.className = 'grow';
    const already = prepared.skipped?.length || 0;
    const ready = prepared.rows?.length || 0;
    const due = new Date(definition.freeze) <= now;

    info.innerHTML =
      `<strong>Période ${definition.number}</strong> — dernier cours le ` +
      `${formatDate(definition.lastCourse)}, conseil le ${formatDate(definition.freeze)}<br>` +
      `<span class="muted small">${already} déjà figé(s), ${ready} à figer` +
      `${due ? '' : ' · le conseil n\'a pas encore eu lieu'}</span>`;

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = already ? 'Figer les manquants' : 'Figer maintenant';
    button.disabled = ready === 0;

    const status = document.createElement('span');
    status.className = 'saved';

    button.addEventListener('click', async () => {
      const message = due
        ? `Figer ${ready} bulletin(s) de la période ${definition.number} ?`
        : `Le conseil de la période ${definition.number} n'a pas encore eu lieu ` +
          `(${formatDate(definition.freeze)}). Figer quand même ${ready} bulletin(s) ?`;
      if (!window.confirm(message)) return;

      button.disabled = true;
      const result = await freezePeriod(db, definition.number);
      status.textContent = result.error
        ? `Erreur : ${result.error}`
        : `${result.written} bulletin(s) figé(s)`;
      renderFreeze();
    });

    row.append(info, button, status);
    box.append(row);
  }
}

// ----------------------------------------------------------------- utilitaires

function reportGrid(values) {
  const grid = document.createElement('dl');
  grid.className = 'report report-grid';
  Object.entries(values).forEach(([key, value]) => {
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.textContent = value;
    grid.append(dt, dd);
  });
  return grid;
}

function escape(text) {
  return String(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function formatDate(value) {
  return new Date(value).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' });
}
