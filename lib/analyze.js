'use strict';

/**
 * @typedef {Object} PackageFinding
 * @property {string} name
 * @property {'npm'|'pip'} ecosystem
 * @property {'dependencies'|'devDependencies'|'direct'} group
 * @property {'DEPRECATED'|'ABANDONED'|'STALE'|'HEALTHY'|'UNKNOWN'} status
 * @property {string} evidence   - Human-readable explanation of the verdict
 * @property {string|null} lastPublished  - ISO date string or null for UNKNOWN
 * @property {string} [suggestion]        - Added by suggest.js, not here
 */

/**
 * Compute the number of whole months between two dates.
 * Uses calendar months: the difference is calculated by comparing year and month,
 * then adjusting for the day-of-month.
 *
 * @param {Date} from  Earlier date
 * @param {Date} to    Later date
 * @returns {number}   Positive integer (or 0 if from >= to)
 */
function monthsBetween(from, to) {
  const years = to.getUTCFullYear() - from.getUTCFullYear();
  const months = to.getUTCMonth() - from.getUTCMonth();
  let total = years * 12 + months;
  // Adjust if the day-of-month hasn't been reached yet
  if (to.getUTCDate() < from.getUTCDate()) {
    total -= 1;
  }
  return Math.max(0, total);
}

/**
 * Classify a single package from its registry metadata.
 *
 * Priority order (first matching rule wins):
 *  1. RegistryError → UNKNOWN
 *  2. npm deprecated field → DEPRECATED
 *  3. PyPI yanked → DEPRECATED
 *  4. PyPI "Development Status :: 7 - Inactive" classifier → DEPRECATED
 *  5. > 24 months since last release → ABANDONED
 *  6. > 12 months since last release → STALE
 *  7. Otherwise → HEALTHY
 *
 * @param {import('./parse.js').PackageRef} ref
 * @param {import('./registry.js').NpmRawMeta | import('./registry.js').PypiRawMeta | import('./registry.js').RegistryError | undefined} meta
 * @param {Date} [asOf]  Analysis date (defaults to now; injectable for tests)
 * @returns {PackageFinding}
 */
function analyzePackage(ref, meta, asOf) {
  const now = asOf instanceof Date ? asOf : new Date();

  // No metadata at all (name not in map)
  if (meta === undefined || meta === null) {
    const finding = {
      name: ref.name,
      ecosystem: ref.ecosystem,
      group: ref.group,
      status: 'UNKNOWN',
      evidence: 'No registry data available',
      lastPublished: null,
    };
    if (!(finding.evidence.length > 0)) throw new Error('evidence must be non-empty');
    return finding;
  }

  // Rule 1: RegistryError
  if (meta.error === true) {
    const finding = {
      name: ref.name,
      ecosystem: ref.ecosystem,
      group: ref.group,
      status: 'UNKNOWN',
      evidence: meta.reason || 'registry error',
      lastPublished: null,
    };
    if (!(finding.evidence.length > 0)) throw new Error('evidence must be non-empty');
    return finding;
  }

  // Rule 2: npm deprecated field
  if (typeof meta.deprecated === 'string' && meta.deprecated.length > 0) {
    const finding = {
      name: ref.name,
      ecosystem: ref.ecosystem,
      group: ref.group,
      status: 'DEPRECATED',
      evidence: meta.deprecated,
      lastPublished: meta.lastPublished || null,
    };
    if (!(finding.evidence.length > 0)) throw new Error('evidence must be non-empty');
    return finding;
  }

  // Rule 3: PyPI yanked
  if (meta.yanked === true) {
    const reason = (typeof meta.yankedReason === 'string' && meta.yankedReason.length > 0)
      ? meta.yankedReason
      : 'yanked by maintainer';
    const finding = {
      name: ref.name,
      ecosystem: ref.ecosystem,
      group: ref.group,
      status: 'DEPRECATED',
      evidence: reason,
      lastPublished: meta.lastPublished || null,
    };
    if (!(finding.evidence.length > 0)) throw new Error('evidence must be non-empty');
    return finding;
  }

  // Rule 4: PyPI "Development Status :: 7 - Inactive" classifier
  const INACTIVE_CLASSIFIER = 'Development Status :: 7 - Inactive';
  if (Array.isArray(meta.classifiers) && meta.classifiers.includes(INACTIVE_CLASSIFIER)) {
    const finding = {
      name: ref.name,
      ecosystem: ref.ecosystem,
      group: ref.group,
      status: 'DEPRECATED',
      evidence: INACTIVE_CLASSIFIER,
      lastPublished: meta.lastPublished || null,
    };
    if (!(finding.evidence.length > 0)) throw new Error('evidence must be non-empty');
    return finding;
  }

  // Rules 5-8: time-based classification
  const lastPublished = meta.lastPublished || '';
  const lastPublishedDate = lastPublished ? new Date(lastPublished) : null;

  if (!lastPublishedDate || isNaN(lastPublishedDate.getTime())) {
    const finding = {
      name: ref.name,
      ecosystem: ref.ecosystem,
      group: ref.group,
      status: 'UNKNOWN',
      evidence: 'Could not determine last publish date',
      lastPublished: null,
    };
    if (!(finding.evidence.length > 0)) throw new Error('evidence must be non-empty');
    return finding;
  }

  const months = monthsBetween(lastPublishedDate, now);

  // Rule 5: > 24 months → ABANDONED
  if (months > 24) {
    const finding = {
      name: ref.name,
      ecosystem: ref.ecosystem,
      group: ref.group,
      status: 'ABANDONED',
      evidence: `Last release ${lastPublished} (${months} months ago)`,
      lastPublished,
    };
    if (!(finding.evidence.length > 0)) throw new Error('evidence must be non-empty');
    return finding;
  }

  // Rule 6: > 12 months → STALE
  if (months > 12) {
    const finding = {
      name: ref.name,
      ecosystem: ref.ecosystem,
      group: ref.group,
      status: 'STALE',
      evidence: `Last release ${lastPublished} (${months} months ago)`,
      lastPublished,
    };
    if (!(finding.evidence.length > 0)) throw new Error('evidence must be non-empty');
    return finding;
  }

  // Rule 7: HEALTHY
  const finding = {
    name: ref.name,
    ecosystem: ref.ecosystem,
    group: ref.group,
    status: 'HEALTHY',
    evidence: `Last release ${lastPublished}`,
    lastPublished,
  };
  if (!(finding.evidence.length > 0)) throw new Error('evidence must be non-empty');
  return finding;
}

/**
 * Classify all packages from a map of registry metadata.
 *
 * @param {import('./parse.js').PackageRef[]} refs
 * @param {Map<string, import('./registry.js').NpmRawMeta | import('./registry.js').PypiRawMeta | import('./registry.js').RegistryError>} metaMap
 * @param {Date} [asOf]
 * @returns {PackageFinding[]}
 */
function analyzeAll(refs, metaMap, asOf) {
  return refs.map((ref) => analyzePackage(ref, metaMap.get(ref.name), asOf));
}

module.exports = { analyzePackage, analyzeAll, monthsBetween };
