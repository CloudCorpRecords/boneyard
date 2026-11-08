'use strict';

/**
 * @typedef {Object} PackageRef
 * @property {string} name        - Bare package name, normalised to lowercase
 * @property {'npm'|'pip'} ecosystem
 * @property {'dependencies'|'devDependencies'|'direct'} group
 */

/**
 * A parse error thrown when the manifest cannot be parsed.
 */
class ParseError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = 'ParseError';
    this.code = 'PARSE_ERROR';
  }
}

/**
 * Parse a package.json file contents into a normalised list of PackageRef objects.
 *
 * @param {string} source  Raw contents of a package.json file
 * @returns {PackageRef[]}
 * @throws {ParseError}  If the source is not valid JSON or not a plain object at the root
 */
function parseNpm(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (err) {
    throw new ParseError(`Invalid JSON: ${err.message}`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ParseError('package.json root must be a plain object');
  }

  const deps = parsed.dependencies || {};
  const devDeps = parsed.devDependencies || {};

  /** @type {PackageRef[]} */
  const refs = [];

  for (const name of Object.keys(deps)) {
    refs.push({ name: name.toLowerCase(), ecosystem: 'npm', group: 'dependencies' });
  }

  for (const name of Object.keys(devDeps)) {
    refs.push({ name: name.toLowerCase(), ecosystem: 'npm', group: 'devDependencies' });
  }

  return refs;
}

/**
 * Parse a requirements.txt file contents into a normalised list of PackageRef objects.
 * Never throws; URL lines are added to the returned warnings array.
 *
 * @param {string} source  Raw contents of a requirements.txt file
 * @returns {{ packages: PackageRef[], warnings: string[] }}
 */
function parsePip(source) {
  const lines = source.split(/\r?\n/);

  /** @type {PackageRef[]} */
  const packages = [];

  /** @type {string[]} */
  const warnings = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip blank lines
    if (line === '') continue;

    // Skip comment lines
    if (line.startsWith('#')) continue;

    // Skip URL requirements and emit a warning
    if (line.startsWith('http://') || line.startsWith('https://') || line.startsWith('git+')) {
      warnings.push(`Skipped URL requirement: ${line}`);
      continue;
    }

    // Strip inline comments (e.g. "requests  # for HTTP")
    const withoutComment = line.split('#')[0].trim();
    if (withoutComment === '') continue;

    // Strip extras (e.g. "requests[security,socks]" -> "requests")
    const withoutExtras = withoutComment.replace(/\[.*?\]/g, '').trim();

    // Strip version specifiers: ==, >=, <=, ~=, !=, >, <
    // Also handle extras after version strip
    const name = withoutExtras.split(/[=><!~;@]/)[0].trim().toLowerCase();

    if (name === '') continue;

    packages.push({ name, ecosystem: 'pip', group: 'direct' });
  }

  return { packages, warnings };
}

module.exports = { parseNpm, parsePip, ParseError };
