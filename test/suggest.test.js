'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { applySuggestions, REPLACEMENTS } = require('../lib/suggest.js');

/**
 * Build a minimal PackageFinding for testing.
 * @param {string} name
 * @param {string} status
 * @returns {import('../lib/analyze.js').PackageFinding}
 */
function makeFinding(name, status) {
  return {
    name,
    ecosystem: 'npm',
    group: 'dependencies',
    status,
    evidence: 'test evidence',
    lastPublished: '2020-01-01T00:00:00.000Z',
  };
}

describe('applySuggestions', () => {
  it('adds suggestion for moment with status DEPRECATED', () => {
    const findings = [makeFinding('moment', 'DEPRECATED')];
    const result = applySuggestions(findings);
    assert.equal(result.length, 1);
    assert.ok(typeof result[0].suggestion === 'string', 'suggestion should be a string');
    assert.match(result[0].suggestion, /dayjs/i);
  });

  it('adds suggestion for moment with status ABANDONED', () => {
    const findings = [makeFinding('moment', 'ABANDONED')];
    const result = applySuggestions(findings);
    assert.ok(typeof result[0].suggestion === 'string');
    assert.match(result[0].suggestion, /dayjs/i);
  });

  it('does NOT add suggestion for moment with status HEALTHY', () => {
    const findings = [makeFinding('moment', 'HEALTHY')];
    const result = applySuggestions(findings);
    assert.ok(!('suggestion' in result[0]), 'suggestion key must be absent for HEALTHY');
  });

  it('does NOT add suggestion for moment with status STALE', () => {
    const findings = [makeFinding('moment', 'STALE')];
    const result = applySuggestions(findings);
    assert.ok(!('suggestion' in result[0]), 'suggestion key must be absent for STALE');
  });

  it('does NOT add suggestion for moment with status UNKNOWN', () => {
    const findings = [makeFinding('moment', 'UNKNOWN')];
    const result = applySuggestions(findings);
    assert.ok(!('suggestion' in result[0]), 'suggestion key must be absent for UNKNOWN');
  });

  it('adds suggestion for request with status DEPRECATED', () => {
    const findings = [makeFinding('request', 'DEPRECATED')];
    const result = applySuggestions(findings);
    assert.ok(typeof result[0].suggestion === 'string');
    assert.match(result[0].suggestion, /undici/i);
  });

  it('adds suggestion for node-sass with status DEPRECATED', () => {
    const findings = [makeFinding('node-sass', 'DEPRECATED')];
    const result = applySuggestions(findings);
    assert.ok(typeof result[0].suggestion === 'string');
    assert.match(result[0].suggestion, /sass/i);
  });

  it('adds suggestion for tslint with status DEPRECATED', () => {
    const findings = [makeFinding('tslint', 'DEPRECATED')];
    const result = applySuggestions(findings);
    assert.ok(typeof result[0].suggestion === 'string');
    assert.match(result[0].suggestion, /eslint/i);
  });

  it('adds suggestion for nose with status DEPRECATED', () => {
    const findings = [makeFinding('nose', 'DEPRECATED')];
    const result = applySuggestions(findings);
    assert.ok(typeof result[0].suggestion === 'string');
    assert.match(result[0].suggestion, /pytest/i);
  });

  it('does NOT add suggestion for an unknown package name', () => {
    const findings = [makeFinding('unknown-package-xyz-123', 'DEPRECATED')];
    const result = applySuggestions(findings);
    assert.ok(!('suggestion' in result[0]), 'no suggestion for unknown package');
  });

  it('does NOT add suggestion for unknown package with ABANDONED status', () => {
    const findings = [makeFinding('some-obscure-pkg', 'ABANDONED')];
    const result = applySuggestions(findings);
    assert.ok(!('suggestion' in result[0]));
  });

  it('does NOT mutate the input array', () => {
    const original = [makeFinding('moment', 'DEPRECATED')];
    const frozen = Object.freeze(original);
    // Should not throw even though array is frozen (we return a new array)
    const result = applySuggestions(frozen);
    assert.notEqual(result, original);
  });

  it('does NOT mutate the input finding objects', () => {
    const finding = makeFinding('moment', 'DEPRECATED');
    Object.freeze(finding);
    // applySuggestions must create a new object, not modify the frozen one
    let result;
    assert.doesNotThrow(() => {
      result = applySuggestions([finding]);
    });
    assert.ok(!('suggestion' in finding), 'original finding must not be mutated');
    assert.ok(typeof result[0].suggestion === 'string', 'result must have suggestion');
  });

  it('output array length === input array length', () => {
    const findings = [
      makeFinding('moment', 'DEPRECATED'),
      makeFinding('left-pad', 'DEPRECATED'),
      makeFinding('express', 'HEALTHY'),
      makeFinding('lodash', 'STALE'),
    ];
    const result = applySuggestions(findings);
    assert.equal(result.length, findings.length);
  });

  it('passes through HEALTHY findings unchanged', () => {
    const finding = makeFinding('express', 'HEALTHY');
    const result = applySuggestions([finding]);
    assert.deepEqual(result[0], finding);
  });

  it('passes through STALE findings unchanged (no suggestion even if in map)', () => {
    const finding = makeFinding('moment', 'STALE');
    const result = applySuggestions([finding]);
    assert.ok(!('suggestion' in result[0]));
    assert.deepEqual(result[0], finding);
  });

  it('handles empty findings array', () => {
    const result = applySuggestions([]);
    assert.deepEqual(result, []);
  });

  it('REPLACEMENTS map includes the four required entries', () => {
    assert.ok('moment' in REPLACEMENTS, 'moment must be in REPLACEMENTS');
    assert.ok('request' in REPLACEMENTS, 'request must be in REPLACEMENTS');
    assert.ok('node-sass' in REPLACEMENTS, 'node-sass must be in REPLACEMENTS');
    assert.ok('tslint' in REPLACEMENTS, 'tslint must be in REPLACEMENTS');
  });

  it('REPLACEMENTS map has at least 8 entries', () => {
    assert.ok(Object.keys(REPLACEMENTS).length >= 8,
      `Expected at least 8 replacements, got ${Object.keys(REPLACEMENTS).length}`);
  });

  it('suggestion strings are non-empty', () => {
    for (const [key, value] of Object.entries(REPLACEMENTS)) {
      assert.ok(typeof value === 'string' && value.length > 0,
        `REPLACEMENTS['${key}'] must be a non-empty string`);
    }
  });
});
