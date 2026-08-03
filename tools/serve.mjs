// Petit serveur statique pour ouvrir l'app en local (les modules JavaScript
// refusent de se charger depuis file://).
//   npm run serve      puis http://localhost:4173
//
// Aucune dépendance : c'est le serveur HTTP de Node.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  let path = decodeURIComponent(url.pathname);
  if (path === '/') path = '/index.html';

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

server.listen(PORT, () => {
  console.log(`App élève   : http://localhost:${PORT}/`);
  console.log(`Démonstration : http://localhost:${PORT}/?demo=1`);
  console.log('Ctrl+C pour arrêter.');
});
