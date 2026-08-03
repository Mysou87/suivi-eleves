// Configuration de l'app de suivi.
// Même projet Supabase que l'app Leitner : la table `students` est partagée.

export const SUPABASE_URL = 'https://iuharjafrhwzhhggwzgy.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1aGFyamFmcmh3emhoZ2d3emd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4MjMzMTgsImV4cCI6MjA5NjM5OTMxOH0.ieZT0hpGMcPQsJm6IjufzsZelZW3i25VSKhe_F8tqHk';

/**
 * Le mot de passe de l'administration n'est PAS dans ce fichier : le dépôt est
 * public, il serait lisible par n'importe qui. Il vit dans `js/config.local.js`,
 * qui n'est jamais publié. Sans ce fichier, l'admin refuse l'accès — c'est
 * voulu : l'administration ne sert que depuis l'ordinateur de la professeure.
 */
export async function loadLocalSecrets() {
  try {
    return await import('./config.local.js');
  } catch {
    return {};
  }
}

// Année civile de la rentrée : sert à dater les en-têtes « 7/9 », « 14/9 »…
export const SCHOOL_YEAR_START = 2026;

/**
 * Emplacement du classeur de référence. Dossier OneDrive synchronisé : il est
 * donc accessible comme un fichier local, ce qui permet un import automatique
 * quotidien, tout en restant éditable depuis n'importe quel poste.
 * Utilisé par les outils en ligne de commande, pas par la page web.
 */
export const WORKBOOK_PATH =
  'C:\\Users\\lvano\\OneDrive - ecoleactive.be\\Feuilles de cotes 2026-2027.xlsx';

/**
 * Correspondance entre les onglets de résultats et les libellés utilisés dans
 * les feuilles « Seuils de réussite » et « Liste », qui ne sont pas identiques.
 * Modifiable depuis l'admin (table `suivi_course_aliases`) ; ceci n'est que la
 * valeur de départ.
 *
 * La lettre d'un onglet est un GROUPE, jamais une classe : la classe de chaque
 * élève vient de la colonne A du classeur.
 */
export const COURSE_MAP = {
  '4A Sciences': { thresholds: '4e Sciences', list: '4e Sciences' },
  '4e Option': { thresholds: '4e Option', list: '4e Option Sciences' },
  '5e Chimie A': { thresholds: '5e Chimie', list: '5e Chimie' },
  '5e Chimie B': { thresholds: '5e Chimie', list: '5e Chimie' },
  '5e Chimie C': { thresholds: '5e Chimie', list: '5e Chimie' },
  '5e Physique C': { thresholds: '5e Physique', list: '5e Physique' },
  '6e Chimie': { thresholds: '6e Chimie', list: '6e Chimie' },
};

/**
 * Excel remplace les espaces des noms d'onglets par des underscores lorsque le
 * classeur passe en ligne (« 5e_Chimie_A »). On ramène tout à la forme avec
 * espaces, y compris pour ce qui est enregistré en base, afin qu'un même cours
 * ne soit pas dédoublé selon le format du fichier importé.
 */
export function normalizeSheetName(sheetName) {
  return String(sheetName ?? '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Faute de correspondance connue, on retire la lettre de groupe finale et on
 * normalise « 4A Sciences » en « 4e Sciences ». Permet d'ajouter un onglet
 * sans rien configurer.
 */
export function guessCourseLabel(sheetName) {
  const clean = normalizeSheetName(sheetName);
  const known = COURSE_MAP[clean] || COURSE_MAP[sheetName];
  if (known) return known;
  const base = clean.replace(/\s+[A-D]$/i, '').replace(/^(\d)[A-D]\s+/i, '$1e ');
  return { thresholds: base, list: base };
}

/**
 * Onglets présents dans le classeur mais que l'application ignore.
 * Les underscores et la casse n'ont pas d'importance.
 *
 * « 4A Maths » : cours d'un autre professeur, pas encore configuré (ni bloc
 * dans la feuille Liste, ni grille de seuils). À retirer d'ici dès que ces deux
 * blocs existeront — l'objectif est bien que l'élève retrouve tous ses cours au
 * même endroit.
 */
export const IGNORED_SHEETS = ['4A Maths'];

// Les libellés des rôles de mission et des types de dépassement des onglets de
// résultats sont ceux de l'an dernier et ne correspondent plus à la feuille
// « Liste ». Tant que c'est le cas, on affiche des nombres sans les nommer.
export const NAME_MISSIONS_AND_DEPASSEMENTS = false;
