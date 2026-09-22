// App élève : connexion, jauges, écart vers l'objectif, conseil.
// Toute la logique de données est dans data.js, tout le calcul dans rules.js.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import {
  findStudent,
  loadClasses,
  loadDashboard,
  loadAdvice,
  loadHistory,
  compressHistory,
  loadSnapshots,
  saveTarget,
  studentFromCounters,
  markSeen,
} from './data.js';
import {
  LEVELS,
  LEVEL_LABELS,
  COUNTERS,
  counterLabel,
  countersAt,
  evaluate,
  gapTo,
  nextLevel,
  adviceKey,
  describeGap,
  socleForPeriod,
  currentPeriod,
  periodAwaitingFreeze,
  periodByNumber,
  yearJustStarted,
  DEFAULT_ADVICE,
} from './rules.js';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'suivi-eleve';

// Compteurs de démonstration, pour visualiser l'écran sans données réelles :
// ajouter ?demo=1 à l'adresse.
const DEMO = new URLSearchParams(location.search).has('demo');
const DEMO_ROW = {
  dl_dates: ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'],
  quiz_dates: ['2026-09-14', '2026-09-28', '2026-10-12'],
  bex: [
    { index: 1, label: 'BEX1', attempts: 2 },
    { index: 2, label: 'BEX2', attempts: 1 },
  ],
  missions: 1,
  depassements: 0,
  exam_level: null,
};

const state = {
  student: null,
  period: currentPeriod(),
  courses: [],
  advice: DEFAULT_ADVICE,
  activeCourseId: null,
};

// ------------------------------------------------------------------ connexion

async function initLogin() {
  const select = $('class-name');
  const classes = await loadClasses(db);
  classes.forEach((c) => {
    const option = document.createElement('option');
    option.value = c;
    option.textContent = c;
    select.append(option);
  });

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const { firstName, lastName, className } = JSON.parse(saved);
      $('first-name').value = firstName || '';
      $('last-name').value = lastName || '';
      if (className && classes.includes(className)) select.value = className;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const firstName = $('first-name').value.trim();
  const lastName = $('last-name').value.trim();
  const className = $('class-name').value;
  const error = $('login-error');
  const button = $('login-button');

  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Recherche…';

  const result = await findStudent(db, { firstName, lastName, className });

  button.disabled = false;
  button.textContent = 'Voir ma progression';

  if (result.error) {
    error.textContent = result.error;
    error.hidden = false;
    return;
  }
  if (result.notFound) {
    error.textContent =
      "Je ne trouve personne à ce nom dans cette classe. Vérifie l'orthographe et la classe choisie, puis préviens-moi si ça ne marche toujours pas.";
    error.hidden = false;
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify({ firstName, lastName, className }));
  markSeen(db, result.student.id);
  await openDashboard(result.student);
});

$('logout').addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});

// ------------------------------------------------------------------ tableau

async function openDashboard(student) {
  state.student = student;
  $('student-name').textContent = `${student.first_name} ${student.last_name}`;
  $('student-class').textContent = student.class_name ? ` · ${student.class_name}` : '';

  const [dash, advice] = await Promise.all([loadDashboard(db, student.id), loadAdvice(db)]);
  if (advice && Object.keys(advice).length) state.advice = { ...DEFAULT_ADVICE, ...advice };

  if (dash.error) {
    $('login-error').textContent = dash.error;
    $('login-error').hidden = false;
    return;
  }

  state.period = dash.period ?? currentPeriod();
  state.courses = dash.courses || [];

  if (DEMO) {
    state.courses.forEach((c) => {
      c.counterRow = { ...DEMO_ROW };
      c.student = studentFromCounters(DEMO_ROW);
    });
  }

  $('login').hidden = true;
  $('app').hidden = false;

  renderPeriodBanner();
  renderTabs();
  state.activeCourseId = state.courses[0]?.id ?? null;
  await renderCourse();
}

function renderPeriodBanner() {
  const banner = $('period-banner');
  const awaiting = periodAwaitingFreeze();
  const period = periodByNumber(state.period);

  if (awaiting) {
    const council = periodByNumber(awaiting);
    banner.className = 'banner frozen';
    banner.textContent =
      `Bulletin ${awaiting} en cours de finalisation, il sera arrêté au conseil du ` +
      `${formatDate(council.freeze)}. Ce que tu fais maintenant compte pour la période ${state.period}.`;
    return;
  }

  banner.className = 'banner';
  const remaining = weeksUntil(period.lastCourse);
  banner.textContent =
    `Période ${state.period}` +
    (remaining > 0
      ? ` · il te reste ${remaining} semaine${remaining > 1 ? 's' : ''} avant le ${formatDate(period.lastCourse)}.`
      : ` · dernière ligne droite.`);
}

function renderTabs() {
  const nav = $('course-tabs');
  nav.innerHTML = '';
  nav.hidden = state.courses.length < 2;
  if (nav.hidden) return;

  state.courses.forEach((course) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = courseTitle(course);
    button.setAttribute('aria-current', String(course.id === state.activeCourseId));
    button.addEventListener('click', async () => {
      state.activeCourseId = course.id;
      renderTabs();
      await renderCourse();
    });
    nav.append(button);
  });
}

function activeCourse() {
  return state.courses.find((c) => c.id === state.activeCourseId) || null;
}

async function renderCourse() {
  const course = activeCourse();
  if (!course || !course.student) return;

  const levels = course.thresholds[state.period];
  if (!levels) {
    $('gap-title').textContent = 'Seuils indisponibles';
    $('advice').textContent = 'Les seuils de cette période ne sont pas encore renseignés.';
    return;
  }

  const counters = countersAt(course.student);
  const context = {
    socle: socleForPeriod(course.socle, state.period),
    examLevel: course.student.examLevel,
    counters,
  };
  const assessment = evaluate(course.student, levels, context);
  const target = course.target || defaultTarget(assessment.level);

  renderTargetPicker(course, levels, counters, context, target, assessment);
  renderGauges(levels, counters, target);
  renderGap(course, levels, counters, context, target, assessment);
  renderBex(course);
  await renderHistory(course);
  await renderSnapshots(course);

  $('updated').textContent = course.updatedAt
    ? `Dernière mise à jour : ${formatDateTime(course.updatedAt)}`
    : '';
}

/** objectif proposé par défaut : le palier juste au-dessus du niveau atteint */
function defaultTarget(level) {
  return nextLevel(level) || 'TB';
}

function renderTargetPicker(course, levels, counters, context, target, assessment) {
  const box = $('target-picker');
  box.innerHTML = '';

  LEVELS.forEach((level) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(level === target));

    const name = document.createElement('span');
    name.textContent = LEVEL_LABELS[level];
    button.append(name);

    const reached = gapTo(level, course.student, levels, context).reached;
    if (reached) {
      const mark = document.createElement('span');
      mark.className = 'reached';
      mark.textContent = 'atteint';
      button.append(mark);
    }

    button.addEventListener('click', async () => {
      course.target = level;
      await saveTarget(db, state.student.id, course.id, state.period, level);
      await renderCourse();
    });

    box.append(button);
  });

  const hint = $('target-hint');
  if (assessment.pendingExam) {
    hint.textContent = `Tu remplis déjà les conditions du ${LEVEL_LABELS[assessment.pendingExam]} : il ne manque que l'examen de juin.`;
  } else if (assessment.level === 'I') {
    hint.textContent = "Choisis l'objectif que tu veux viser pour cette période.";
  } else {
    hint.textContent = `Pour l'instant, tu remplis les conditions du ${LEVEL_LABELS[assessment.level]}.`;
  }
}

function renderGauges(levels, counters, target) {
  const box = $('gauges');
  box.innerHTML = '';
  const wanted = levels[target] || {};

  COUNTERS.forEach((key) => {
    const have = counters[key] ?? 0;
    const need = wanted[key] ?? 0;
    const done = need === 0 || have >= need;
    const ratio = need === 0 ? 1 : Math.min(1, have / need);

    const gauge = document.createElement('div');
    gauge.className = `gauge${done ? ' done' : ''}`;

    const head = document.createElement('div');
    head.className = 'gauge-head';
    const name = document.createElement('span');
    name.textContent = capitalize(counterLabel(key, 2));
    const value = document.createElement('span');
    value.className = 'gauge-value';
    // Jamais de dénominateur : on affiche ce qui est acquis, pas ce qui était proposé.
    value.textContent = done ? `${have} ✓` : `${have}`;
    head.append(name, value);

    const track = document.createElement('div');
    track.className = 'gauge-track';
    const fill = document.createElement('div');
    fill.className = 'gauge-fill';
    fill.style.width = `${Math.round(ratio * 100)}%`;
    track.append(fill);

    gauge.append(head, track);
    box.append(gauge);
  });
}

function renderGap(course, levels, counters, context, target, assessment) {
  const gap = gapTo(target, course.student, levels, context);
  const title = $('gap-title');
  const list = $('gap-list');
  const advice = $('advice');
  list.innerHTML = '';

  const atTop = target === 'TB';

  if (gap.reached) {
    const after = nextLevel(target);
    title.textContent = `Objectif ${LEVEL_LABELS[target]} atteint`;
    if (after) {
      const nextGap = gapTo(after, course.student, levels, context);
      addGapItems(list, nextGap, course);
      advice.textContent = fill(state.advice['target-reached'], {
        next: LEVEL_LABELS[after],
        ecart: describeGap(nextGap.gaps) || 'plus rien, tu y es déjà',
      });
    } else {
      advice.textContent = state.advice['level-max'];
    }
    return;
  }

  title.textContent = `Pour atteindre ${LEVEL_LABELS[target]}`;
  addGapItems(list, gap, course);

  const key = adviceKey(gap, course.student, { atTop, yearJustStarted: yearJustStarted() });
  const biggest = Object.entries(gap.gaps).sort((a, b) => b[1] - a[1])[0];
  advice.textContent = fill(state.advice[key] || '', {
    X: biggest ? biggest[1] : '',
    next: LEVEL_LABELS[nextLevel(target) || 'TB'],
    ecart: describeGap(gap.gaps),
  });
}

function addGapItems(list, gap, course) {
  COUNTERS.forEach((key) => {
    const missing = gap.gaps[key];
    if (!missing || missing <= 0) return;
    const li = document.createElement('li');
    li.textContent = `${missing} ${counterLabel(key, missing)}`;
    list.append(li);
  });

  if (gap.socleMissing?.length) {
    const li = document.createElement('li');
    const names = gap.socleMissing.map((n) => course.bexLabels[n - 1] || `BEX${n}`);
    li.textContent = `les savoir-faire de base : ${names.join(', ')}`;
    list.append(li);
  }

  if (gap.examCondition) {
    const li = document.createElement('li');
    li.textContent = gap.examCondition.toLowerCase();
    list.append(li);
  }
}

function renderBex(course) {
  const box = $('bex-list');
  box.innerHTML = '';
  const socle = socleForPeriod(course.socle, 3);

  course.student.bex.forEach((bex) => {
    const row = document.createElement('div');
    const never = bex.attempts.length === 0;
    row.className = `bex-row${never ? ' never' : ''}${socle.includes(bex.index) ? ' socle' : ''}`;

    const name = document.createElement('strong');
    name.textContent = course.bexLabels[bex.index - 1] || bex.label;

    const dots = document.createElement('span');
    dots.className = `dots${never ? ' empty' : ''}`;
    dots.textContent = never ? '—' : '●'.repeat(bex.attempts.length);

    row.append(name, dots);
    box.append(row);
  });
}

async function renderHistory(course) {
  const rows = compressHistory(await loadHistory(db, state.student.id, course.id));
  const card = $('history-card');
  const box = $('history');
  box.innerHTML = '';

  // Rien de nouveau à raconter : on n'affiche pas la section.
  if (!rows.length) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  // Du plus récent au plus ancien : ce qui vient d'arriver intéresse le plus.
  rows
    .slice(-10)
    .reverse()
    .forEach((row) => {
      const line = document.createElement('div');
      line.className = 'history-row';

      const date = document.createElement('span');
      date.className = 'muted';
      date.textContent = formatDate(row.captured_at);

      const detail = document.createElement('span');
      detail.textContent = describeDelta(row.delta);

      line.append(date, detail);
      box.append(line);
    });
}

/** « +2 devoirs libres, +1 BEX différente » */
function describeDelta(delta) {
  const parts = COUNTERS.map((key) => {
    const value = delta?.[key];
    if (!value) return null;
    const sign = value > 0 ? '+' : '−';
    const size = Math.abs(value);
    return `${sign}${size} ${counterLabel(key, size)}`;
  }).filter(Boolean);
  return parts.join(', ');
}

async function renderSnapshots(course) {
  const rows = await loadSnapshots(db, state.student.id, course.id);
  const card = $('snapshots-card');
  const box = $('snapshots');
  box.innerHTML = '';

  if (!rows.length) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  rows.forEach((row) => {
    const line = document.createElement('div');
    line.className = 'history-row';
    const label = document.createElement('span');
    label.className = 'muted';
    label.textContent = `Bulletin ${row.period}`;
    const detail = document.createElement('span');
    detail.textContent =
      `${LEVEL_LABELS[row.level] || '—'} · DL ${row.dl} · quiz ${row.quiz} · ` +
      `validations ${row.validations} · BEX ${row.bex_diff}`;
    line.append(label, detail);
    box.append(line);
  });
}

// ------------------------------------------------------------------ utilitaires

function courseTitle(course) {
  return course.label;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function fill(template, values) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) =>
    values[key] === undefined ? '' : String(values[key])
  );
}

function formatDate(value) {
  const d = new Date(value);
  return d.toLocaleDateString('fr-BE', { day: 'numeric', month: 'long' });
}

function formatDateTime(value) {
  const d = new Date(value);
  return d.toLocaleDateString('fr-BE', { day: 'numeric', month: 'long' });
}

function weeksUntil(value) {
  const days = (new Date(value) - new Date()) / 86400000;
  return Math.max(0, Math.round(days / 7));
}

initLogin();
