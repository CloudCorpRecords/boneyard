'use strict';

/**
 * Vercel-compatible serverless handler for POST /api/analyze.
 *
 * Accepts: { "kind": "npm"|"pip", "text": "<manifest contents>" }
 * Returns: JSON report (same shape as report.toJson)
 *
 * Also used directly by server.js for local development.
 *
 * @module api/analyze
 */

const { parseNpm, parsePip, ParseError } = require('../lib/parse.js');
const { fetchAll }                        = require('../lib/registry.js');
const { analyzeAll }                      = require('../lib/analyze.js');
const { computeScore }                    = require('../lib/score.js');
const { applySuggestions }               = require('../lib/suggest.js');
const { toJson }                          = require('../lib/report.js');

/**
 * Read the full request body as a string.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    // Vercel's runtime may pre-parse the body
    if (typeof req.body === 'string') {
      resolve(req.body);
      return;
    }
    if (req.body && typeof req.body === 'object') {
      resolve(JSON.stringify(req.body));
      return;
    }

    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Send a JSON response.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {object} body
 */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Analyse a manifest and return the JSON report string.
 * Extracted as a pure async function so it can be tested without HTTP.
 *
 * @param {{ kind: 'npm'|'pip', text: string }} params
 * @returns {Promise<string>}  Serialised JSON report
 */
async function analyseManifest({ kind, text }) {
  let refs;
  let warnings = [];

  if (kind === 'npm') {
    refs = parseNpm(text);
  } else {
    const parsed = parsePip(text);
    refs = parsed.packages;
    warnings = parsed.warnings;
  }

  const metaMap = await fetchAll(refs, { timeout: 15000, concurrency: 5 });

  // Collect registry-error warnings
  for (const [name, meta] of metaMap.entries()) {
    if (meta && meta.error === true) {
      warnings.push(`${name}: ${meta.reason}`);
    }
  }

  const rawFindings = analyzeAll(refs, metaMap);
  const findings = applySuggestions(rawFindings);
  const scoreResult = computeScore(findings);

  const reportMeta = {
    manifest: '<pasted>',
    analysedAt: new Date(),
    warnings,
  };

  return toJson(findings, scoreResult, reportMeta);
}

/**
 * HTTP handler — compatible with Vercel's Node.js runtime and with node:http.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
async function handler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed', message: 'Only POST is supported' });
    return;
  }

  let body;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch (_) {
    sendJson(res, 400, { error: 'Bad Request', message: 'Request body must be valid JSON' });
    return;
  }

  // Validate fields
  const { kind, text } = body;

  if (!text || typeof text !== 'string' || text.trim() === '') {
    sendJson(res, 400, { error: 'Bad Request', message: '"text" must be a non-empty string' });
    return;
  }

  if (kind !== 'npm' && kind !== 'pip') {
    sendJson(res, 400, { error: 'Bad Request', message: '"kind" must be "npm" or "pip"' });
    return;
  }

  try {
    const report = await analyseManifest({ kind, text });
    // report is already a JSON string; write it directly
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(report),
    });
    res.end(report);
  } catch (err) {
    if (err instanceof ParseError) {
      sendJson(res, 400, { error: 'Parse Error', message: err.message });
      return;
    }
    // Don't leak stack traces
    sendJson(res, 500, { error: 'Internal Server Error', message: 'Analysis failed. Please try again.' });
  }
}

module.exports = handler;
module.exports.handler = handler;
module.exports.analyseManifest = analyseManifest;
