// Lecteur du classeur « Feuilles de cotes ».
//
// Le parseur ne dépend pas de SheetJS : il reçoit les feuilles déjà converties
// en tableaux 2D de chaines (`[{ name, rows }]`), ce qui le rend utilisable
// tel quel dans le navigateur (admin.html) et en ligne de commande (tools/).
//
// Tout est repéré par les TITRES des blocs et non par des numéros de ligne,
// pour que Laureline puisse insérer ou décaler des lignes sans rien casser.

// ---------------------------------------------------------------- utilitaires

const BLANK = /^\s*$/;

export function isBlank(v) {
  return v === null || v === undefined || BLANK.test(String(v));
}

/**
 * Date → « AAAA-MM-JJ » en heure LOCALE. `Date.toISOString()` convertit en
 * UTC et peut reculer d'un jour (minuit en Belgique = la veille en UTC, été
 * comme hiver) : à éviter pour des dates de calendrier, qui n'ont pas d'heure.
 */
export function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** minuscules, sans accents, espaces normalisés — pour comparer des libellés */
export function norm(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Les fiches d'aménagements raisonnables marquent parfois le prénom d'un
 * « * » (acquis) ou d'un « (*) » (en cours), directement dans le classeur de
 * cotes. Ce marquage ne fait pas partie de l'identité de l'élève : le retirer
 * évite qu'il se retrouve dédoublé en base au moindre import qui le reprend.
 */
export function stripAccommodationMark(firstName) {
  return String(firstName ?? '')
    .replace(/\s*\(\*\)\s*$|\s*\*\s*$/, '')
    .trim();
}

/** clé d'identité d'un élève, tolérante à la casse et aux accents */
export function studentKey(lastName, firstName) {
  return `${norm(lastName)}|${norm(stripAccommodationMark(firstName))}`;
}

function cell(rows, r, c) {
  const row = rows[r];
  if (!row) return '';
  const v = row[c];
  return v === null || v === undefined ? '' : String(v).trim();
}

function rowIsEmpty(rows, r) {
  const row = rows[r];
  if (!row) return true;
  return row.every(isBlank);
}

/**
 * Excel convertit parfois en vraie date (et réaffiche en toutes lettres) une
 * cellule tapée à la main hors d'un en-tête déjà en texte — ex. « 22-Sep » au
 * lieu de « 22/09 ». Noms de mois en français et en anglais, abrégés ou non.
 */
const MONTH_NAMES = {
  jan: 1, janv: 1, janvier: 1, january: 1,
  fev: 2, fevr: 2, fevrier: 2, feb: 2, february: 2,
  mar: 3, mars: 3, march: 3,
  avr: 4, avril: 4, apr: 4, april: 4,
  mai: 5, may: 5,
  juin: 6, jun: 6, june: 6,
  juil: 7, juillet: 7, jul: 7, july: 7,
  aou: 8, aout: 8, aug: 8, august: 8,
  sep: 9, sept: 9, septembre: 9, september: 9,
  oct: 10, octobre: 10, october: 10,
  nov: 11, novembre: 11, november: 11,
  dec: 12, decembre: 12, december: 12,
};

/**
 * Retrouve une date d'en-tête quel que soit le format produit par LibreOffice,
 * Excel ou Google Sheets : « 7/9 », « 07/09/2026 », « 2026-09-07 », ou en
 * toutes lettres (« 22-Sep », « Sep-22 »). `startYear` = année civile de la
 * rentrée (2026 pour 2026-2027).
 */
export function parseHeaderDate(raw, startYear) {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  const withYear = (month, day, rawYear) => {
    let year = rawYear ? +rawYear : null;
    if (year !== null && year < 100) year += 2000;
    // Sans année explicite : septembre à décembre = année de rentrée, sinon l'année suivante.
    if (year === null) year = month >= 8 ? startYear : startYear + 1;
    return new Date(year, month - 1, day);
  };

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);

  m = s.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/);
  if (m) return withYear(+m[2], +m[1], m[3]);

  m = s.match(/^(\d{1,2})[\s-]+([a-zéèêîû]{3,10})\.?(?:[\s-]+(\d{2,4}))?$/i);
  if (m && MONTH_NAMES[norm(m[2])]) return withYear(MONTH_NAMES[norm(m[2])], +m[1], m[3]);

  m = s.match(/^([a-zéèêîû]{3,10})\.?[\s-]+(\d{1,2})(?:[\s-]+(\d{2,4}))?$/i);
  if (m && MONTH_NAMES[norm(m[1])]) return withYear(MONTH_NAMES[norm(m[1])], +m[2], m[3]);

  return null;
}

// ------------------------------------------------------------------- blocs

// Ordre important : « savoir-faire » doit être testé avant « savoirs ».
const BLOCK_TYPES = [
  { key: 'dl', match: (t) => t.startsWith('devoirs libres') },
  { key: 'bex', match: (t) => t.startsWith('savoir-faire') || t.startsWith('savoirs faire') },
  { key: 'quiz', match: (t) => t.startsWith('savoirs') },
  { key: 'missions', match: (t) => t.startsWith('competences') },
  { key: 'depassements', match: (t) => t.startsWith('se depasser') },
  { key: 'bulletins', match: (t) => t.startsWith('bulletin') },
];

function blockTypeOf(text) {
  const t = norm(text);
  if (!t) return null;
  const found = BLOCK_TYPES.find((b) => b.match(t));
  return found ? found.key : null;
}

/**
 * Repère les blocs d'une feuille de résultats : leur ligne de titre, la ligne
 * d'en-têtes qui suit, la première colonne de données et la plage d'élèves.
 */
function findBlocks(rows) {
  const blocks = [];

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const type = blockTypeOf(row[c]);
      if (!type) continue;
      // Un titre de bloc est seul sur sa ligne, à droite des colonnes d'identité.
      if (c < 2) continue;
      blocks.push({ type, titleRow: r, titleCol: c, title: String(row[c]).trim() });
      break;
    }
  }

  // Chaque bloc s'arrête au début du suivant.
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const limit = i + 1 < blocks.length ? blocks[i + 1].titleRow : rows.length;

    // La première ligne non vide après le titre porte les en-têtes de colonnes.
    let hr = b.titleRow + 1;
    while (hr < limit && rowIsEmpty(rows, hr)) hr++;
    b.headerRow = hr < limit ? hr : null;

    if (b.headerRow === null) {
      b.dataStartCol = b.titleCol;
      b.firstStudentRow = null;
      b.lastStudentRow = null;
      continue;
    }

    const header = rows[b.headerRow] || [];
    b.dataStartCol = header.findIndex((v) => !isBlank(v));
    if (b.dataStartCol < 0) b.dataStartCol = b.titleCol;

    // Colonnes d'identité, déduites de la première colonne de données.
    // 2026-27 : A classe, B nom, C prénom, D vide, E+ données.
    // 2025-26 : A nom, B prénom, C vide, D+ données (pas de classe).
    b.cols = {
      class: b.dataStartCol - 4,
      lastName: b.dataStartCol - 3,
      firstName: b.dataStartCol - 2,
    };

    // Certains blocs ont plusieurs lignes d'en-tête : « DEVOIRS LIBRES » porte
    // les S1…S32 puis les dates en dessous. Une ligne sans nom ni prénom mais
    // remplie à droite est encore un en-tête ; on retient la dernière, celle
    // qui porte les libellés les plus utiles (les dates).
    const hasIdentity = (r) =>
      !isBlank(cell(rows, r, b.cols.lastName)) || !isBlank(cell(rows, r, b.cols.firstName));

    for (let guard = 0; guard < 3; guard++) {
      const next = b.headerRow + 1;
      if (next >= limit || rowIsEmpty(rows, next) || hasIdentity(next)) break;
      b.headerRow = next;
    }

    let sr = b.headerRow + 1;
    while (sr < limit && rowIsEmpty(rows, sr)) sr++;
    b.firstStudentRow = sr < limit ? sr : null;

    // Les lignes d'élèves s'arrêtent à la première ligne sans nom ni prénom.
    let er = b.firstStudentRow;
    while (
      er !== null &&
      er < limit &&
      (!isBlank(cell(rows, er, b.cols.lastName)) || !isBlank(cell(rows, er, b.cols.firstName)))
    ) {
      er++;
    }
    b.lastStudentRow = er === null ? null : er - 1;
  }

  return blocks;
}

/**
 * Découpe les colonnes d'un bloc en groupes. Les en-têtes fusionnés (BEX,
 * Missions, dépassements) ne portent une valeur que sur leur première cellule :
 * un groupe s'étend donc jusqu'au prochain en-tête non vide, sans jamais
 * supposer une largeur de 3.
 */
function columnGroups(rows, block, endCol, warnings = []) {
  const header = rows[block.headerRow] || [];
  const last = Math.max(endCol, header.length - 1);

  const labels = [];
  for (let c = block.dataStartCol; c <= last; c++) {
    if (!isBlank(header[c])) labels.push({ label: String(header[c]).trim(), col: c });
  }
  if (!labels.length) return [];
  if (labels.length === 1) {
    return [{ label: labels[0].label, start: labels[0].col, end: last }];
  }

  // Écarts entre en-têtes consécutifs. Sur un fichier sain ils sont tous égaux
  // à la largeur du groupe (3 passages). Les fusions du classeur se chevauchent
  // d'une colonne, ce qui produit des écarts alternés 2 / 3 : la largeur réelle
  // est alors le plus grand écart, et les positions doivent être recalculées.
  const gaps = [];
  for (let i = 1; i < labels.length; i++) gaps.push(labels[i].col - labels[i - 1].col);
  const width = Math.max(...gaps);
  const regular = gaps.every((g) => g === width);

  if (regular) {
    return labels.map((l, i) => ({
      label: l.label,
      start: l.col,
      end: i + 1 < labels.length ? labels[i + 1].col - 1 : Math.min(last, l.col + width - 1),
    }));
  }

  warnings.push(
    `${block.title} : en-têtes fusionnés de travers (écarts ${gaps.join('/')}), ` +
      `positions recalculées sur une largeur de ${width}`
  );

  const first = labels[0].col;
  return labels.map((l, i) => ({
    label: l.label,
    start: first + i * width,
    end: first + (i + 1) * width - 1,
  }));
}

/** largeur utile d'un bloc, en regardant les lignes d'élèves */
function blockWidth(rows, block) {
  let w = block.dataStartCol;
  for (let r = block.firstStudentRow; r <= block.lastStudentRow; r++) {
    const row = rows[r] || [];
    for (let c = row.length - 1; c >= w; c--) {
      if (!isBlank(row[c])) {
        w = Math.max(w, c);
        break;
      }
    }
  }
  const header = rows[block.headerRow] || [];
  return Math.max(w, header.length - 1);
}

// ------------------------------------------------------ notes d'examen

/** « TB », « Très bien », « JS »… → clé de niveau, sinon null (« abs », vide) */
export function parseLevelValue(raw) {
  const t = norm(raw);
  if (!t) return null;
  if (t === 'tb' || t.startsWith('tres bien')) return 'TB';
  if (t === 'js' || t.startsWith('juste suffisant')) return 'JS';
  if (t === 'b' || t.startsWith('bien')) return 'B';
  if (t === 's' || t.startsWith('suffisant')) return 'S';
  if (t === 'i' || t.startsWith('insuffisant')) return 'I';
  return null;
}

/**
 * Bloc « Bulletin 1 / 2 / 3 » : on n'y cherche qu'une chose, la note d'examen.
 *
 * Les titres « Bulletin n » sont fusionnés, donc désalignés des sous-en-têtes :
 * on ne se fie qu'à la ligne de sous-en-têtes (DL | S | SF | C | D+ | Exam).
 * Une colonne nommée « Exam » l'emporte toujours ; « Auto » n'est retenue qu'à
 * défaut, car dans les bulletins 1 et 2 c'est une auto-évaluation, pas un
 * examen. Quand plusieurs colonnes qualifient, on prend la dernière, celle du
 * bulletin le plus récent.
 */
function findExamColumn(rows, block) {
  if (!block || block.headerRow === null) return { col: -1, legacyName: false };

  const header = rows[block.headerRow] || [];
  const exams = [];
  const autos = [];
  header.forEach((v, c) => {
    const h = norm(v);
    if (h === 'exam' || h === 'examen') exams.push(c);
    else if (h === 'auto') autos.push(c);
  });

  if (exams.length) return { col: exams[exams.length - 1], legacyName: false };
  if (autos.length) return { col: autos[autos.length - 1], legacyName: true };
  return { col: -1, legacyName: false };
}

// --------------------------------------------------- feuille « Liste »

const LIST_SECTIONS = [
  { key: 'quiz', match: (t) => t.startsWith('liste des qcm') },
  { key: 'bex', match: (t) => t.startsWith('liste des sujets') },
  { key: 'roles', match: (t) => t.startsWith('nom des competences') },
  { key: 'depassements', match: (t) => t.startsWith('depassements possibles') },
];

/**
 * Nomenclature par cours. La feuille empile un bloc par cours, chacun
 * introduit par son nom en colonne A.
 */
export function parseListSheet(rows) {
  const courses = [];
  const titleRows = [];

  for (let r = 0; r < rows.length; r++) {
    const a = cell(rows, r, 0);
    if (isBlank(a)) continue;
    // On écarte les lignes de rubrique qui peuvent traîner en colonne A.
    if (blockTypeOf(a)) continue;
    titleRows.push({ row: r, label: a });
  }

  for (let i = 0; i < titleRows.length; i++) {
    const { row, label } = titleRows[i];
    const limit = i + 1 < titleRows.length ? titleRows[i + 1].row : rows.length;

    // Ligne des sous-titres (« Liste des QCM », « Liste des sujets BEX »…).
    let headerRow = -1;
    const found = {};
    for (let r = row; r < limit && headerRow < 0; r++) {
      const cells = rows[r] || [];
      for (let c = 0; c < cells.length; c++) {
        const t = norm(cells[c]);
        if (!t) continue;
        const section = LIST_SECTIONS.find((s) => s.match(t));
        if (section) {
          found[section.key] = c;
          headerRow = r;
        }
      }
    }
    if (headerRow < 0) continue;

    const readColumns = (startCol, endCol) => {
      const out = [];
      for (let r = headerRow + 1; r < limit; r++) {
        if (rowIsEmpty(rows, r)) continue;
        for (let c = startCol; c <= endCol; c++) {
          const v = cell(rows, r, c);
          if (isBlank(v) || v === '0') continue;
          out.push(v);
        }
      }
      return out;
    };

    const keys = Object.keys(found);
    const bounds = {};
    keys.forEach((k) => {
      const start = found[k];
      // La section s'étend jusqu'à la colonne précédant la section suivante :
      // c'est ce qui permet de lire les BEX écrites sur deux colonnes.
      const nexts = keys.map((o) => found[o]).filter((c) => c > start);
      bounds[k] = { start, end: nexts.length ? Math.min(...nexts) - 1 : start + 3 };
    });

    courses.push({
      label,
      quiz: bounds.quiz ? readColumns(bounds.quiz.start, bounds.quiz.end) : [],
      bex: bounds.bex ? readColumns(bounds.bex.start, bounds.bex.end) : [],
      roles: bounds.roles ? readColumns(bounds.roles.start, bounds.roles.end) : [],
      depassements: bounds.depassements
        ? readColumns(bounds.depassements.start, bounds.depassements.end)
        : [],
    });
  }

  return courses;
}

// ------------------------------------------ feuille « Seuils de réussite »

const LEVELS = [
  { key: 'JS', match: 'juste suffisant' },
  { key: 'S', match: 'suffisant' },
  { key: 'B', match: 'bien' },
  { key: 'TB', match: 'tres bien' },
];

function levelOf(text) {
  const t = norm(text);
  if (!t) return null;
  // « très bien » contient « bien » : on teste du plus spécifique au plus général.
  if (t.startsWith('tres bien')) return 'TB';
  if (t.startsWith('juste suffisant')) return 'JS';
  if (t.startsWith('suffisant')) return 'S';
  if (t.startsWith('bien')) return 'B';
  return null;
}

const COUNTER_ORDER = ['dl', 'quiz', 'validations', 'bexDiff', 'depassements'];

/**
 * Grille de seuils par cours et par période. On s'accroche aux cellules
 * « Seuils P1 / P2 / P3 » : le nom du cours est en colonne A de la ligne du
 * tableau P1, les tableaux P2 et P3 héritent du dernier cours rencontré.
 */
export function parseThresholdsSheet(rows) {
  const courses = new Map();
  let current = null;

  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r] || [];
    for (let c = 0; c < cells.length; c++) {
      const m = norm(cells[c]).match(/^seuils?\s*p\s*([123])$/);
      if (!m) continue;

      const period = +m[1];
      const label = cell(rows, r, 0);
      if (!isBlank(label)) current = label;
      if (!current) continue;

      if (!courses.has(current)) {
        courses.set(current, { label: current, periods: {}, socle: [], socleByPeriod: {} });
      }
      const course = courses.get(current);
      const levels = {};

      // Les quatre niveaux occupent les lignes suivantes.
      for (let rr = r + 1; rr < rows.length; rr++) {
        if (rowIsEmpty(rows, rr)) break;
        const key = levelOf(cell(rows, rr, c));
        if (!key) break;

        const values = {};
        COUNTER_ORDER.forEach((name, i) => {
          const raw = cell(rows, rr, c + 1 + i);
          values[name] = isBlank(raw) ? 0 : Number(String(raw).replace(',', '.'));
        });

        const note = cell(rows, rr, c + 1 + COUNTER_ORDER.length);
        if (!isBlank(note)) values.examCondition = note;
        levels[key] = values;
        if (key === 'TB') break;
      }

      course.periods[period] = levels;
      break;
    }
  }

  // Ligne « Socle : BEX1, 2, 3 », rattachée au cours du bloc courant.
  let socleOwner = null;
  for (let r = 0; r < rows.length; r++) {
    const label = cell(rows, r, 0);
    if (!isBlank(label) && courses.has(label)) socleOwner = label;

    const cells = rows[r] || [];
    for (let c = 0; c < cells.length; c++) {
      const t = norm(cells[c]);
      if (!t.startsWith('socle')) continue;
      const nums = String(cells[c]).match(/\d+/g);
      if (socleOwner && nums) {
        const course = courses.get(socleOwner);
        course.socle = nums.map(Number);
        // La ligne « Socle » est placée sous le tableau P3 : c'est une exigence
        // de fin d'année. L'imposer dès la P1 serait contradictoire avec un
        // seuil qui n'y demande qu'une seule BEX différente.
        course.socleByPeriod = { 3: course.socle };
      }
    }
  }

  return [...courses.values()];
}

// ------------------------------------------- feuille de résultats d'un cours

/** une feuille de résultats se reconnaît à son bloc « DEVOIRS LIBRES » */
export function isCourseSheet(rows) {
  return findBlocks(rows).some((b) => b.type === 'dl');
}

/**
 * Année et lettre de groupe déduites du nom d'onglet.
 *   « 4A Sciences » → { year: 4, group: 'A' }   (ici le groupe EST la classe)
 *   « 5e Chimie B » → { year: 5, group: 'B' }   (groupe ≠ classe, cf. colonne A)
 *   « 6e Chimie »   → { year: 6, group: null }
 */
export function sheetIdentity(sheetName) {
  // Les onglets d'un classeur passé par Excel en ligne portent des underscores
  // à la place des espaces : « 4A_Sciences ».
  const s = String(sheetName ?? '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const year = (s.match(/(\d)/) || [])[1];
  let group = (s.match(/^\d\s*([A-D])\b/i) || [])[1];
  if (!group) group = (s.match(/\b([A-D])\s*$/i) || [])[1];
  return { year: year ? +year : null, group: group ? group.toUpperCase() : null };
}

export function parseCourseSheet(sheetName, rows, options = {}) {
  const startYear = options.startYear ?? new Date().getFullYear();
  const identity = sheetIdentity(sheetName);
  const warnings = [];
  const blocks = findBlocks(rows);
  const byType = {};
  blocks.forEach((b) => {
    if (b.firstStudentRow === null) return;
    if (!byType[b.type]) byType[b.type] = b;
  });

  if (!byType.dl) {
    return { sheetName, students: [], warnings: [`${sheetName} : bloc DEVOIRS LIBRES introuvable`] };
  }

  // Colonnes hebdomadaires datées (devoirs libres et quiz).
  const weekColumns = (block) => {
    if (!block) return [];
    const header = rows[block.headerRow] || [];
    const out = [];
    for (let c = block.dataStartCol; c < header.length; c++) {
      if (isBlank(header[c])) continue;
      const raw = String(header[c]).trim();
      const date = parseHeaderDate(raw, startYear);
      out.push({ col: c, label: raw, date });
    }
    return out;
  };

  const dlWeeks = weekColumns(byType.dl);
  const quizWeeks = weekColumns(byType.quiz);

  // Ligne optionnelle « Eval : date1, date2… » entre le titre du bloc BEX et
  // sa vraie ligne d'en-têtes (comme la ligne « Socle » côté seuils) : donne
  // le vrai calendrier des moments BEX de ce cours, entré à la main au fil de
  // l'année. Repérée par son texte, pas par sa position.
  const evalDates = [];
  if (byType.bex && byType.bex.headerRow !== null) {
    for (let r = byType.bex.titleRow + 1; r < byType.bex.headerRow; r++) {
      const row = rows[r] || [];
      const labelCol = row.findIndex((v) => norm(v).startsWith('eval'));
      if (labelCol < 0) continue;
      for (let c = labelCol + 1; c < row.length; c++) {
        if (isBlank(row[c])) continue;
        const date = parseHeaderDate(String(row[c]).trim(), startYear);
        if (date) evalDates.push(date);
      }
      break;
    }
  }

  // Groupes de colonnes des blocs à passages multiples.
  const layoutWarnings = [];
  const groupsOf = (block) =>
    block ? columnGroups(rows, block, blockWidth(rows, block), layoutWarnings) : [];

  // Dans le bloc BEX, la colonne « Dépassement » est ignorée : les
  // dépassements se comptent uniquement dans le bloc du bas.
  const isDepassementLabel = (label) => norm(label).startsWith('depassement');
  const bexGroups = groupsOf(byType.bex).filter((g) => {
    if (isDepassementLabel(g.label)) return false;
    return !isBlank(g.label) && g.label !== '0';
  });
  const missionGroups = groupsOf(byType.missions).filter(
    (g) => !isBlank(g.label) && g.label !== '0'
  );
  const depGroups = groupsOf(byType.depassements).filter(
    (g) => !isBlank(g.label) && g.label !== '0'
  );

  // Les lignes d'élèves sont énumérées depuis le bloc « devoirs libres », puis
  // retrouvées par identité dans les autres blocs (l'ordre peut différer).
  const rosterBlock = byType.dl;
  const students = [];
  const index = new Map();

  for (let r = rosterBlock.firstStudentRow; r <= rosterBlock.lastStudentRow; r++) {
    const lastName = cell(rows, r, rosterBlock.cols.lastName);
    const firstName = stripAccommodationMark(cell(rows, r, rosterBlock.cols.firstName));
    if (isBlank(lastName) && isBlank(firstName)) continue;

    // Sans colonne classe (tronc commun), la classe est celle du nom d'onglet.
    const rawClass =
      rosterBlock.cols.class >= 0 ? cell(rows, r, rosterBlock.cols.class) : '';
    const classLetter = (rawClass || identity.group || '').toUpperCase();

    const student = {
      lastName,
      firstName,
      classLetter,
      className: identity.year && classLetter ? `${identity.year}${classLetter}` : '',
      key: studentKey(lastName, firstName),
      counters: { dl: 0, quiz: 0, validations: 0, bexDiff: 0, depassements: 0 },
      dl: [],
      quiz: [],
      bex: [],
      missions: [],
      depassements: [],
      examLevel: null,
    };
    students.push(student);
    index.set(student.key, student);
  }

  const rowIndexOf = (block) => {
    const map = new Map();
    if (!block || block.firstStudentRow === null) return map;
    for (let r = block.firstStudentRow; r <= block.lastStudentRow; r++) {
      const key = studentKey(
        cell(rows, r, block.cols.lastName),
        cell(rows, r, block.cols.firstName)
      );
      if (key !== '|') map.set(key, r);
    }
    return map;
  };

  // --- devoirs libres et quiz : une case cochée par semaine, sauf si
  // plusieurs ont été faits le même jour : « 2 » compte alors pour deux.
  const readWeeks = (block, weeks, target) => {
    if (!block) return;
    const rowsByKey = rowIndexOf(block);
    students.forEach((s) => {
      const r = rowsByKey.get(s.key);
      if (r === undefined) return;
      weeks.forEach((w) => {
        const raw = cell(rows, r, w.col);
        if (isBlank(raw)) return;
        const n = Number(String(raw).replace(',', '.'));
        const count = Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
        for (let i = 0; i < count; i++) {
          s[target].push({ label: w.label, date: w.date, value: raw });
        }
      });
      s.counters[target] = s[target].length;
    });
  };

  readWeeks(byType.dl, dlWeeks, 'dl');
  readWeeks(byType.quiz, quizWeeks, 'quiz');

  // --- BEX : chaque case remplie d'un groupe est une validation
  if (byType.bex) {
    const rowsByKey = rowIndexOf(byType.bex);
    students.forEach((s) => {
      const r = rowsByKey.get(s.key);
      if (r === undefined) return;
      bexGroups.forEach((g, i) => {
        const attempts = [];
        for (let c = g.start; c <= g.end; c++) {
          const v = cell(rows, r, c);
          if (!isBlank(v)) attempts.push(v);
        }
        s.bex.push({ index: i + 1, label: g.label, attempts });
      });
    });
  }

  // --- missions et dépassements : on compte les cases remplies
  const readCells = (block, groups, target) => {
    if (!block) return;
    const rowsByKey = rowIndexOf(block);
    students.forEach((s) => {
      const r = rowsByKey.get(s.key);
      if (r === undefined) return;
      groups.forEach((g) => {
        for (let c = g.start; c <= g.end; c++) {
          const v = cell(rows, r, c);
          if (isBlank(v) || v === '0') continue;
          s[target].push({ label: g.label, value: v });
        }
      });
      s.counters[target] = s[target].length;
    });
  };

  readCells(byType.missions, missionGroups, 'missions');
  readCells(byType.depassements, depGroups, 'depassements');

  // --- note d'examen, lue dans le bloc « Bulletin »
  const exam = findExamColumn(rows, byType.bulletins);
  if (exam.col >= 0) {
    const rowsByKey = rowIndexOf(byType.bulletins);
    students.forEach((s) => {
      const r = rowsByKey.get(s.key);
      if (r === undefined) return;
      s.examLevel = parseLevelValue(cell(rows, r, exam.col));
    });
  }
  if (exam.legacyName) {
    warnings.push(
      `${sheetName} : aucune colonne « Exam » dans le bloc Bulletin, la dernière colonne « Auto » est utilisée à la place`
    );
  }

  // --- compteurs dérivés
  students.forEach((s) => {
    const bexValidations = s.bex.reduce((n, b) => n + b.attempts.length, 0);
    s.counters.bexDiff = s.bex.filter((b) => b.attempts.length > 0).length;
    s.counters.validations = bexValidations + s.missions.length;
  });

  layoutWarnings.forEach((w) => warnings.push(`${sheetName} · ${w}`));
  if (!byType.quiz) warnings.push(`${sheetName} : bloc SAVOIRS (QCM) introuvable`);
  if (!byType.bex) warnings.push(`${sheetName} : bloc SAVOIR-FAIRE (BEX) introuvable`);
  if (byType.bex && bexGroups.length !== 8) {
    warnings.push(`${sheetName} : ${bexGroups.length} BEX détectées au lieu de 8`);
  }

  return {
    sheetName,
    year: identity.year,
    group: identity.group,
    layout: {
      dlWeeks: dlWeeks.length,
      quizWeeks: quizWeeks.length,
      // Calendrier réel des semaines de devoirs libres (congés/décloisonnements
      // déjà exclus, puisque ce sont les colonnes réellement présentes) : sert
      // à savoir combien de semaines ont déjà eu lieu, pour adapter les
      // conseils au rythme au lieu de comparer au seuil de fin de période.
      dlWeekDates: dlWeeks.map((w) => w.date).filter(Boolean).map(toISODate),
      // Dates des moments BEX déjà passés (ligne « Eval : » du classeur),
      // triées : sert à savoir combien de fois une validation a déjà été
      // possible, pour ne jamais exiger plus que ce qui a réellement eu lieu.
      evalDates: [...evalDates].sort((a, b) => a - b).map(toISODate),
      bexGroups: bexGroups.map((g) => g.label),
      missionGroups: missionGroups.map((g) => g.label),
      depassementGroups: depGroups.map((g) => g.label),
      hasClassColumn: rosterBlock.cols.class >= 0,
      examColumn: exam.col >= 0 ? exam.col : null,
    },
    students,
    warnings,
  };
}

// ------------------------------------------------------------- orchestration

/**
 * Point d'entrée. `sheets` = [{ name, rows }] dans l'ordre du classeur.
 * `courseMap` = correspondance onglet → { list, thresholds } quand les
 * libellés diffèrent d'une feuille à l'autre.
 */
export function parseWorkbook(sheets, options = {}) {
  const warnings = [];
  const bySheetName = new Map(sheets.map((s) => [norm(s.name), s]));

  // Comparaison tolérante aux underscores d'Excel en ligne.
  const sheetKey = (name) => norm(String(name ?? '').replace(/_+/g, ' '));
  const ignored = new Set((options.ignore || []).map(sheetKey));

  const findSheet = (predicate) => sheets.find((s) => predicate(sheetKey(s.name)));

  const listSheet = findSheet((n) => n === 'liste' || n.startsWith('liste'));
  const thresholdSheet = findSheet((n) => n.startsWith('seuils'));

  const nomenclature = listSheet ? parseListSheet(listSheet.rows) : [];
  const thresholds = thresholdSheet ? parseThresholdsSheet(thresholdSheet.rows) : [];

  if (!listSheet) warnings.push('feuille « Liste » introuvable');
  if (!thresholdSheet) warnings.push('feuille « Seuils de réussite » introuvable');

  const groups = [];
  const skipped = [];
  sheets.forEach((s) => {
    if (s === listSheet || s === thresholdSheet) return;
    if (ignored.has(sheetKey(s.name))) {
      skipped.push(s.name);
      return;
    }
    if (!isCourseSheet(s.rows)) return;
    const parsed = parseCourseSheet(s.name, s.rows, options);
    warnings.push(...parsed.warnings);
    groups.push(parsed);
  });

  if (skipped.length) warnings.push(`onglet(s) ignoré(s) volontairement : ${skipped.join(', ')}`);

  return { nomenclature, thresholds, groups, skipped, warnings, bySheetName };
}
