'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { analyzePackage, analyzeAll } = require('../lib/analyze.js');

// Fixed analysis date for deterministic tests
const AS_OF = new Date('2026-11-08');

/**
 * Build a minimal PackageRef for testing.
 * @param {string} name
 * @param {'npm'|'pip'} [ecosystem]
 * @returns {import('../lib/parse.js').PackageRef}
 */
function ref(name, ecosystem = 'npm') {
  return { name, ecosystem, group: ecosystem === 'npm' ? 'dependencies' : 'direct' };
}

/**
 * Build a minimal NpmRawMeta object.
 * @param {Partial<import('../lib/registry.js').NpmRawMeta>} overrides
 * @returns {import('../lib/registry.js').NpmRawMeta}
 */
function npmMeta(overrides) {
  return Object.assign({
    name: 'test-pkg',
    latestVersion: '1.0.0',
    deprecated: null,
    distTags: { latest: '1.0.0' },
    lastPublished: '2026-09-01T00:00:00.000Z',
    rawTime: {},
  }, overrides);
}

/**
 * Build a minimal PypiRawMeta object.
 * @param {Partial<import('../lib/registry.js').PypiRawMeta>} overrides
 * @returns {import('../lib/registry.js').PypiRawMeta}
 */
function pypiMeta(overrides) {
  return Object.assign({
    name: 'test-pkg',
    latestVersion: '1.0.0',
    yanked: false,
    yankedReason: null,
    lastPublished: '2026-09-01T00:00:00.000Z',
    classifiers: [],
  }, overrides);
}

/**
 * Build a RegistryError.
 * @param {string} [reason]
 * @returns {import('../lib/registry.js').RegistryError}
 */
function registryError(reason = 'registry unreachable') {
  return { error: true, reason, status: null };
}

// ---------------------------------------------------------------------------
// DEPRECATED tests
// ---------------------------------------------------------------------------

describe('analyzePackage: DEPRECATED', () => {
  it('npm package with deprecated message → status DEPRECATED, evidence contains message', () => {
    const meta = npmMeta({ deprecated: 'Use X instead' });
    const finding = analyzePackage(ref('test-pkg'), meta, AS_OF);
    assert.equal(finding.status, 'DEPRECATED');
    assert.ok(finding.evidence.includes('Use X instead'));
  });

  it('npm package with deprecated message → evidence IS the deprecated message', () => {
    const msg = 'request has been deprecated, see https://github.com/request/request/issues/3142';
    const meta = npmMeta({ deprecated: msg });
    const finding = analyzePackage(ref('request'), meta, AS_OF);
    assert.equal(finding.status, 'DEPRECATED');
    assert.equal(finding.evidence, msg);
  });

  it('PyPI package with yanked=true → status DEPRECATED', () => {
    const meta = pypiMeta({ yanked: true, yankedReason: 'Security vulnerability' });
    const finding = analyzePackage(ref('some-pkg', 'pip'), meta, AS_OF);
    assert.equal(finding.status, 'DEPRECATED');
    assert.ok(finding.evidence.includes('Security vulnerability'));
  });

  it('PyPI package with yanked=true and no reason → evidence = "yanked by maintainer"', () => {
    const meta = pypiMeta({ yanked: true, yankedReason: null });
    const finding = analyzePackage(ref('some-pkg', 'pip'), meta, AS_OF);
    assert.equal(finding.status, 'DEPRECATED');
    assert.ok(finding.evidence.includes('yanked by maintainer'));
  });

  it('PyPI package with "Development Status :: 7 - Inactive" classifier → DEPRECATED', () => {
    const meta = pypiMeta({
      classifiers: ['Development Status :: 7 - Inactive', 'Programming Language :: Python'],
    });
    const finding = analyzePackage(ref('inactive-pkg', 'pip'), meta, AS_OF);
    assert.equal(finding.status, 'DEPRECATED');
    assert.ok(finding.evidence.includes('Development Status :: 7 - Inactive'));
  });

  it('npm deprecated takes priority over time-based classification', () => {
    // Even though last published is recent, deprecated wins
    const meta = npmMeta({
      deprecated: 'Old package',
      lastPublished: '2026-10-01T00:00:00.000Z',
    });
    const finding = analyzePackage(ref('old-pkg'), meta, AS_OF);
    assert.equal(finding.status, 'DEPRECATED');
  });
});

// ---------------------------------------------------------------------------
// ABANDONED tests
// ---------------------------------------------------------------------------

describe('analyzePackage: ABANDONED', () => {
  it('last published 36 months ago → status ABANDONED', () => {
    // 36 months before 2026-11-08 = 2023-11-08
    const meta = npmMeta({ lastPublished: '2023-11-08T00:00:00.000Z' });
    const finding = analyzePackage(ref('old-pkg'), meta, AS_OF);
    assert.equal(finding.status, 'ABANDONED');
    assert.ok(finding.evidence.includes('2023-11-08'));
  });

  it('last published exactly 25 months ago → status ABANDONED', () => {
    // 25 months before 2026-11-08 = 2024-10-08
    const meta = npmMeta({ lastPublished: '2024-10-08T00:00:00.000Z' });
    const finding = analyzePackage(ref('old-pkg'), meta, AS_OF);
    assert.equal(finding.status, 'ABANDONED');
    assert.equal(finding.evidence.includes('25 months ago'), true);
  });

  it('last published exactly 25 months → evidence contains month count', () => {
    const meta = npmMeta({ lastPublished: '2024-10-08T00:00:00.000Z' });
    const finding = analyzePackage(ref('old-pkg'), meta, AS_OF);
    assert.ok(finding.evidence.includes('months ago'));
  });
});

// ---------------------------------------------------------------------------
// Boundary at 24 months
// ---------------------------------------------------------------------------

describe('analyzePackage: 24-month boundary', () => {
  it('last published exactly 24 months ago → NOT ABANDONED (boundary: > 24 exclusive)', () => {
    // Exactly 24 months before 2026-11-08 = 2024-11-08
    const meta = npmMeta({ lastPublished: '2024-11-08T00:00:00.000Z' });
    const finding = analyzePackage(ref('border-pkg'), meta, AS_OF);
    // 24 is NOT > 24, so should be STALE (24 > 12)
    assert.equal(finding.status, 'STALE');
  });

  it('last published 25 months ago (one full month past threshold) → ABANDONED', () => {
    // 25 months before 2026-11-08 = 2024-10-08
    const meta = npmMeta({ lastPublished: '2024-10-08T00:00:00.000Z' });
    const finding = analyzePackage(ref('border-pkg'), meta, AS_OF);
    assert.equal(finding.status, 'ABANDONED');
  });
});

// ---------------------------------------------------------------------------
// STALE tests
// ---------------------------------------------------------------------------

describe('analyzePackage: STALE', () => {
  it('last published 18 months ago → status STALE', () => {
    // 18 months before 2026-11-08 = 2025-05-08
    const meta = npmMeta({ lastPublished: '2025-05-08T00:00:00.000Z' });
    const finding = analyzePackage(ref('stale-pkg'), meta, AS_OF);
    assert.equal(finding.status, 'STALE');
    assert.ok(finding.evidence.includes('months ago'));
  });

  it('last published exactly 24 months ago → STALE (boundary check)', () => {
    const meta = npmMeta({ lastPublished: '2024-11-08T00:00:00.000Z' });
    const finding = analyzePackage(ref('stale-pkg'), meta, AS_OF);
    assert.equal(finding.status, 'STALE');
  });

  it('last published 13 months ago → STALE', () => {
    // 13 months before 2026-11-08 = 2025-10-08
    const meta = npmMeta({ lastPublished: '2025-10-08T00:00:00.000Z' });
    const finding = analyzePackage(ref('stale-pkg'), meta, AS_OF);
    assert.equal(finding.status, 'STALE');
  });
});

// ---------------------------------------------------------------------------
// Boundary at 12 months
// ---------------------------------------------------------------------------

describe('analyzePackage: 12-month boundary', () => {
  it('last published exactly 12 months ago → HEALTHY (boundary: > 12 exclusive)', () => {
    // Exactly 12 months before 2026-11-08 = 2025-11-08
    const meta = npmMeta({ lastPublished: '2025-11-08T00:00:00.000Z' });
    const finding = analyzePackage(ref('healthy-pkg'), meta, AS_OF);
    // 12 is NOT > 12, so HEALTHY
    assert.equal(finding.status, 'HEALTHY');
  });

  it('last published 13 months ago → STALE', () => {
    // 13 months before 2026-11-08 = 2025-10-08
    const meta = npmMeta({ lastPublished: '2025-10-08T00:00:00.000Z' });
    const finding = analyzePackage(ref('stale-pkg'), meta, AS_OF);
    assert.equal(finding.status, 'STALE');
  });
});

// ---------------------------------------------------------------------------
// HEALTHY tests
// ---------------------------------------------------------------------------

describe('analyzePackage: HEALTHY', () => {
  it('last published 6 months ago → status HEALTHY', () => {
    // 6 months before 2026-11-08 = 2026-05-08
    const meta = npmMeta({ lastPublished: '2026-05-08T00:00:00.000Z' });
    const finding = analyzePackage(ref('healthy-pkg'), meta, AS_OF);
    assert.equal(finding.status, 'HEALTHY');
    assert.ok(finding.evidence.includes('2026-05-08'));
  });

  it('HEALTHY finding has non-null lastPublished', () => {
    const meta = npmMeta({ lastPublished: '2026-09-01T00:00:00.000Z' });
    const finding = analyzePackage(ref('healthy-pkg'), meta, AS_OF);
    assert.equal(finding.status, 'HEALTHY');
    assert.notEqual(finding.lastPublished, null);
  });
});

// ---------------------------------------------------------------------------
// UNKNOWN tests
// ---------------------------------------------------------------------------

describe('analyzePackage: UNKNOWN', () => {
  it('RegistryError input → status UNKNOWN, evidence = error reason', () => {
    const finding = analyzePackage(ref('missing-pkg'), registryError('not found in registry'), AS_OF);
    assert.equal(finding.status, 'UNKNOWN');
    assert.equal(finding.evidence, 'not found in registry');
  });

  it('RegistryError "registry unreachable" → UNKNOWN with evidence', () => {
    const finding = analyzePackage(ref('unreachable-pkg'), registryError('registry unreachable'), AS_OF);
    assert.equal(finding.status, 'UNKNOWN');
    assert.ok(finding.evidence.length > 0);
  });

  it('undefined meta → UNKNOWN', () => {
    const finding = analyzePackage(ref('no-meta-pkg'), undefined, AS_OF);
    assert.equal(finding.status, 'UNKNOWN');
    assert.ok(finding.evidence.length > 0);
  });

  it('UNKNOWN finding has null lastPublished', () => {
    const finding = analyzePackage(ref('missing-pkg'), registryError(), AS_OF);
    assert.equal(finding.status, 'UNKNOWN');
    assert.equal(finding.lastPublished, null);
  });
});

// ---------------------------------------------------------------------------
// PackageFinding shape invariants
// ---------------------------------------------------------------------------

describe('analyzePackage: output shape', () => {
  it('finding has all required fields', () => {
    const meta = npmMeta({ lastPublished: '2026-09-01T00:00:00.000Z' });
    const finding = analyzePackage(ref('test-pkg'), meta, AS_OF);
    assert.ok('name' in finding);
    assert.ok('ecosystem' in finding);
    assert.ok('group' in finding);
    assert.ok('status' in finding);
    assert.ok('evidence' in finding);
    assert.ok('lastPublished' in finding);
  });

  it('finding.ecosystem matches input ref.ecosystem', () => {
    const pipRef = ref('requests', 'pip');
    const meta = pypiMeta({ lastPublished: '2026-09-01T00:00:00.000Z' });
    const finding = analyzePackage(pipRef, meta, AS_OF);
    assert.equal(finding.ecosystem, 'pip');
  });

  it('finding.name matches input ref.name', () => {
    const meta = npmMeta();
    const finding = analyzePackage(ref('lodash'), meta, AS_OF);
    assert.equal(finding.name, 'lodash');
  });

  it('evidence is always a non-empty string for any status', () => {
    const metas = [
      [ref('d'), npmMeta({ deprecated: 'deprecated' })],
      [ref('a'), npmMeta({ lastPublished: '2020-01-01T00:00:00.000Z' })],
      [ref('s'), npmMeta({ lastPublished: '2025-06-01T00:00:00.000Z' })],
      [ref('h'), npmMeta({ lastPublished: '2026-09-01T00:00:00.000Z' })],
      [ref('u'), registryError()],
    ];
    for (const [r, m] of metas) {
      const finding = analyzePackage(r, m, AS_OF);
      assert.ok(finding.evidence.length > 0,
        `evidence must be non-empty for status ${finding.status}`);
    }
  });
});

// ---------------------------------------------------------------------------
// analyzeAll
// ---------------------------------------------------------------------------

describe('analyzeAll', () => {
  it('returns one finding per ref in the same order', () => {
    const refs = [ref('express'), ref('lodash'), ref('moment')];
    const metaMap = new Map([
      ['express', npmMeta({ name: 'express', lastPublished: '2026-10-01T00:00:00.000Z' })],
      ['lodash', npmMeta({ name: 'lodash', lastPublished: '2024-01-01T00:00:00.000Z' })],
      ['moment', npmMeta({ name: 'moment', deprecated: 'Use dayjs instead' })],
    ]);
    const findings = analyzeAll(refs, metaMap, AS_OF);
    assert.equal(findings.length, 3);
    assert.equal(findings[0].name, 'express');
    assert.equal(findings[1].name, 'lodash');
    assert.equal(findings[2].name, 'moment');
    assert.equal(findings[2].status, 'DEPRECATED');
  });

  it('packages missing from metaMap → UNKNOWN', () => {
    const refs = [ref('missing-pkg')];
    const metaMap = new Map(); // empty
    const findings = analyzeAll(refs, metaMap, AS_OF);
    assert.equal(findings[0].status, 'UNKNOWN');
  });
});

// ---------------------------------------------------------------------------
// Property-based: evidence is always non-empty
// ---------------------------------------------------------------------------

describe('property: evidence always non-empty', () => {
  const statuses = ['DEPRECATED', 'ABANDONED', 'STALE', 'HEALTHY', 'UNKNOWN'];

  // Generate synthetic findings covering all statuses
  const syntheticMetas = [
    { meta: npmMeta({ deprecated: 'Use other' }), expectedStatus: 'DEPRECATED' },
    { meta: npmMeta({ lastPublished: '2020-01-01T00:00:00.000Z' }), expectedStatus: 'ABANDONED' },
    { meta: npmMeta({ lastPublished: '2025-06-01T00:00:00.000Z' }), expectedStatus: 'STALE' },
    { meta: npmMeta({ lastPublished: '2026-09-01T00:00:00.000Z' }), expectedStatus: 'HEALTHY' },
    { meta: registryError('not found in registry'), expectedStatus: 'UNKNOWN' },
    { meta: pypiMeta({ yanked: true }), expectedStatus: 'DEPRECATED' },
    { meta: pypiMeta({ classifiers: ['Development Status :: 7 - Inactive'] }), expectedStatus: 'DEPRECATED' },
  ];

  for (const { meta, expectedStatus } of syntheticMetas) {
    it(`finding with status ${expectedStatus} has non-empty evidence`, () => {
      const finding = analyzePackage(ref('pkg', meta.classifiers !== undefined ? 'pip' : 'npm'), meta, AS_OF);
      assert.equal(finding.status, expectedStatus);
      assert.ok(typeof finding.evidence === 'string' && finding.evidence.length > 0,
        `evidence must be a non-empty string, got: ${JSON.stringify(finding.evidence)}`);
    });
  }
});
