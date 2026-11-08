'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { toJson, toText } = require('../lib/report.js');

/** Fixed analysis date for deterministic output */
const ANALYSIS_DATE = new Date('2026-11-08T12:00:00.000Z');

/**
 * Build a minimal PackageFinding.
 * @param {Partial<import('../lib/analyze.js').PackageFinding>} overrides
 * @returns {import('../lib/analyze.js').PackageFinding}
 */
function makeFinding(overrides) {
  return Object.assign({
    name: 'test-pkg',
    ecosystem: 'npm',
    group: 'dependencies',
    status: 'HEALTHY',
    evidence: 'Last release 2026-01-01T00:00:00.000Z',
    lastPublished: '2026-01-01T00:00:00.000Z',
  }, overrides);
}

/**
 * Build a minimal ScoreResult.
 * @param {number} score
 * @param {Partial<import('../lib/score.js').ScoreResult['summary']>} summaryOverrides
 * @returns {import('../lib/score.js').ScoreResult}
 */
function makeScore(score, summaryOverrides) {
  return {
    score,
    summary: Object.assign({
      total: 1,
      deprecated: 0,
      abandoned: 0,
      stale: 0,
      healthy: 1,
      unknown: 0,
    }, summaryOverrides),
  };
}

const DEFAULT_META = {
  manifest: 'package.json',
  analysedAt: ANALYSIS_DATE,
};

// ─── toJson ───────────────────────────────────────────────────────────────────

describe('toJson', () => {
  it('produces valid JSON', () => {
    const result = toJson([makeFinding({})], makeScore(100), DEFAULT_META);
    assert.doesNotThrow(() => JSON.parse(result));
  });

  it('includes all required top-level keys', () => {
    const result = JSON.parse(toJson([makeFinding({})], makeScore(100), DEFAULT_META));
    assert.ok('analysedAt' in result);
    assert.ok('manifest' in result);
    assert.ok('score' in result);
    assert.ok('summary' in result);
    assert.ok('findings' in result);
  });

  it('findings array length matches input', () => {
    const findings = [
      makeFinding({ name: 'a' }),
      makeFinding({ name: 'b' }),
      makeFinding({ name: 'c' }),
    ];
    const result = JSON.parse(toJson(findings, makeScore(100, { total: 3, healthy: 3 }), DEFAULT_META));
    assert.equal(result.findings.length, 3);
  });

  it('with empty findings: findings is [] and score is 100', () => {
    const result = JSON.parse(toJson([], makeScore(100, { total: 0, healthy: 0 }), DEFAULT_META));
    assert.deepEqual(result.findings, []);
    assert.equal(result.score, 100);
  });

  it('includes warnings array when non-empty', () => {
    const meta = { ...DEFAULT_META, warnings: ['Skipped URL: https://example.com'] };
    const result = JSON.parse(toJson([], makeScore(100, { total: 0, healthy: 0 }), meta));
    assert.ok(Array.isArray(result.warnings));
    assert.equal(result.warnings.length, 1);
  });

  it('omits warnings key when warnings array is empty', () => {
    const meta = { ...DEFAULT_META, warnings: [] };
    const result = JSON.parse(toJson([], makeScore(100, { total: 0, healthy: 0 }), meta));
    assert.ok(!('warnings' in result), 'warnings key must be absent when empty');
  });

  it('omits warnings key when warnings is not provided', () => {
    const result = JSON.parse(toJson([], makeScore(100, { total: 0, healthy: 0 }), DEFAULT_META));
    assert.ok(!('warnings' in result));
  });

  it('analysedAt is an ISO 8601 string', () => {
    const result = JSON.parse(toJson([], makeScore(100, { total: 0, healthy: 0 }), DEFAULT_META));
    assert.ok(typeof result.analysedAt === 'string');
    assert.ok(!isNaN(new Date(result.analysedAt).getTime()));
  });

  it('manifest matches meta.manifest', () => {
    const result = JSON.parse(toJson([], makeScore(100, { total: 0, healthy: 0 }), {
      ...DEFAULT_META,
      manifest: 'my-project/requirements.txt',
    }));
    assert.equal(result.manifest, 'my-project/requirements.txt');
  });

  it('finding with suggestion includes suggestion field', () => {
    const finding = makeFinding({ status: 'DEPRECATED', suggestion: 'dayjs' });
    const result = JSON.parse(toJson([finding], makeScore(80, { total: 1, deprecated: 1, healthy: 0 }), DEFAULT_META));
    assert.equal(result.findings[0].suggestion, 'dayjs');
  });

  it('finding without suggestion omits suggestion field', () => {
    const finding = makeFinding({ status: 'HEALTHY' });
    const result = JSON.parse(toJson([finding], makeScore(100), DEFAULT_META));
    assert.ok(!('suggestion' in result.findings[0]));
  });

  it('score value is correct', () => {
    const result = JSON.parse(toJson(
      [makeFinding({ status: 'DEPRECATED' })],
      makeScore(80, { total: 1, deprecated: 1, healthy: 0 }),
      DEFAULT_META
    ));
    assert.equal(result.score, 80);
  });

  it('summary values are correct', () => {
    const summary = { total: 2, deprecated: 1, abandoned: 0, stale: 0, healthy: 1, unknown: 0 };
    const result = JSON.parse(toJson(
      [makeFinding({ status: 'DEPRECATED' }), makeFinding({ name: 'b' })],
      { score: 80, summary },
      DEFAULT_META
    ));
    assert.deepEqual(result.summary, summary);
  });
});

// ─── toText ───────────────────────────────────────────────────────────────────

describe('toText', () => {
  it('contains Health Score line', () => {
    const result = toText(
      [makeFinding({ status: 'DEPRECATED' })],
      makeScore(80, { total: 1, deprecated: 1, healthy: 0 }),
      DEFAULT_META
    );
    assert.match(result, /Health Score: 80\/100/);
  });

  it('health score format is correct', () => {
    const result = toText([], makeScore(100, { total: 0, healthy: 0 }), DEFAULT_META);
    assert.match(result, /Health Score: 100\/100/);
  });

  it('DEPRECATED section appears before HEALTHY', () => {
    const findings = [
      makeFinding({ name: 'healthy-pkg', status: 'HEALTHY' }),
      makeFinding({ name: 'dead-pkg', status: 'DEPRECATED' }),
    ];
    const result = toText(
      findings,
      makeScore(80, { total: 2, deprecated: 1, healthy: 1 }),
      DEFAULT_META
    );
    const depIdx = result.indexOf('DEPRECATED');
    const healthyIdx = result.indexOf('HEALTHY');
    assert.ok(depIdx < healthyIdx, 'DEPRECATED must appear before HEALTHY in output');
  });

  it('includes suggestion line with → Consider: prefix', () => {
    const finding = makeFinding({
      name: 'moment',
      status: 'DEPRECATED',
      suggestion: 'dayjs (or date-fns)',
    });
    const result = toText(
      [finding],
      makeScore(80, { total: 1, deprecated: 1, healthy: 0 }),
      DEFAULT_META
    );
    assert.match(result, /→ Consider: dayjs/);
  });

  it('does not include → Consider: line when no suggestion', () => {
    const finding = makeFinding({ name: 'some-lib', status: 'DEPRECATED' });
    const result = toText(
      [finding],
      makeScore(80, { total: 1, deprecated: 1, healthy: 0 }),
      DEFAULT_META
    );
    assert.ok(!result.includes('→ Consider:'), 'should not have suggestion line');
  });

  it('includes [WARN] lines when warnings are present', () => {
    const meta = { ...DEFAULT_META, warnings: ['Skipped URL: https://example.com'] };
    const result = toText([], makeScore(100, { total: 0, healthy: 0 }), meta);
    assert.match(result, /\[WARN\]/);
    assert.match(result, /Skipped URL/);
  });

  it('includes multiple [WARN] lines for multiple warnings', () => {
    const meta = { ...DEFAULT_META, warnings: ['warn 1', 'warn 2'] };
    const result = toText([], makeScore(100, { total: 0, healthy: 0 }), meta);
    const warnCount = (result.match(/\[WARN\]/g) || []).length;
    assert.equal(warnCount, 2);
  });

  it('does not include [WARN] when no warnings', () => {
    const result = toText([makeFinding({})], makeScore(100), DEFAULT_META);
    assert.ok(!result.includes('[WARN]'));
  });

  it('contains Summary: footer', () => {
    const result = toText([], makeScore(100, { total: 0, healthy: 0 }), DEFAULT_META);
    assert.match(result, /Summary:/);
  });

  it('footer summary contains correct counts', () => {
    const findings = [
      makeFinding({ name: 'dep', status: 'DEPRECATED' }),
      makeFinding({ name: 'ok', status: 'HEALTHY' }),
    ];
    const score = makeScore(80, { total: 2, deprecated: 1, healthy: 1 });
    const result = toText(findings, score, DEFAULT_META);
    assert.match(result, /1 deprecated/);
    assert.match(result, /1 healthy/);
    assert.match(result, /2 packages/);
  });

  it('includes manifest name in header', () => {
    const result = toText([], makeScore(100, { total: 0, healthy: 0 }), {
      ...DEFAULT_META,
      manifest: 'requirements.txt',
    });
    assert.match(result, /requirements\.txt/);
  });

  it('groups ABANDONED before STALE before HEALTHY', () => {
    const findings = [
      makeFinding({ name: 'h', status: 'HEALTHY' }),
      makeFinding({ name: 's', status: 'STALE' }),
      makeFinding({ name: 'a', status: 'ABANDONED' }),
    ];
    const score = { score: 87, summary: { total: 3, deprecated: 0, abandoned: 1, stale: 1, healthy: 1, unknown: 0 } };
    const result = toText(findings, score, DEFAULT_META);
    const abanIdx = result.indexOf('ABANDONED');
    const staleIdx = result.indexOf('STALE');
    const healthIdx = result.indexOf('HEALTHY');
    assert.ok(abanIdx < staleIdx, 'ABANDONED before STALE');
    assert.ok(staleIdx < healthIdx, 'STALE before HEALTHY');
  });

  it('shows evidence string for each finding', () => {
    const finding = makeFinding({
      status: 'DEPRECATED',
      evidence: 'deprecated: use new-pkg instead',
    });
    const result = toText([finding], makeScore(80, { total: 1, deprecated: 1, healthy: 0 }), DEFAULT_META);
    assert.match(result, /deprecated: use new-pkg instead/);
  });

  it('returns a string ending with a newline', () => {
    const result = toText([], makeScore(100, { total: 0, healthy: 0 }), DEFAULT_META);
    assert.ok(result.endsWith('\n'));
  });
});
