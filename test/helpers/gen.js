'use strict';

/**
 * test/helpers/gen.js — Hand-rolled property-based test generator.
 *
 * A minimal, deterministic random generator seeded with a fixed value,
 * so that failures are reproducible without any third-party library.
 */

// ---------------------------------------------------------------------------
// Seeded pseudo-random number generator (xorshift32)
// ---------------------------------------------------------------------------

let _seed = 0xdeadbeef;

/**
 * Reset the generator seed (useful for reproducible test runs).
 * @param {number} seed
 */
function setSeed(seed) {
  _seed = seed >>> 0; // force to uint32
}

/**
 * Returns a pseudo-random uint32 value.
 * @returns {number}
 */
function nextUint32() {
  _seed ^= _seed << 13;
  _seed ^= _seed >>> 17;
  _seed ^= _seed << 5;
  return _seed >>> 0;
}

/**
 * Returns a pseudo-random float in [0, 1).
 * @returns {number}
 */
function random() {
  return nextUint32() / 0x100000000;
}

/**
 * Returns a pseudo-random integer in [min, max] (inclusive).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randInt(min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

/**
 * Pick a random element from an array.
 * @template T
 * @param {T[]} arr
 * @returns {T}
 */
function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

// ---------------------------------------------------------------------------
// PackageFinding generators
// ---------------------------------------------------------------------------

const STATUSES = ['DEPRECATED', 'ABANDONED', 'STALE', 'HEALTHY', 'UNKNOWN'];
const ECOSYSTEMS = ['npm', 'pip'];
const GROUPS = ['dependencies', 'devDependencies', 'direct'];

/**
 * Generate a random PackageFinding object.
 * @returns {import('../../lib/analyze.js').PackageFinding}
 */
function genFinding() {
  const status = pick(STATUSES);
  return {
    name: `pkg-${randInt(1, 1000)}`,
    ecosystem: pick(ECOSYSTEMS),
    group: pick(GROUPS),
    status,
    evidence: `Generated evidence for ${status}`,
    lastPublished: status === 'UNKNOWN' ? null : `2024-0${randInt(1, 9)}-01T00:00:00.000Z`,
  };
}

/**
 * Generate an array of N random PackageFinding objects.
 * @param {number} n
 * @returns {import('../../lib/analyze.js').PackageFinding[]}
 */
function genFindings(n) {
  return Array.from({ length: n }, () => genFinding());
}

// ---------------------------------------------------------------------------
// requirements.txt-like string generators
// ---------------------------------------------------------------------------

const SAMPLE_PACKAGE_NAMES = [
  'requests', 'flask', 'django', 'numpy', 'pandas', 'scipy', 'pytest',
  'boto3', 'sqlalchemy', 'click', 'pydantic', 'fastapi', 'aiohttp',
];

const VERSION_SPECIFIERS = [
  '',
  '==1.0.0',
  '>=2.0',
  '<=3.0',
  '~=1.4',
  '!=1.0.0,>=0.5',
  '>1.0',
  '<2.0',
];

const EXTRAS_VARIANTS = [
  '',
  '[security]',
  '[security,socks]',
  '[extra]',
];

/**
 * Generate a single requirements.txt-like line.
 * May be a package line, comment, blank, or URL.
 * @returns {string}
 */
function genRequirementsLine() {
  const kind = randInt(0, 9);
  if (kind === 0) return ''; // blank
  if (kind === 1) return `# comment ${randInt(1, 100)}`; // comment
  if (kind === 2) return `https://example.com/pkg-${randInt(1, 100)}.tar.gz`; // URL
  if (kind === 3) return `git+https://github.com/user/repo-${randInt(1, 100)}.git`; // git URL

  const name = pick(SAMPLE_PACKAGE_NAMES);
  const extras = pick(EXTRAS_VARIANTS);
  const version = pick(VERSION_SPECIFIERS);
  const comment = randInt(0, 3) === 0 ? `  # some comment` : '';
  return `${name}${extras}${version}${comment}`;
}

/**
 * Generate a requirements.txt string with n lines.
 * @param {number} n
 * @returns {string}
 */
function genRequirementsTxt(n) {
  return Array.from({ length: n }, () => genRequirementsLine()).join('\n');
}

module.exports = {
  setSeed,
  random,
  randInt,
  pick,
  genFinding,
  genFindings,
  genRequirementsLine,
  genRequirementsTxt,
};
