'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeScore } = require('../lib/score.js');

/**
 * Build a minimal PackageFinding for scoring tests.
 * @param {'DEPRECATED'|'ABANDONED'|'STALE'|'HEALTHY'|'UNKNOWN'} status
 * @param {string} [name]
 * @returns {import('../lib/analyze.js').PackageFinding}
 */
function finding(status, name = 'pkg') {
  return {
    name,
    ecosystem: 'npm',
    group: 'dependencies',
    status,
    evidence: `Test finding with status ${status}`,
    lastPublished: status === 'UNKNOWN' ? null : '2026-01-01T00:00:00.000Z',
  };
}

/**
 * Build an array of N findings with a given status.
 * @param {'DEPRECATED'|'ABANDONED'|'STALE'|'HEALTHY'|'UNKNOWN'} status
 * @param {number} count
 * @returns {import('../lib/analyze.js').PackageFinding[]}
 */
function findings(status, count) {
  return Array.from({ length: count }, (_, i) => finding(status, `${status.toLowerCase()}-${i}`));
}

// ---------------------------------------------------------------------------
// Fixed score cases
// ---------------------------------------------------------------------------

describe('computeScore: fixed cases', () => {
  it('empty findings → score 100', () => {
    const result = computeScore([]);
    assert.equal(result.score, 100);
    assert.equal(result.summary.total, 0);
    assert.equal(result.summary.deprecated, 0);
    assert.equal(result.summary.abandoned, 0);
    assert.equal(result.summary.stale, 0);
    assert.equal(result.summary.healthy, 0);
    assert.equal(result.summary.unknown, 0);
  });

  it('all healthy packages → score 100', () => {
    const result = computeScore(findings('HEALTHY', 5));
    assert.equal(result.score, 100);
    assert.equal(result.summary.healthy, 5);
    assert.equal(result.summary.total, 5);
  });

  it('1 deprecated → score 80 (penalty = 20)', () => {
    const result = computeScore(findings('DEPRECATED', 1));
    assert.equal(result.score, 80);
    assert.equal(result.summary.deprecated, 1);
  });

  it('5 deprecated → score 0 (penalty = 100, clamped to 0)', () => {
    const result = computeScore(findings('DEPRECATED', 5));
    assert.equal(result.score, 0);
    assert.equal(result.summary.deprecated, 5);
  });

  it('6 deprecated → score 0 (penalty > 100, still clamped to 0)', () => {
    const result = computeScore(findings('DEPRECATED', 6));
    assert.equal(result.score, 0);
  });

  it('1 abandoned → score 90 (penalty = 10)', () => {
    const result = computeScore(findings('ABANDONED', 1));
    assert.equal(result.score, 90);
    assert.equal(result.summary.abandoned, 1);
  });

  it('10 abandoned → score 0 (penalty = 100)', () => {
    const result = computeScore(findings('ABANDONED', 10));
    assert.equal(result.score, 0);
    assert.equal(result.summary.abandoned, 10);
  });

  it('1 stale → score 97 (penalty = 3)', () => {
    const result = computeScore(findings('STALE', 1));
    assert.equal(result.score, 97);
    assert.equal(result.summary.stale, 1);
  });

  it('1 unknown → score 98 (penalty = 2)', () => {
    const result = computeScore(findings('UNKNOWN', 1));
    assert.equal(result.score, 98);
    assert.equal(result.summary.unknown, 1);
  });

  it('mixed: 2 deprecated + 1 abandoned + 3 stale → score 41', () => {
    // penalty = (2*20) + (1*10) + (3*3) = 40 + 10 + 9 = 59
    // score = 100 - 59 = 41
    const allFindings = [
      ...findings('DEPRECATED', 2),
      ...findings('ABANDONED', 1),
      ...findings('STALE', 3),
    ];
    const result = computeScore(allFindings);
    assert.equal(result.score, 41);
    assert.equal(result.summary.deprecated, 2);
    assert.equal(result.summary.abandoned, 1);
    assert.equal(result.summary.stale, 3);
    assert.equal(result.summary.total, 6);
  });

  it('mixed: deprecated + healthy does not let healthy offset deprecated', () => {
    const allFindings = [
      finding('DEPRECATED', 'moment'),
      ...findings('HEALTHY', 10),
    ];
    const result = computeScore(allFindings);
    assert.equal(result.score, 80);
  });

  it('summary.total matches findings.length', () => {
    const allFindings = [
      ...findings('DEPRECATED', 2),
      ...findings('HEALTHY', 3),
      ...findings('STALE', 1),
    ];
    const result = computeScore(allFindings);
    assert.equal(result.summary.total, 6);
  });

  it('score is always an integer', () => {
    const allFindings = [...findings('STALE', 1)]; // penalty = 3, score = 97 (integer)
    const result = computeScore(allFindings);
    assert.equal(result.score, Math.floor(result.score), 'score must be an integer');
  });
});

// ---------------------------------------------------------------------------
// ScoreResult shape
// ---------------------------------------------------------------------------

describe('computeScore: result shape', () => {
  it('result has score and summary fields', () => {
    const result = computeScore([]);
    assert.ok('score' in result);
    assert.ok('summary' in result);
    assert.ok('total' in result.summary);
    assert.ok('deprecated' in result.summary);
    assert.ok('abandoned' in result.summary);
    assert.ok('stale' in result.summary);
    assert.ok('healthy' in result.summary);
    assert.ok('unknown' in result.summary);
  });

  it('summary counts sum to total', () => {
    const allFindings = [
      ...findings('DEPRECATED', 1),
      ...findings('ABANDONED', 2),
      ...findings('STALE', 3),
      ...findings('HEALTHY', 4),
      ...findings('UNKNOWN', 5),
    ];
    const result = computeScore(allFindings);
    const { deprecated, abandoned, stale, healthy, unknown, total } = result.summary;
    assert.equal(deprecated + abandoned + stale + healthy + unknown, total);
  });
});
