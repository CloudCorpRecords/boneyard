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
 * Sentinel error thrown by the timeout leg of a Promise.race.
 * Caught in fetchNpm/fetchPypi and mapped to a RegistryError.
 */
class TimeoutError extends Error {
  constructor() {
    super('timeout');
    this.name = 'TimeoutError';
  }
}

/**
 * Race a promise against a timeout.
 * If the timeout fires first, the returned promise rejects with a TimeoutError.
 * No AbortSignal is used — safe for use behind env-configured proxies.
 *
 * @param {Promise<any>} promise
 * @param {number} timeoutMs
 * @returns {Promise<any>}
 */
function raceWithTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Base URL for the npm registry.
 * Can be overridden via BONEYARD_NPM_REGISTRY environment variable (for testing / mirrors).
 * Defaults to the official npm registry.
 *
 * @returns {string}
 */
function npmRegistryBase() {
  const override = (typeof process !== 'undefined' && process.env && process.env.BONEYARD_NPM_REGISTRY);
  return override ? override.replace(/\/$/, '') : 'https://registry.npmjs.org';
}

/**
 * Base URL for the PyPI registry.
 * Can be overridden via BONEYARD_PYPI_REGISTRY environment variable (for testing / mirrors).
 * Defaults to the official PyPI JSON API.
 *
 * @returns {string}
 */
function pypiRegistryBase() {
  const override = (typeof process !== 'undefined' && process.env && process.env.BONEYARD_PYPI_REGISTRY);
  return override ? override.replace(/\/$/, '') : 'https://pypi.org/pypi';
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
  const timeout = (opts && opts.timeout) ? opts.timeout : 30000;
  const url = `${npmRegistryBase()}/${encodeURIComponent(name)}`;

  /**
   * Perform the full fetch + JSON parse in one awaitable unit so that
   * raceWithTimeout covers both the network round-trip and the body read.
   * No AbortSignal is passed to fetch — this is intentional: AbortSignal
   * interacts poorly with env-configured HTTP proxies (NODE_USE_ENV_PROXY).
   *
   * @returns {Promise<NpmRawMeta | RegistryError>}
   */
  async function doFetch() {
    const res = await fetch(url);
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
  }

  try {
    return await raceWithTimeout(doFetch(), timeout);
  } catch (err) {
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
  const timeout = (opts && opts.timeout) ? opts.timeout : 30000;
  const url = `${pypiRegistryBase()}/${encodeURIComponent(name)}/json`;

  /**
   * Perform the full fetch + JSON parse in one awaitable unit so that
   * raceWithTimeout covers both the network round-trip and the body read.
   * No AbortSignal is passed to fetch — this is intentional: AbortSignal
   * interacts poorly with env-configured HTTP proxies (NODE_USE_ENV_PROXY).
   *
   * @returns {Promise<PypiRawMeta | RegistryError>}
   */
  async function doFetch() {
    const res = await fetch(url);
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
  }

  try {
    return await raceWithTimeout(doFetch(), timeout);
  } catch (err) {
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

module.exports = { extractNpmMeta, extractPypiMeta, fetchNpm, fetchPypi, fetchAll, npmRegistryBase, pypiRegistryBase };
