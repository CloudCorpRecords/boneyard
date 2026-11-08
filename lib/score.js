'use strict';

/**
 * @typedef {Object} ScoreResult
 * @property {number} score  - Integer in [0, 100]
 * @property {Object} summary
 * @property {number} summary.total
 * @property {number} summary.deprecated
 * @property {number} summary.abandoned
 * @property {number} summary.stale
 * @property {number} summary.healthy
 * @property {number} summary.unknown
 */

/**
 * Compute the 0–100 project health score from a list of package findings.
 *
 * Scoring formula:
 *   penalty = (deprecated × 20) + (abandoned × 10) + (stale × 3) + (unknown × 2)
 *   score   = max(0, 100 − penalty), rounded to an integer
 *
 * Multipliers rationale:
 *   - 5 deprecated packages → score 0 (project is actively decomposing)
 *   - 10 abandoned packages → score 0
 *   - Stale/unknown degrade gradually without hitting zero quickly
 *
 * @param {import('./analyze.js').PackageFinding[]} findings
 * @returns {ScoreResult}
 */
function computeScore(findings) {
  let deprecated = 0;
  let abandoned = 0;
  let stale = 0;
  let healthy = 0;
  let unknown = 0;

  for (const f of findings) {
    switch (f.status) {
      case 'DEPRECATED': deprecated++; break;
      case 'ABANDONED':  abandoned++;  break;
      case 'STALE':      stale++;      break;
      case 'HEALTHY':    healthy++;    break;
      case 'UNKNOWN':    unknown++;    break;
      default: break;
    }
  }

  const penalty = (deprecated * 20) + (abandoned * 10) + (stale * 3) + (unknown * 2);
  const score = Math.max(0, Math.round(100 - penalty));

  return {
    score,
    summary: {
      total: findings.length,
      deprecated,
      abandoned,
      stale,
      healthy,
      unknown,
    },
  };
}

module.exports = { computeScore };
