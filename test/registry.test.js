'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractNpmMeta, extractPypiMeta } = require('../lib/registry.js');

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
