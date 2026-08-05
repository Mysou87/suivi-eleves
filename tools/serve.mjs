// Petit serveur statique pour ouvrir l'app en local (les modules JavaScript
// refusent de se charger depuis file://).
//   npm run serve      puis http://localhost:4173
//
// Il sert aussi deux routes que la page seule ne peut pas assurer, parce qu'un
// navigateur n'a pas le droit d'ouvrir un fichier par son chemin :
//   GET  /api/workbook  → où est le classeur, et de quand date-t-il
//   POST /api/import    → le lit et l'envoie vers Supabase (le bouton
//                         « Mettre à jour maintenant » de l'administration)
// Ces routes n'existent que sur cet ordinateur : en ligne, l'administration ne
// les trouve pas et propose seulement le choix d'un fichier à la main.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importWorkbook, workbookInfo, countInscriptions } from './run-import.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// --------------------------------------------------------------------- API

// Un seul import à la fois : deux clics de suite ne doivent pas écrire deux fois.
let importing = false;

function sendJson(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(text);
}

// Le serveur écoute sur toutes les interfaces : on n'accepte l'import que depuis
// cet ordinateur, jamais depuis un autre poste du réseau.
function isLocal(request) {
  const address = request.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

async function handleApi(path, request, response) {
  if (!isLocal(request)) {
    sendJson(response, 403, { error: 'Accessible seulement depuis cet ordinateur.' });
    return;
  }

  if (path === '/api/workbook' && request.method === 'GET') {
    sendJson(response, 200, await workbookInfo());
    return;
  }

  if (path === '/api/import' && request.method === 'POST') {
    if (importing) {
      sendJson(response, 409, { error: 'Un import est déjà en cours.' });
      return;
    }
    importing = true;
    const started = Date.now();
    try {
      const { info, parsed, report } = await importWorkbook();
      console.log(
        `Import depuis l'administration : ${info.name} · ` +
          `${countInscriptions(parsed)} inscriptions · ${report.errors.length} erreur(s)`
      );
      sendJson(response, 200, {
        file: info,
        inscriptions: countInscriptions(parsed),
        sheets: parsed.groups.length,
        steps: report.steps,
        warnings: report.warnings,
        errors: report.errors,
        importId: report.importId ?? null,
        seconds: Math.round((Date.now() - started) / 100) / 10,
      });
    } catch (error) {
      console.error(`Import échoué : ${error.message}`);
      sendJson(response, 500, { error: error.message });
    } finally {
      importing = false;
    }
    return;
  }

  sendJson(response, 404, { error: 'Route inconnue.' });
}

// ------------------------------------------------------------------- serveur

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  let path = decodeURIComponent(url.pathname);
  if (path === '/') path = '/index.html';

  if (path.startsWith('/api/')) {
    await handleApi(path, request, response);
    return;
  }

  // On refuse de sortir du dossier du projet.
  const target = join(ROOT, normalize(path).replace(/^([/\\])+/, ''));
  if (!target.startsWith(ROOT)) {
    response.writeHead(403).end('Interdit');
    return;
  }

  try {
    const info = await stat(target);
    if (info.isDirectory()) throw new Error('dossier');
    const body = await readFile(target);
    response.writeHead(200, {
      'content-type': TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Introuvable');
  }
});

// On écoute UNIQUEMENT sur cet ordinateur (127.0.0.1) et pas sur le réseau
// local : `js/config.local.js` contient le mot de passe de l'administration et
// la clé d'écriture de la base, et ce serveur servirait ce fichier à quiconque
// le demande. Un poste voisin ne peut donc même plus se connecter.
server.listen(PORT, '127.0.0.1', async () => {
  console.log(`App élève      : http://localhost:${PORT}/`);
  console.log(`Administration : http://localhost:${PORT}/admin.html`);
  console.log(`Démonstration  : http://localhost:${PORT}/?demo=1`);

  const info = await workbookInfo();
  console.log(
    info.exists
      ? `Classeur       : ${info.path} (modifié le ${new Date(info.modifiedAt).toLocaleString('fr-BE')})`
      : `Classeur       : INTROUVABLE — ${info.path}`
  );
  console.log('Ctrl+C pour arrêter.');
});
