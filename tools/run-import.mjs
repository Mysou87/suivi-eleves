// Lecture du classeur sur le disque puis envoi vers Supabase.
//
// Partagé par l'import en ligne de commande (tools/import.mjs) et par le bouton
// « Mettre à jour maintenant » de l'administration, servi par tools/serve.mjs.
// Un import est rejouable : les élèves sont rapprochés par nom + prénom, et un
// import qui ne change rien n'ajoute aucune étape à leur progression.

import XLSX from 'xlsx';
import { stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createClient } from '@supabase/supabase-js';
import { parseWorkbook } from '../js/parser.js';
import { syncWorkbook } from '../js/sync.js';
import {
  SUPABASE_URL,
  SCHOOL_YEAR_START,
  WORKBOOK_PATH,
  WORKBOOK_SEARCH_FOLDERS,
  WORKBOOK_NAME_PATTERN,
  IGNORED_SHEETS,
  loadLocalSecrets,
  MISSING_SERVICE_KEY,
} from '../js/config.js';

export function fileNameOf(path) {
  return String(path).split(/[\\/]/).pop();
}

const exists = async (file) => {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
};

/**
 * Où est le classeur sur CET ordinateur. Le chemin de la machine principale ne
 * vaut pas sur une autre : on essaie donc, dans l'ordre,
 *   1. le chemin donné en argument (ligne de commande) ;
 *   2. `WORKBOOK_PATH` exporté par js/config.local.js, propre à la machine ;
 *   3. le chemin par défaut de js/config.js ;
 *   4. une recherche dans les dossiers habituels du profil Windows, en gardant
 *      le fichier le plus récemment enregistré.
 *
 * Renvoie `{ path, how }`, où `how` sert à l'expliquer à l'écran.
 */
export async function findWorkbook(preferred = null) {
  if (preferred) return { path: preferred, how: 'chemin demandé' };

  const { WORKBOOK_PATH: localPath } = await loadLocalSecrets();
  if (localPath && (await exists(localPath))) return { path: localPath, how: 'config.local.js' };

  if (await exists(WORKBOOK_PATH)) return { path: WORKBOOK_PATH, how: 'config.js' };

  const found = await searchWorkbook();
  if (!found.length) return { path: localPath || WORKBOOK_PATH, how: 'aucun fichier trouvé' };

  return { path: found[0].path, how: 'trouvé automatiquement', alternatives: found.length - 1 };
}

/**
 * Balaye les dossiers habituels du profil Windows et renvoie les classeurs
 * trouvés, du plus récemment enregistré au plus ancien. Exporté pour être
 * testable sans devoir déplacer le vrai classeur.
 */
export async function searchWorkbook(folders = WORKBOOK_SEARCH_FOLDERS) {
  const thisYear = `${SCHOOL_YEAR_START}-${SCHOOL_YEAR_START + 1}`;
  const found = [];

  for (const folder of folders) {
    const directory = join(homedir(), folder);
    let entries;
    try {
      entries = await readdir(directory);
    } catch {
      continue; // dossier absent sur cette machine
    }
    for (const entry of entries) {
      // Les fichiers de verrouillage d'Excel (« ~$… ») ne sont pas des classeurs.
      if (entry.startsWith('~$') || !WORKBOOK_NAME_PATTERN.test(entry)) continue;
      const full = join(directory, entry);
      try {
        const info = await stat(full);
        if (info.isFile()) found.push({ path: full, at: info.mtime.getTime(), score: score(entry, thisYear) });
      } catch {
        /* ignoré */
      }
    }
  }

  // D'abord le fichier qui ressemble le plus au classeur de l'année en cours,
  // ensuite seulement le plus récemment enregistré.
  return found.sort((a, b) => b.score - a.score || b.at - a.at);
}

/**
 * Un dossier contient souvent plusieurs candidats : le classeur de l'an dernier,
 * des copies de sauvegarde, un modèle vierge. « Le plus récent » ne suffit donc
 * pas : on écarte d'abord ce qui n'est manifestement pas le classeur de travail.
 */
function score(fileName, thisYear) {
  const name = fileName.toLowerCase();
  let value = 0;
  if (name.includes(thisYear)) value += 3;
  if (/\d{4}-\d{4}/.test(name) && !name.includes(thisYear)) value -= 3; // autre année scolaire
  if (/copie|vierge|sauvegarde|backup|ancien|test/.test(name)) value -= 2;
  return value;
}

/**
 * Existence et date de dernière modification du classeur : l'administration
 * l'affiche pour que la fraicheur du fichier soit visible avant de cliquer.
 */
export async function workbookInfo(file = null) {
  const { path, how, alternatives } = await findWorkbook(file);
  const base = { path, name: fileNameOf(path), how, alternatives: alternatives || 0 };
  try {
    const info = await stat(path);
    return { ...base, exists: true, modifiedAt: info.mtime.toISOString(), size: info.size };
  } catch (error) {
    return { ...base, exists: false, error: error.code === 'ENOENT' ? 'introuvable' : String(error) };
  }
}

/** Lecture + interprétation du classeur, sans rien envoyer. */
export async function readWorkbook(file = null) {
  const { path } = await findWorkbook(file);
  const wb = XLSX.readFile(path, { cellDates: false });
  const sheets = wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], {
      header: 1,
      raw: false,
      defval: '',
      blankrows: true,
    }),
  }));

  return parseWorkbook(sheets, {
    startYear: SCHOOL_YEAR_START,
    ignore: IGNORED_SHEETS,
  });
}

/** Nombre d'inscriptions lues, pour les comptes rendus. */
export function countInscriptions(parsed) {
  return parsed.groups.reduce((n, group) => n + group.students.length, 0);
}

/**
 * Client autorisé à écrire. La clé anon publiée est en lecture seule depuis
 * sql/policies.sql : écrire exige la clé `service_role`, qui ne vit que dans
 * js/config.local.js, sur cet ordinateur.
 */
export async function writeClient() {
  const { SUPABASE_SERVICE_KEY } = await loadLocalSecrets();
  if (!SUPABASE_SERVICE_KEY) throw new Error(MISSING_SERVICE_KEY);
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Envoi vers Supabase d'un classeur déjà lu. */
export async function syncParsed(parsed, fileName, fileModifiedAt = null) {
  const db = await writeClient();
  return syncWorkbook(db, parsed, { fileName, source: 'manuel', fileModifiedAt });
}

/**
 * Lecture puis envoi vers Supabase. Renvoie de quoi rendre compte à l'écran ou
 * dans le terminal. Lève si le classeur est introuvable ou illisible.
 */
export async function importWorkbook(file = null) {
  const info = await workbookInfo(file);
  if (!info.exists) throw new Error(`Classeur introuvable : ${info.path}`);

  const parsed = await readWorkbook(info.path);
  const report = await syncParsed(parsed, info.name, info.modifiedAt);
  return { info, parsed, report };
}
