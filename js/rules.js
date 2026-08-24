// Règles de calcul : périodes, compteurs à une date donnée, niveau atteint,
// écart vers un objectif. Aucun seuil n'est écrit ici : ils viennent tous de la
// feuille « Seuils de réussite » du classeur.

export const LEVELS = ['JS', 'S', 'B', 'TB'];

export const LEVEL_LABELS = {
  JS: 'Juste suffisant',
  S: 'Suffisant',
  B: 'Bien',
  TB: 'Très bien',
  I: 'Insuffisant',
};

/** les cinq compteurs, dans l'ordre de la grille */
export const COUNTERS = ['dl', 'quiz', 'validations', 'bexDiff', 'depassements'];

/** libellés au singulier et au pluriel, pour rédiger les écarts */
export const COUNTER_LABELS = {
  dl: ['devoir libre', 'devoirs libres'],
  quiz: ['quiz', 'quiz'],
  validations: ['validation', 'validations'],
  bexDiff: ['BEX différente', 'BEX différentes'],
  depassements: ['dépassement', 'dépassements'],
};

export function counterLabel(key, n = 2) {
  const pair = COUNTER_LABELS[key];
  if (!pair) return key;
  return n === 1 ? pair[0] : pair[1];
}

/**
 * Les BEX socles ne sont exigées qu'en période 3 (la ligne « Socle » du
 * classeur est placée sous le tableau P3).
 */
export function socleForPeriod(course, period) {
  if (!course) return [];
  if (course.socleByPeriod) return course.socleByPeriod[period] || [];
  return period === 3 ? course.socle || [] : [];
}

/**
 * Deux dates par période :
 *   lastCourse = dernier jour où une validation compte pour cette période ;
 *   freeze     = conseil de guidance, après quoi le bulletin ne bouge plus.
 * Entre les deux, l'élève voit déjà les seuils de la période suivante.
 */
export const PERIODS = [
  { number: 1, lastCourse: '2026-11-13', freeze: '2026-11-20' },
  { number: 2, lastCourse: '2027-02-19', freeze: '2027-03-19' },
  { number: 3, lastCourse: '2027-06-29', freeze: '2027-06-29' },
];

const toDate = (v) => (v instanceof Date ? v : new Date(v));
const dayEnd = (v) => {
  const d = toDate(v);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
};

/** période vers laquelle l'élève travaille à cette date */
export function currentPeriod(when = new Date()) {
  const d = toDate(when);
  for (const p of PERIODS) {
    if (d <= dayEnd(p.lastCourse)) return p.number;
  }
  return 3;
}

/**
 * Période en attente de son conseil de guidance, s'il y en a une : on est après
 * le dernier cours mais avant le figeage.
 */
export function periodAwaitingFreeze(when = new Date()) {
  const d = toDate(when);
  for (const p of PERIODS) {
    if (d > dayEnd(p.lastCourse) && d <= dayEnd(p.freeze)) return p.number;
  }
  return null;
}

export function periodByNumber(n) {
  return PERIODS.find((p) => p.number === n) || null;
}

/**
 * Jusqu'à cette date, l'année vient de commencer : les élèves n'ont pas
 * encore eu le temps de se lancer, quel que soit leur retard apparent sur les
 * seuils. À mettre à jour chaque année, en même temps que PERIODS.
 */
export const YEAR_START_CUTOFF = '2026-09-30';

export function yearJustStarted(when = new Date()) {
  return toDate(when) <= dayEnd(YEAR_START_CUTOFF);
}

// ----------------------------------------------------------------- compteurs

/**
 * Compteurs d'un élève arrêtés à une date. Les devoirs libres et les quiz sont
 * datés dans le classeur, donc coupés précisément. Les BEX, missions et
 * dépassements ne le sont pas : ils sont pris tels quels.
 */
export function countersAt(student, cutoff = null) {
  const limit = cutoff ? dayEnd(cutoff) : null;
  const inRange = (entry) => !limit || !entry.date || toDate(entry.date) <= limit;

  const dl = student.dl.filter(inRange).length;
  const quiz = student.quiz.filter(inRange).length;

  const bexValidations = student.bex.reduce((n, b) => n + b.attempts.length, 0);
  const validations = bexValidations + student.missions.length;
  const bexDiff = student.bex.filter((b) => b.attempts.length > 0).length;

  return {
    dl,
    quiz,
    validations,
    bexDiff,
    depassements: student.depassements.length,
    bexValidations,
    missions: student.missions.length,
  };
}

/** numéros des BEX socles qui manquent encore */
export function missingSocle(student, socle = []) {
  if (!socle.length) return [];
  return socle.filter((n) => {
    const bex = student.bex.find((b) => b.index === n);
    return !bex || bex.attempts.length === 0;
  });
}

/** l'examen suffit-il pour ce niveau ? « Bien » exige au moins B, « Réussir » au moins JS */
function examSatisfied(condition, examLevel) {
  if (!condition) return true;
  if (!examLevel) return null; // pas encore passé : on ne tranche pas
  const required = /bien\s+r[eé]ussir/i.test(condition) ? 'B' : 'JS';
  return LEVELS.indexOf(examLevel) >= LEVELS.indexOf(required);
}

// -------------------------------------------------------------- évaluation

/**
 * L'élève atteint-il ce niveau ? Le niveau global est le plus bas des
 * compteurs : il faut donc que tous soient au moins au seuil.
 *
 * Deux nuances décidées avec Laureline :
 *  - un cran de tolérance sur les devoirs libres seulement (ils mesurent
 *    l'engagement, pas la compétence) — désactivable via options ;
 *  - les BEX socles doivent être validées dès qu'un seuil de BEX différentes
 *    est exigé, sinon le compte ne suffit pas.
 */
export function meetsLevel(level, counters, thresholdsForPeriod, context = {}) {
  const wanted = thresholdsForPeriod?.[level];
  if (!wanted) return { ok: false, failing: [], reason: 'seuils absents' };

  const { dlTolerance = true, socleMissing = [], examLevel = null } = context;

  const failing = [];
  COUNTERS.forEach((key) => {
    let required = wanted[key] ?? 0;

    if (key === 'dl' && dlTolerance && level !== 'JS') {
      const lower = LEVELS[LEVELS.indexOf(level) - 1];
      const lowerValue = thresholdsForPeriod?.[lower]?.dl;
      if (typeof lowerValue === 'number') required = Math.min(required, lowerValue);
    }

    if ((counters[key] ?? 0) < required) {
      failing.push({ counter: key, have: counters[key] ?? 0, need: required });
    }
  });

  if ((wanted.bexDiff ?? 0) > 0 && socleMissing.length) {
    failing.push({ counter: 'socle', have: 0, need: socleMissing.length, socle: socleMissing });
  }

  const exam = examSatisfied(wanted.examCondition, examLevel);
  if (exam === false) {
    failing.push({ counter: 'exam', condition: wanted.examCondition });
  }

  return {
    ok: failing.length === 0 && exam !== null,
    pendingExam: failing.length === 0 && exam === null,
    failing,
    examCondition: wanted.examCondition || null,
  };
}

/**
 * Niveau atteint : le plus haut dont tous les critères sont remplis.
 * `pendingExam` signale un niveau acquis sur les compteurs mais suspendu à
 * l'examen de juin.
 */
export function evaluate(student, thresholdsForPeriod, context = {}) {
  const counters = context.counters || countersAt(student, context.cutoff);
  const socleMissing = missingSocle(student, context.socle || []);
  const ctx = { ...context, socleMissing, counters };

  let level = 'I';
  let pending = null;

  for (let i = LEVELS.length - 1; i >= 0; i--) {
    const result = meetsLevel(LEVELS[i], counters, thresholdsForPeriod, ctx);
    if (result.ok) {
      level = LEVELS[i];
      break;
    }
    if (result.pendingExam && !pending) pending = LEVELS[i];
  }

  return { level, pendingExam: pending, counters, socleMissing };
}

/**
 * Ce qui manque pour atteindre `target`. Renvoie uniquement les écarts positifs,
 * jamais de dénominateur : un élève absent n'a pas pu faire le travail.
 */
export function gapTo(target, student, thresholdsForPeriod, context = {}) {
  const counters = context.counters || countersAt(student, context.cutoff);
  const socleMissing = missingSocle(student, context.socle || []);
  const result = meetsLevel(target, counters, thresholdsForPeriod, {
    ...context,
    socleMissing,
    counters,
  });

  const gaps = {};
  result.failing.forEach((f) => {
    if (f.counter === 'socle' || f.counter === 'exam') return;
    gaps[f.counter] = f.need - f.have;
  });

  return {
    target,
    reached: result.ok,
    pendingExam: result.pendingExam,
    gaps,
    socleMissing: result.failing.some((f) => f.counter === 'socle') ? socleMissing : [],
    examCondition: result.examCondition,
    counters,
  };
}

/** niveau suivant, ou null si on est déjà au sommet */
export function nextLevel(level) {
  if (level === 'I') return 'JS';
  const i = LEVELS.indexOf(level);
  return i >= 0 && i < LEVELS.length - 1 ? LEVELS[i + 1] : null;
}

// ------------------------------------------------------------------ conseils

/**
 * Choisit la clé de conseil la plus utile. L'ordre traduit une priorité
 * pédagogique : d'abord ce qui est simple à rattraper, ensuite les savoir-faire.
 */
export function adviceKey(gap, student, options = {}) {
  const g = gap.gaps || {};
  const count = Object.values(g).filter((v) => v > 0).length;

  if (gap.reached) return options.atTop ? 'level-max' : 'target-reached';
  // En tout début d'année, personne n'est vraiment « en retard » : le retard
  // apparent sur les seuils vient juste de ne pas avoir encore commencé.
  if (options.yearJustStarted) return 'period-start';
  if (count >= 3) return 'many-behind';

  if (g.bexDiff > 0 || gap.socleMissing.length) return 'need-new-bex';
  if (g.validations > 0) {
    const c = gap.counters;
    // Beaucoup de missions et peu de BEX : le message n'est pas le même.
    if (c.missions >= 3 && c.bexValidations <= c.bexDiff) return 'missions-heavy';
    return 'need-revalidation';
  }
  if (g.dl > 0) return 'behind-dl';
  if (g.quiz > 0) return 'behind-quiz';
  if (g.depassements > 0) return 'need-depassement';
  if (gap.examCondition) return 'exam-condition';
  return 'target-reached';
}

/** textes par défaut, remplacés par ceux de la table `suivi_advice` */
export const DEFAULT_ADVICE = {
  'behind-dl':
    "Il te manque {X} devoirs libres. C'est le point le plus facile à rattraper, parce que ce n'est pas la justesse qui compte mais le fait d'avoir cherché. Rends le prochain même si tu n'es pas sûr de toi : un devoir tenté et faux compte autant qu'un devoir juste.",
  'behind-quiz':
    "Il te manque {X} quiz réussis. Les quiz portent sur ce que tu dois connaitre, pas sur des raisonnements à construire. C'est donc du travail de mémorisation : quinze minutes régulières valent mieux qu'une longue soirée la veille. Tes flashcards Leitner sont faites exactement pour ça.",
  'need-new-bex':
    "Il te manque {X} savoir-faire différents. Attention, ici repasser une BEX que tu maitrises déjà ne t'aidera pas : il faut en valider une nouvelle. Dans la liste ci-dessous, celles marquées d'un tiret n'ont jamais été validées. Choisis-en une, relis ses critères de réussite, refais deux exercices de la banque, et viens la passer.",
  'need-revalidation':
    "Tu as validé beaucoup de savoir-faire différents, c'est du bon travail. Ce qui te manque maintenant, ce sont des re-réussites : repasser une BEX déjà validée pour montrer que ce n'était pas un coup de chance. Reprends en priorité celles que tu n'as réussies qu'une seule fois, ce sont les plus rapides à consolider.",
  'need-depassement':
    "Il te manque {X} dépassement. Ce n'est pas du travail en plus pour t'occuper, c'est l'occasion de montrer autre chose : créer un QCM sur un chapitre, rédiger un corrigé, partager une ressource que tu as trouvée, poser une vraie question de recherche. Viens m'en parler, on choisit ensemble.",
  'exam-condition':
    "À partir de Bien, il faut aussi ne pas rater l'examen de juin, et pour Très bien y obtenir au moins Bien. L'examen reprend les savoir-faire des BEX : plus tu en auras validé plusieurs fois pendant l'année, moins tu auras à préparer en juin.",
  'many-behind':
    "Plusieurs choses sont en retard, alors ne t'éparpille pas. Commence par les devoirs libres, c'est le plus simple à rattraper et ça compte autant que le reste. Ensuite seulement, attaque les savoir-faire.",
  'missions-heavy':
    "Tu as accumulé pas mal de validations grâce aux missions, et c'est chouette de t'y investir. Mais les savoir-faire individuels restent la base : il te faut {X} validations de plus, et les BEX sont la voie la plus sûre.",
  'target-reached':
    "Tu as atteint ton objectif, bravo. Tu peux t'arrêter là et consolider ce que tu as, ou viser {next}. Pour y aller, il te faudrait : {ecart}.",
  'level-max':
    "Tu as atteint le niveau le plus haut. Il n'y a plus de palier au-dessus, mais tu peux continuer à te dépasser autrement : aider un camarade à valider une BEX, proposer un exercice de ton invention, ou explorer un sujet qui n'est pas au programme.",
  'period-start':
    "La période vient de commencer, c'est normal que tes compteurs soient encore bas. Choisis dès maintenant l'objectif que tu veux atteindre, ça t'aidera à savoir où mettre ton énergie.",
};

/** rend un écart en français : « 2 quiz et 1 dépassement » */
export function describeGap(gaps) {
  const parts = [];
  COUNTERS.forEach((key) => {
    const n = gaps[key];
    if (!n || n <= 0) return;
    parts.push(`${n} ${counterLabel(key, n)}`);
  });
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}`;
}
