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
export const YEAR_START_CUTOFF = '2026-09-15';

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

// -------------------------------------------------------------------- rythme

/**
 * Part du chemin déjà parcouru dans la période, d'après le vrai calendrier
 * des semaines de devoirs libres de CE cours (congés/décloisonnements déjà
 * exclus, puisque ce sont les colonnes réellement présentes dans le classeur).
 * Sert de rythme commun aux 5 compteurs : les devoirs libres et les quiz ne
 * peuvent de toute façon pas aller plus vite qu'une semaine à la fois, et les
 * autres compteurs demandent, eux aussi, du temps pour être travaillés — pas
 * seulement de la place dans le classeur.
 *
 * Sans calendrier connu (classeur pas encore réimporté depuis cet ajout), on
 * renvoie 1 : rien n'est adouci, comportement inchangé.
 */
export function periodProgress(weekDates, period, when = new Date()) {
  const dates = (weekDates || []).map((d) => toDate(d)).filter((d) => !isNaN(d));
  const definition = periodByNumber(period);
  if (!dates.length || !definition) return 1;

  const limit = dayEnd(definition.lastCourse);
  const totalPlanned = dates.filter((d) => d <= limit).length;
  if (!totalPlanned) return 1;

  const elapsed = dates.filter((d) => d <= dayEnd(when)).length;
  return Math.min(1, elapsed / totalPlanned);
}

/**
 * Écart vers `target` réduit à ce qui est déjà possible à ce stade de la
 * période (seuils de chaque compteur multipliés par `periodProgress`, arrondis
 * au SUPÉRIEUR). Sert à CHOISIR le conseil sans gronder un élève qui n'a
 * simplement pas encore eu l'occasion d'accumuler plus ; le texte affiché
 * continue, lui, à citer le vrai écart vers l'objectif final (gapTo, pas ce
 * résultat-ci).
 *
 * ⚠️ Arrondi au supérieur, pas à l'inférieur : un seuil de fin de période
 * arrondi vers le bas retombe à 0 tant que la période n'est pas terminée dès
 * que le seuil est petit (1 ou 2, très courant pour les BEX différentes en
 * P1) — un élève qui n'a validé AUCUNE BEX paraitrait alors « à l'heure »
 * indéfiniment, ce qui n'est pas vrai : dès qu'il a eu l'occasion d'en passer
 * une, il faut que ça compte.
 *
 * Renvoie `null` si rien ne peut être adouci (pas de calendrier connu, ou
 * période déjà terminée) : l'appelant retombe alors sur le comportement
 * habituel.
 */
export function paceGapTo(target, student, thresholdsForPeriod, weekDates, period, context = {}) {
  const progress = periodProgress(weekDates, period, context.when);
  const wanted = thresholdsForPeriod?.[target];
  if (!wanted || progress >= 1) return null;

  const scaled = {};
  COUNTERS.forEach((k) => {
    scaled[k] = Math.ceil((wanted[k] ?? 0) * progress);
  });

  const result = gapTo(target, student, { [target]: scaled }, context);
  return result.gaps;
}

// ------------------------------------------------------------------ conseils

/**
 * Choisit la clé de conseil la plus utile. L'ordre traduit une priorité
 * pédagogique : d'abord ce qui est simple à rattraper, ensuite les savoir-faire.
 */
export function adviceKey(gap, student, options = {}) {
  // `paceGaps` (paceGapTo) réduit l'écart à ce qui est déjà possible à ce
  // stade de la période : sert à choisir le conseil sans gronder un élève qui
  // n'a simplement pas encore eu l'occasion d'accumuler plus. Absent (pas de
  // calendrier connu), on retombe sur l'écart réel — comportement inchangé.
  const g = options.paceGaps || gap.gaps || {};
  // Pour compter les « domaines » en retard (many-behind), validations et BEX
  // différentes comptent pour UN seul domaine : valider une BEX augmente les
  // deux à la fois, donc les compter séparément doublait artificiellement le
  // retard d'un élève à qui il ne manque qu'une seule BEX.
  const domains = ['dl', 'quiz', 'depassements'].filter((k) => g[k] > 0).length + (g.validations > 0 || g.bexDiff > 0 ? 1 : 0);

  if (gap.reached) return options.atTop ? 'level-max' : 'target-reached';
  // Tout début d'année : un élève qui n'a encore RIEN rendu n'est pas « en
  // retard », il n'a juste pas commencé. On regarde ses compteurs réels, pas
  // l'écart vers l'objectif : dès la 1re semaine, l'écart est presque toujours
  // positif sur plusieurs compteurs (les seuils JS ne sont jamais à 0), donc un
  // écart nul ne serait quasiment jamais vrai. Dès qu'un compteur bouge, le
  // conseil spécifique redevient plus utile et plus vrai que ce message
  // générique — on ne l'écrase donc pas.
  const counters = gap.counters || {};
  const nothingDoneYet = ['dl', 'quiz', 'validations', 'bexDiff', 'depassements'].every(
    (k) => !counters[k]
  );
  if (options.yearJustStarted && nothingDoneYet) return 'period-start';
  // Le côté « ça vient de commencer » adoucit seulement le cumul de retards
  // (qui serait décourageant en semaine 2), pas les conseils ciblés ci-dessous.
  if (domains >= 3 && !options.yearJustStarted) return 'many-behind';

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
  // Plus rien à signaler AU RYTHME ACTUEL, mais l'objectif réel n'est pas
  // atteint (sinon gap.reached aurait déjà tranché plus haut) : l'élève est
  // dans les temps, pas encore arrivé. Sans rythme calculé (paceGaps absent),
  // comportement historique inchangé.
  return options.paceGaps ? 'on-pace' : 'target-reached';
}

/**
 * Ordre de priorité exact utilisé par adviceKey() : dès qu'une condition est
 * vraie, les suivantes ne sont plus regardées. Recopié ici uniquement pour
 * l'affichage (admin, onglet Conseils) — si adviceKey() change, penser à
 * mettre ces deux constantes à jour.
 */
export const ADVICE_ORDER = [
  'level-max',
  'target-reached',
  'period-start',
  'many-behind',
  'need-new-bex',
  'missions-heavy',
  'need-revalidation',
  'behind-dl',
  'behind-quiz',
  'need-depassement',
  'exam-condition',
  'on-pace',
];

/**
 * Condition de déclenchement de chaque conseil, en français, pour l'admin.
 * ⚠️ Depuis le calendrier réel par cours (paceGapTo), « en retard » veut dire
 * en retard sur ce qui est déjà possible à ce stade de la période — pas sur
 * le seuil de fin de période. Sans calendrier connu (cours pas encore
 * réimporté depuis cet ajout), les seuils de fin de période servent tels
 * quels, comme avant.
 */
export const ADVICE_CONDITIONS = {
  'level-max': "Objectif Très bien atteint : il n'y a plus de palier au-dessus.",
  'target-reached': 'Objectif atteint (autre que Très bien).',
  'period-start':
    "Aucun compteur touché (DL, quiz, validations, BEX différentes, dépassements tous à 0) ET on est avant le 15 septembre.",
  'many-behind':
    '3 domaines en retard (au rythme) ou plus — DL, quiz, validations/BEX différentes ensemble, dépassements —, ET on est après le 15 septembre (avant cette date, un conseil plus précis prend le relais).',
  'need-new-bex': "Il manque des BEX différentes au rythme, ou une BEX socle n'est pas encore validée (le socle n'est jamais adouci).",
  'missions-heavy':
    "Il manque des validations au rythme, ET l'élève en a déjà ≥ 3 via des missions avec peu de BEX revalidées par rapport à ses BEX différentes.",
  'need-revalidation': 'Il manque des validations au rythme (hors cas « missions-heavy » ci-dessus).',
  'behind-dl': 'Il manque des devoirs libres au rythme, et rien des conditions précédentes ne s\'applique.',
  'behind-quiz': 'Il manque des quiz au rythme, et rien des conditions précédentes ne s\'applique.',
  'need-depassement': 'Il manque des dépassements au rythme, et rien des conditions précédentes ne s\'applique.',
  'exam-condition':
    "Tout est bon au rythme, mais l'examen de juin est encore en attente ou insuffisant pour le niveau visé.",
  'on-pace':
    "Rien à signaler au rythme actuel, mais l'objectif final n'est pas encore atteint : l'élève est dans les temps, pas en retard. Ne se déclenche que si le calendrier réel du cours est connu (sinon target-reached ne s'applique jamais dans ce cas puisque l'objectif ne serait pas atteint tout court).",
};

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
  'on-pace':
    "Tu es dans les temps : vu le nombre de semaines déjà passées, tu ne peux pas encore avoir plus, et tu n'as rien loupé. Continue à ce rythme-là. Pour atteindre ton objectif d'ici la fin de la période, il te faudra au total : {ecart}.",
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
