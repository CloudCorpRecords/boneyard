'use strict';

/**
 * @typedef {Object} NpmRawMeta
 * @property {string} name
 * @property {string} latestVersion         - from dist-tags.latest
 * @property {string|null} deprecated       - from versions[latest].deprecated, or null
 * @property {Record<string, string>} distTags
 * @property {string} lastPublished         - ISO date string, from time[latestVersion]
 * @property {Record<string, string>} rawTime  - full time map
 */

/**
 * @typedef {Object} PypiRawMeta
 * @property {string} name
 * @property {string} latestVersion         - info.version
 * @property {boolean} yanked               - info.yanked
 * @property {string|null} yankedReason     - info.yanked_reason
 * @property {string} lastPublished         - ISO date of latest version's first file upload_time
 * @property {string[]} classifiers         - info.classifiers
 */

/**
 * @typedef {Object} RegistryError
 * @property {true} error
 * @property {string} reason
 * @property {number|null} status
 */

/**
 * Extract normalised metadata from a raw npm registry JSON document.
 * Pure function — no network I/O.
 *
 * @param {Record<string, any>} json  Parsed npm registry document
 * @returns {NpmRawMeta}
 */
function extractNpmMeta(json) {
  const distTags = json['dist-tags'] || {};
  const latestVersion = distTags.latest || '';
  const versionMeta = (json.versions || {})[latestVersion] || {};
  const rawTime = json.time || {};

  const deprecated = typeof versionMeta.deprecated === 'string' && versionMeta.deprecated.length > 0
    ? versionMeta.deprecated
    : null;

  const lastPublished = rawTime[latestVersion] || '';

  return {
    name: json.name || '',
    latestVersion,
    deprecated,
    distTags,
    lastPublished,
    rawTime,
  };
}

/**
 * Extract normalised metadata from a raw PyPI JSON document.
 * Pure function — no network I/O.
 *
 * @param {Record<string, any>} json  Parsed PyPI JSON document
 * @returns {PypiRawMeta}
 */
function extractPypiMeta(json) {
  const info = json.info || {};
  const latestVersion = info.version || '';
  const yanked = Boolean(info.yanked);
  const yankedReason = info.yanked_reason || null;
  const classifiers = Array.isArray(info.classifiers) ? info.classifiers : [];

  // Find the upload_time of the first file for the latest version
  const releases = json.releases || {};
  const latestFiles = releases[latestVersion] || [];
  let lastPublished = '';
  if (latestFiles.length > 0 && latestFiles[0].upload_time) {
    // Normalise to ISO string (PyPI gives "2023-01-15T12:34:56" without Z)
    const ts = latestFiles[0].upload_time;
    lastPublished = ts.endsWith('Z') ? ts : `${ts}Z`;
  }

  return {
    name: info.name || '',
    latestVersion,
    yanked,
    yankedReason,
    lastPublished,
    classifiers,
  };
}

/**
 * Make an HTTP request with an AbortController timeout.
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{ok: boolean, status: number, json: () => Promise<any>}>}
 */
async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Fetch and normalise metadata for an npm package.
 * Never throws; errors are returned as RegistryError values.
 *
 * @param {string} name
 * @param {{ timeout?: number }} [opts]
 * @returns {Promise<NpmRawMeta | RegistryError>}
 */
async function fetchNpm(name, opts) {
  const timeout = (opts && opts.timeout) ? opts.timeout : 10000;
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  try {
    const res = await fetchWithTimeout(url, timeout);
    if (res.status === 404) {
      return { error: true, reason: 'not found in registry', status: 404 };
    }
    if (!res.ok) {
      return { error: true, reason: `HTTP ${res.status}`, status: res.status };
    }
    let json;
    try {
      json = await res.json();
    } catch (e) {
      return { error: true, reason: 'malformed registry response', status: null };
    }
    return extractNpmMeta(json);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return { error: true, reason: 'registry unreachable', status: null };
    }
    return { error: true, reason: 'registry unreachable', status: null };
  }
}

/**
 * Fetch and normalise metadata for a PyPI package.
 * Never throws; errors are returned as RegistryError values.
 *
 * @param {string} name
 * @param {{ timeout?: number }} [opts]
 * @returns {Promise<PypiRawMeta | RegistryError>}
 */
async function fetchPypi(name, opts) {
  const timeout = (opts && opts.timeout) ? opts.timeout : 10000;
  const url = `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;
  try {
    const res = await fetchWithTimeout(url, timeout);
    if (res.status === 404) {
      return { error: true, reason: 'not found in registry', status: 404 };
    }
    if (!res.ok) {
      return { error: true, reason: `HTTP ${res.status}`, status: res.status };
    }
    let json;
    try {
      json = await res.json();
    } catch (e) {
      return { error: true, reason: 'malformed registry response', status: null };
    }
    return extractPypiMeta(json);
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return { error: true, reason: 'registry unreachable', status: null };
    }
    return { error: true, reason: 'registry unreachable', status: null };
  }
}

/**
 * Fetch metadata for multiple packages concurrently with a concurrency cap.
 *
 * @param {import('./parse.js').PackageRef[]} refs
 * @param {{ timeout?: number, concurrency?: number }} [opts]
 * @returns {Promise<Map<string, NpmRawMeta | PypiRawMeta | RegistryError>>}
 */
async function fetchAll(refs, opts) {
  const concurrency = (opts && opts.concurrency) ? opts.concurrency : 5;
  const result = new Map();

  // Simple semaphore: a counter + queue of waiting resolve callbacks
  let running = 0;
  const queue = [];

  /**
   * Acquire the semaphore (waits if at capacity).
   * @returns {Promise<void>}
   */
  function acquire() {
    if (running < concurrency) {
      running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => queue.push(resolve));
  }

  /**
   * Release the semaphore (unblocks the next waiting task).
   */
  function release() {
    if (queue.length > 0) {
      const next = queue.shift();
      next();
    } else {
      running--;
    }
  }

  const tasks = refs.map(async (ref) => {
    await acquire();
    try {
      let meta;
      if (ref.ecosystem === 'npm') {
        meta = await fetchNpm(ref.name, opts);
      } else {
        meta = await fetchPypi(ref.name, opts);
      }
      result.set(ref.name, meta);
    } finally {
      release();
    }
  });

  await Promise.all(tasks);
  return result;
}

module.exports = { extractNpmMeta, extractPypiMeta, fetchNpm, fetchPypi, fetchAll };
