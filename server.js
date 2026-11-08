'use strict';

/**
 * Boneyard local development server.
 *
 * - Serves static files from public/ with correct Content-Type headers.
 * - Routes POST /api/analyze to the api/analyze.js handler.
 * - Returns 404 for unknown paths.
 *
 * Usage:
 *   node server.js
 *   PORT=8080 node server.js
 */

const http = require('node:http');
const fs   = require('node:fs');
const path = require('node:path');

const { handler: apiHandler } = require('./api/analyze.js');

const PORT    = Number(process.env.PORT) || 3000;
const PUBLIC  = path.join(__dirname, 'public');

/** MIME types for static files */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

/**
 * Serve a static file from public/.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} urlPath
 */
function serveStatic(req, res, urlPath) {
  // Normalise: "/" → "/index.html"
  const filePath = urlPath === '/' ? '/index.html' : urlPath;

  // Prevent directory traversal
  const resolved = path.resolve(PUBLIC, '.' + filePath);
  if (!resolved.startsWith(PUBLIC + path.sep) && resolved !== PUBLIC) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(resolved, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
      return;
    }

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': data.length,
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  // Strip query string for routing
  const urlPath = url.split('?')[0];

  // Route POST /api/analyze to the API handler
  if (urlPath === '/api/analyze') {
    try {
      await apiHandler(req, res);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      }
    }
    return;
  }

  // Everything else: serve static files from public/
  serveStatic(req, res, urlPath);
});

server.listen(PORT, () => {
  process.stderr.write(`Boneyard server listening on http://localhost:${PORT}\n`);
});

module.exports = server; // exported for testability
