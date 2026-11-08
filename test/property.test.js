'use strict';

/**
 * Property-based tests for Boneyard using a hand-rolled generator.
 * All generators are deterministic (seeded) so test failures are reproducible.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parsePip } = require('../lib/parse.js');
const { computeScore } = require('../lib/score.js');
const gen = require('./helpers/gen.js');

// Fixed seed for determinism
const SEED = 0xcafebabe;
const ITERATIONS = 100;

// ---------------------------------------------------------------------------
// Scorer invariants
// ---------------------------------------------------------------------------

describe('property: scorer invariants', () => {
  it('computeScore([]).score === 100 (always)', () => {
    assert.equal(computeScore([]).score, 100);
  });

  it('score is always in [0, 100] for random findings', () => {
    gen.setSeed(SEED);
    for (let i = 0; i < ITERATIONS; i++) {
      const n = gen.randInt(0, 20);
      const findings = gen.genFindings(n);
      const { score } = computeScore(findings);
      assert.ok(score >= 0 && score <= 100,
        `score ${score} is outside [0, 100] for findings: ${JSON.stringify(findings.map(f => f.status))}`);
    }
  });

  it('score is always an integer', () => {
    gen.setSeed(SEED + 1);
    for (let i = 0; i < ITERATIONS; i++) {
      const n = gen.randInt(0, 20);
      const findings = gen.genFindings(n);
      const { score } = computeScore(findings);
      assert.equal(score, Math.floor(score),
        `score ${score} must be an integer`);
    }
  });

  it('adding a non-HEALTHY finding to a list never increases the score', () => {
    gen.setSeed(SEED + 2);
    const NON_HEALTHY = ['DEPRECATED', 'ABANDONED', 'STALE', 'UNKNOWN'];
    for (let i = 0; i < ITERATIONS; i++) {
      const n = gen.randInt(0, 15);
      const findings = gen.genFindings(n);
      const baseScore = computeScore(findings).score;

      // Add one non-HEALTHY finding
      const extra = gen.genFinding();
      extra.status = gen.pick(NON_HEALTHY);
      extra.evidence = `Extra non-healthy finding`;
      if (extra.status === 'UNKNOWN') extra.lastPublished = null;

      const newScore = computeScore([...findings, extra]).score;
      assert.ok(newScore <= baseScore,
        `Adding a ${extra.status} should not increase score: ${baseScore} → ${newScore}`);
    }
  });

  it('adding a HEALTHY finding never lowers the score', () => {
    gen.setSeed(SEED + 3);
    for (let i = 0; i < ITERATIONS; i++) {
      const n = gen.randInt(0, 15);
      const findings = gen.genFindings(n);
      const baseScore = computeScore(findings).score;

      const extra = {
        name: 'healthy-extra',
        ecosystem: 'npm',
        group: 'dependencies',
        status: 'HEALTHY',
        evidence: 'Last release 2026-09-01T00:00:00.000Z',
        lastPublished: '2026-09-01T00:00:00.000Z',
      };

      const newScore = computeScore([...findings, extra]).score;
      assert.ok(newScore >= baseScore,
        `Adding a HEALTHY finding should not lower score: ${baseScore} → ${newScore}`);
    }
  });

  it('order of packages does not change the score', () => {
    gen.setSeed(SEED + 4);
    for (let i = 0; i < ITERATIONS; i++) {
      const n = gen.randInt(1, 15);
      const findings = gen.genFindings(n);
      const reversed = [...findings].reverse();
      // Shuffle a copy
      const shuffled = [...findings].sort(() => gen.random() - 0.5);

      const scoreOriginal = computeScore(findings).score;
      const scoreReversed = computeScore(reversed).score;
      const scoreShuffled = computeScore(shuffled).score;

      assert.equal(scoreOriginal, scoreReversed,
        `Score should be order-independent: original=${scoreOriginal}, reversed=${scoreReversed}`);
      assert.equal(scoreOriginal, scoreShuffled,
        `Score should be order-independent: original=${scoreOriginal}, shuffled=${scoreShuffled}`);
    }
  });

  it('summary counts are non-negative integers', () => {
    gen.setSeed(SEED + 5);
    for (let i = 0; i < ITERATIONS; i++) {
      const findings = gen.genFindings(gen.randInt(0, 20));
      const { summary } = computeScore(findings);
      for (const [key, val] of Object.entries(summary)) {
        assert.ok(val >= 0, `summary.${key} must be >= 0, got ${val}`);
        assert.equal(val, Math.floor(val), `summary.${key} must be an integer`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Parser invariants (parsePip)
// ---------------------------------------------------------------------------

describe('property: parsePip invariants', () => {
  it('packages.length <= total non-blank, non-comment, non-URL lines', () => {
    gen.setSeed(SEED + 10);
    for (let i = 0; i < ITERATIONS; i++) {
      const n = gen.randInt(0, 20);
      const src = gen.genRequirementsTxt(n);
      const { packages } = parsePip(src);

      // Count lines that are non-blank, non-comment, non-URL
      const lines = src.split('\n');
      const validLines = lines.filter(l => {
        const t = l.trim();
        return t !== '' &&
          !t.startsWith('#') &&
          !t.startsWith('http://') &&
          !t.startsWith('https://') &&
          !t.startsWith('git+');
      });

      assert.ok(packages.length <= validLines.length,
        `packages.length (${packages.length}) > non-blank-non-comment-non-URL lines (${validLines.length})`);
    }
  });

  it('output package names never contain version or extras characters', () => {
    gen.setSeed(SEED + 11);
    const INVALID = /[\[=><~!#]/;
    for (let i = 0; i < ITERATIONS; i++) {
      const n = gen.randInt(0, 20);
      const src = gen.genRequirementsTxt(n);
      const { packages } = parsePip(src);

      for (const pkg of packages) {
        assert.ok(!INVALID.test(pkg.name),
          `Package name "${pkg.name}" contains invalid character. Source line was in:\n${src}`);
      }
    }
  });

  it('parsePip never throws for any generated input', () => {
    gen.setSeed(SEED + 12);
    for (let i = 0; i < ITERATIONS; i++) {
      const n = gen.randInt(0, 30);
      const src = gen.genRequirementsTxt(n);
      assert.doesNotThrow(() => parsePip(src),
        `parsePip should never throw, but threw for input: ${JSON.stringify(src)}`);
    }
  });

  it('all output packages have ecosystem=pip and group=direct', () => {
    gen.setSeed(SEED + 13);
    for (let i = 0; i < ITERATIONS; i++) {
      const n = gen.randInt(0, 20);
      const src = gen.genRequirementsTxt(n);
      const { packages } = parsePip(src);
      for (const pkg of packages) {
        assert.equal(pkg.ecosystem, 'pip',
          `Expected ecosystem=pip, got ${pkg.ecosystem} for pkg ${pkg.name}`);
        assert.equal(pkg.group, 'direct',
          `Expected group=direct, got ${pkg.group} for pkg ${pkg.name}`);
      }
    }
  });

  it('package names are always non-empty strings', () => {
    gen.setSeed(SEED + 14);
    for (let i = 0; i < ITERATIONS; i++) {
      const n = gen.randInt(0, 20);
      const src = gen.genRequirementsTxt(n);
      const { packages } = parsePip(src);
      for (const pkg of packages) {
        assert.ok(typeof pkg.name === 'string' && pkg.name.length > 0,
          `Package name must be a non-empty string, got: ${JSON.stringify(pkg.name)}`);
      }
    }
  });

  it('parsePip is idempotent: parsing twice gives the same result', () => {
    gen.setSeed(SEED + 15);
    for (let i = 0; i < ITERATIONS; i++) {
      const n = gen.randInt(0, 20);
      const src = gen.genRequirementsTxt(n);
      const result1 = parsePip(src);
      const result2 = parsePip(src);

      assert.deepEqual(
        result1.packages.map(p => p.name),
        result2.packages.map(p => p.name),
        'parsePip is not idempotent'
      );
      assert.deepEqual(result1.warnings, result2.warnings,
        'parsePip warnings are not idempotent');
    }
  });
});

// ---------------------------------------------------------------------------
// Analyzer invariants (evidence completeness)
// ---------------------------------------------------------------------------

describe('property: analyzePackage evidence invariant', () => {
  it('every generated PackageFinding has non-empty evidence', () => {
    gen.setSeed(SEED + 20);
    // We test this on the gen output itself (which already has evidence set)
    // to confirm the generator satisfies the invariant that tests depend on
    for (let i = 0; i < ITERATIONS; i++) {
      const finding = gen.genFinding();
      assert.ok(typeof finding.evidence === 'string' && finding.evidence.length > 0,
        `Generated finding should have non-empty evidence: ${JSON.stringify(finding)}`);
    }
  });
});
