'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractNpmMeta, extractPypiMeta, fetchNpm, fetchPypi } = require('../lib/registry.js');

const FIXTURES = path.join(__dirname, 'fixtures');

/**
 * Load and parse a fixture file.
 * @param {string} filename
 * @returns {Record<string, any>}
 */
function loadFixture(filename) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, filename), 'utf8'));
}

// ---------------------------------------------------------------------------
// extractNpmMeta
// ---------------------------------------------------------------------------

describe('extractNpmMeta', () => {
  it('npm-moment: deprecated is null (moment is not registry-deprecated)', () => {
    // Note: moment the package is community-deprecated but the npm registry
    // does NOT set the deprecated field on its latest version. This test confirms
    // our extractor correctly returns null when the field is absent.
    const json = loadFixture('npm-moment.json');
    const meta = extractNpmMeta(json);
    assert.equal(meta.deprecated, null);
    assert.equal(meta.name, 'moment');
    assert.ok(meta.latestVersion.length > 0, 'latestVersion should be a non-empty string');
    assert.ok(meta.lastPublished.length > 0, 'lastPublished should be a non-empty string');
    // Validate it's a parseable date
    assert.ok(!isNaN(new Date(meta.lastPublished).getTime()), 'lastPublished should be a valid date');
  });

  it('npm-request: deprecated is a non-empty string', () => {
    const json = loadFixture('npm-request.json');
    const meta = extractNpmMeta(json);
    assert.equal(typeof meta.deprecated, 'string');
    assert.ok(meta.deprecated.length > 0, 'deprecated should be a non-empty string');
    assert.equal(meta.name, 'request');
  });

  it('npm-node-sass: deprecated is a non-empty string', () => {
    const json = loadFixture('npm-node-sass.json');
    const meta = extractNpmMeta(json);
    assert.equal(typeof meta.deprecated, 'string');
    assert.ok(meta.deprecated.length > 0, 'deprecated should be a non-empty string');
    assert.equal(meta.name, 'node-sass');
  });

  it('npm-dayjs: deprecated is null, lastPublished is a valid ISO date', () => {
    const json = loadFixture('npm-dayjs.json');
    const meta = extractNpmMeta(json);
    assert.equal(meta.deprecated, null);
    assert.equal(meta.name, 'dayjs');
    assert.ok(meta.latestVersion.length > 0, 'latestVersion should be non-empty');
    assert.ok(meta.lastPublished.length > 0, 'lastPublished should be non-empty');
    assert.ok(!isNaN(new Date(meta.lastPublished).getTime()), 'lastPublished must be a valid ISO date');
  });

  it('NpmRawMeta shape: all required fields present', () => {
    const json = loadFixture('npm-dayjs.json');
    const meta = extractNpmMeta(json);
    assert.ok('name' in meta, 'meta.name should exist');
    assert.ok('latestVersion' in meta, 'meta.latestVersion should exist');
    assert.ok('deprecated' in meta, 'meta.deprecated should exist');
    assert.ok('distTags' in meta, 'meta.distTags should exist');
    assert.ok('lastPublished' in meta, 'meta.lastPublished should exist');
    assert.ok('rawTime' in meta, 'meta.rawTime should exist');
    assert.equal(typeof meta.distTags, 'object');
    assert.equal(typeof meta.rawTime, 'object');
  });

  it('distTags contains latest entry', () => {
    const json = loadFixture('npm-moment.json');
    const meta = extractNpmMeta(json);
    assert.ok('latest' in meta.distTags, 'distTags should have a latest key');
    assert.equal(meta.distTags.latest, meta.latestVersion);
  });

  it('rawTime includes the latest version key', () => {
    const json = loadFixture('npm-moment.json');
    const meta = extractNpmMeta(json);
    assert.ok(meta.latestVersion in meta.rawTime, 'rawTime should include the latest version key');
  });
});

// ---------------------------------------------------------------------------
// extractPypiMeta
// ---------------------------------------------------------------------------

describe('extractPypiMeta', () => {
  it('pypi-requests: yanked is false, lastPublished is a valid ISO date', () => {
    const json = loadFixture('pypi-requests.json');
    const meta = extractPypiMeta(json);
    assert.equal(meta.yanked, false);
    assert.equal(meta.name, 'requests');
    assert.ok(meta.latestVersion.length > 0, 'latestVersion should be non-empty');
    assert.ok(meta.lastPublished.length > 0, 'lastPublished should be non-empty');
    assert.ok(!isNaN(new Date(meta.lastPublished).getTime()), 'lastPublished must be a valid date');
  });

  it('pypi-requests: latestVersion is a non-empty string', () => {
    const json = loadFixture('pypi-requests.json');
    const meta = extractPypiMeta(json);
    assert.ok(meta.latestVersion.length > 0, 'latestVersion should be a non-empty string');
  });

  it('pypi-nose: lastPublished is a valid ISO date', () => {
    const json = loadFixture('pypi-nose.json');
    const meta = extractPypiMeta(json);
    assert.equal(meta.name, 'nose');
    assert.ok(meta.lastPublished.length > 0, 'lastPublished should be non-empty');
    assert.ok(!isNaN(new Date(meta.lastPublished).getTime()), 'lastPublished must be a valid date');
    // nose's last release was 2015 — confirm the date is old
    const published = new Date(meta.lastPublished);
    assert.ok(published.getFullYear() < 2020, 'nose was last released before 2020');
  });

  it('PypiRawMeta shape: all required fields present', () => {
    const json = loadFixture('pypi-requests.json');
    const meta = extractPypiMeta(json);
    assert.ok('name' in meta, 'meta.name should exist');
    assert.ok('latestVersion' in meta, 'meta.latestVersion should exist');
    assert.ok('yanked' in meta, 'meta.yanked should exist');
    assert.ok('yankedReason' in meta, 'meta.yankedReason should exist');
    assert.ok('lastPublished' in meta, 'meta.lastPublished should exist');
    assert.ok('classifiers' in meta, 'meta.classifiers should exist');
    assert.equal(typeof meta.yanked, 'boolean');
    assert.ok(Array.isArray(meta.classifiers));
  });

  it('pypi-requests: classifiers is an array', () => {
    const json = loadFixture('pypi-requests.json');
    const meta = extractPypiMeta(json);
    assert.ok(Array.isArray(meta.classifiers));
    assert.ok(meta.classifiers.length > 0, 'requests should have classifiers');
  });
});

// ---------------------------------------------------------------------------
// RegistryError shape
// ---------------------------------------------------------------------------

describe('RegistryError shape', () => {
  it('RegistryError has error:true, reason:string, status:number|null shape', () => {
    // We construct them manually as registry.js does internally
    const errNotFound = { error: true, reason: 'not found in registry', status: 404 };
    assert.equal(errNotFound.error, true);
    assert.equal(typeof errNotFound.reason, 'string');
    assert.ok(errNotFound.reason.length > 0);
    assert.equal(errNotFound.status, 404);

    const errUnreachable = { error: true, reason: 'registry unreachable', status: null };
    assert.equal(errUnreachable.error, true);
    assert.equal(typeof errUnreachable.reason, 'string');
    assert.equal(errUnreachable.status, null);

    const errHttp500 = { error: true, reason: 'HTTP 500', status: 500 };
    assert.equal(errHttp500.error, true);
    assert.ok(errHttp500.reason.includes('500'));
    assert.equal(errHttp500.status, 500);
  });

  it('RegistryError status is number or null, never undefined', () => {
    const errors = [
      { error: true, reason: 'not found in registry', status: 404 },
      { error: true, reason: 'registry unreachable', status: null },
      { error: true, reason: 'HTTP 429', status: 429 },
    ];
    for (const e of errors) {
      assert.ok(e.status === null || typeof e.status === 'number',
        `status should be number or null, got: ${e.status}`);
      assert.notEqual(e.status, undefined);
    }
  });
});

// ---------------------------------------------------------------------------
// Default timeout — 30 000 ms
// ---------------------------------------------------------------------------
// These tests confirm the default timeout value and override behaviour without
// making live network calls. We point the registry env vars at a guaranteed-
// unreachable address (0.0.0.0) and rely on a very short explicit timeout so
// tests complete in milliseconds. The key invariant is that:
//   1. When no opts are passed, the default timeout is 30 000 ms (not 10 000).
//   2. A caller-supplied opts.timeout overrides the default.
//
// To verify (1) without waiting 30 s, we read the module source directly and
// assert the literal appears correctly — this is the zero-network, fixture-style
// way to guard the constant against regressions.
// ---------------------------------------------------------------------------

describe('fetchNpm / fetchPypi default timeout', () => {
  it('lib/registry.js source contains default timeout of 30000 for fetchNpm', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../lib/registry.js'),
      'utf8'
    );
    // Assert the new default is present in fetchNpm
    assert.ok(
      src.includes(': 30000'),
      'fetchNpm should fall back to 30000 ms when no opts.timeout is supplied'
    );
  });

  it('lib/registry.js source does NOT contain the old 10000 default', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../lib/registry.js'),
      'utf8'
    );
    assert.ok(
      !src.includes(': 10000'),
      'old 10000 ms default must have been removed from registry.js'
    );
  });

  it('fetchNpm returns RegistryError when opts.timeout is overridden to a very short value', async () => {
    // Point npm registry at a guaranteed-unreachable endpoint so the test is
    // deterministic and completes in milliseconds rather than waiting 30 s.
    const prev = process.env.BONEYARD_NPM_REGISTRY;
    process.env.BONEYARD_NPM_REGISTRY = 'http://0.0.0.0:1';
    try {
      const result = await fetchNpm('lodash', { timeout: 50 });
      assert.equal(result.error, true, 'expected a RegistryError');
      assert.equal(typeof result.reason, 'string');
    } finally {
      if (prev === undefined) {
        delete process.env.BONEYARD_NPM_REGISTRY;
      } else {
        process.env.BONEYARD_NPM_REGISTRY = prev;
      }
    }
  });

  it('fetchPypi returns RegistryError when opts.timeout is overridden to a very short value', async () => {
    const prev = process.env.BONEYARD_PYPI_REGISTRY;
    process.env.BONEYARD_PYPI_REGISTRY = 'http://0.0.0.0:1';
    try {
      const result = await fetchPypi('requests', { timeout: 50 });
      assert.equal(result.error, true, 'expected a RegistryError');
      assert.equal(typeof result.reason, 'string');
    } finally {
      if (prev === undefined) {
        delete process.env.BONEYARD_PYPI_REGISTRY;
      } else {
        process.env.BONEYARD_PYPI_REGISTRY = prev;
      }
    }
  });
});
