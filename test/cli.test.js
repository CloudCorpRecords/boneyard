'use strict';

/**
 * CLI integration tests.
 *
 * These tests spin up a tiny in-process HTTP server that serves fake registry
 * responses, then run bin/boneyard.js as a child process with
 * BONEYARD_NPM_REGISTRY and BONEYARD_PYPI_REGISTRY pointed at that server.
 *
 * No live network calls are made.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.resolve(__dirname, '../bin/boneyard.js');

// ─── Fixture payloads ─────────────────────────────────────────────────────────

/**
 * Minimal npm registry response for a HEALTHY package.
 * @param {string} name
 * @param {string} version
 * @param {string} publishedAt  ISO date string
 * @returns {object}
 */
function npmHealthy(name, version, publishedAt) {
  return {
    name,
    'dist-tags': { latest: version },
    versions: { [version]: { name, version } },
    time: {
      created: publishedAt,
      modified: publishedAt,
      [version]: publishedAt,
    },
  };
}

/**
 * Minimal npm registry response for a DEPRECATED package.
 * @param {string} name
 * @param {string} msg
 * @returns {object}
 */
function npmDeprecated(name, msg) {
  const version = '1.0.0';
  const publishedAt = '2018-01-01T00:00:00.000Z';
  return {
    name,
    'dist-tags': { latest: version },
    versions: {
      [version]: { name, version, deprecated: msg },
    },
    time: {
      created: publishedAt,
      modified: publishedAt,
      [version]: publishedAt,
    },
  };
}

/**
 * Minimal PyPI registry response for a HEALTHY package.
 * @param {string} name
 * @param {string} version
 * @param {string} uploadTime  ISO date string (no Z suffix, as PyPI gives)
 * @returns {object}
 */
function pypiHealthy(name, version, uploadTime) {
  return {
    info: {
      name,
      version,
      yanked: false,
      yanked_reason: null,
      classifiers: [],
    },
    releases: {
      [version]: [{ upload_time: uploadTime }],
    },
  };
}

// Registry data keyed by "<ecosystem>/<name>"
const REGISTRY_DATA = {
  'npm/dayjs':    npmHealthy('dayjs',    '1.11.10', '2024-01-15T00:00:00.000Z'),
  'npm/moment':   npmDeprecated('moment', 'moment is legacy; use dayjs instead'),
  'npm/lodash':   npmHealthy('lodash',   '4.17.21', '2024-06-01T00:00:00.000Z'),
  'pip/requests': pypiHealthy('requests', '2.31.0', '2024-05-01T00:00:00'),
  'pip/flask':    pypiHealthy('flask',    '3.0.2',  '2024-02-01T00:00:00'),
};

// ─── Stub server ──────────────────────────────────────────────────────────────

let stubServer;
let stubPort;

/**
 * Start the stub HTTP server and resolve when it is listening.
 * @returns {Promise<void>}
 */
function startStubServer() {
  return new Promise((resolve, reject) => {
    stubServer = http.createServer((req, res) => {
      const url = req.url; // e.g. "/dayjs" or "/requests/json"

      // npm: /dayjs  (bare name, possibly URL-encoded)
      // PyPI: /requests/json
      let key = null;

      const npmMatch = url.match(/^\/([^/]+)$/);
      const pypiMatch = url.match(/^\/([^/]+)\/json$/);

      if (npmMatch) {
        key = `npm/${decodeURIComponent(npmMatch[1])}`;
      } else if (pypiMatch) {
        key = `pip/${decodeURIComponent(pypiMatch[1])}`;
      }

      const data = key ? REGISTRY_DATA[key] : null;

      if (data) {
        const body = JSON.stringify(data);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        });
        res.end(body);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      }
    });

    stubServer.listen(0, '127.0.0.1', () => {
      stubPort = stubServer.address().port;
      resolve();
    });

    stubServer.on('error', reject);
  });
}

/**
 * Stop the stub HTTP server.
 * @returns {Promise<void>}
 */
function stopStubServer() {
  return new Promise((resolve, reject) => {
    stubServer.close((err) => (err ? reject(err) : resolve()));
  });
}

// ─── Helper: run CLI ──────────────────────────────────────────────────────────

/**
 * Run the boneyard CLI as a child process.
 *
 * @param {string[]} args      CLI arguments
 * @param {{ env?: Record<string,string> }} [options]
 * @returns {Promise<{ stdout: string, stderr: string, code: number }>}
 */
function runCLI(args, options = {}) {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, {
      BONEYARD_NPM_REGISTRY: `http://127.0.0.1:${stubPort}`,
      BONEYARD_PYPI_REGISTRY: `http://127.0.0.1:${stubPort}`,
    }, options.env || {});

    execFile(process.execPath, [CLI, ...args], { env }, (err, stdout, stderr) => {
      resolve({
        stdout,
        stderr,
        code: err ? (err.code || 1) : 0,
      });
    });
  });
}

// ─── Temp manifest helpers ────────────────────────────────────────────────────

/**
 * Write a temp file and return its path.
 * @param {string} content
 * @param {string} suffix
 * @returns {string}
 */
function writeTempFile(content, suffix) {
  const file = path.join(os.tmpdir(), `boneyard-test-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CLI integration', () => {
  before(async () => {
    await startStubServer();
  });

  after(async () => {
    await stopStubServer();
  });

  it('exits 0 with text report for a healthy npm package.json', async () => {
    const pkg = JSON.stringify({ dependencies: { dayjs: '^1.0.0' } });
    const file = writeTempFile(pkg, '.json');
    try {
      const { stdout, code } = await runCLI([file]);
      assert.equal(code, 0);
      assert.match(stdout, /Health Score/);
      assert.match(stdout, /dayjs/);
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('exits 1 when manifest contains a deprecated package', async () => {
    const pkg = JSON.stringify({ dependencies: { moment: '*' } });
    const file = writeTempFile(pkg, '.json');
    try {
      const { stdout, code } = await runCLI([file]);
      assert.equal(code, 1, `expected exit 1, got ${code}`);
      assert.match(stdout, /DEPRECATED/);
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('includes suggestion for deprecated moment package', async () => {
    const pkg = JSON.stringify({ dependencies: { moment: '*' } });
    const file = writeTempFile(pkg, '.json');
    try {
      const { stdout } = await runCLI([file]);
      assert.match(stdout, /Consider/i);
      assert.match(stdout, /dayjs/i);
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('exits 0 for an all-healthy requirements.txt', async () => {
    const txt = 'requests==2.31.0\nflask>=3.0.0\n';
    const file = writeTempFile(txt, '.txt');
    try {
      const { code, stdout } = await runCLI([file]);
      assert.equal(code, 0);
      assert.match(stdout, /Health Score/);
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('--json flag produces valid JSON output', async () => {
    const pkg = JSON.stringify({ dependencies: { dayjs: '^1.0.0' } });
    const file = writeTempFile(pkg, '.json');
    try {
      const { stdout, code } = await runCLI([file, '--json']);
      assert.equal(code, 0);
      const parsed = JSON.parse(stdout);
      assert.ok(Array.isArray(parsed.findings));
      assert.ok('score' in parsed);
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('exits 2 when file does not exist', async () => {
    const { code, stderr } = await runCLI(['/tmp/does-not-exist-boneyard.json']);
    assert.equal(code, 2);
    assert.match(stderr, /not found|error/i);
  });

  it('exits 2 when manifest is invalid JSON', async () => {
    const file = writeTempFile('this is not json {{{', '.json');
    try {
      const { code, stderr } = await runCLI([file]);
      assert.equal(code, 2);
      assert.match(stderr, /parse error/i);
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('prints help and exits 0 with --help', async () => {
    const { stdout, code } = await runCLI(['--help']);
    assert.equal(code, 0);
    assert.match(stdout, /Usage/i);
  });

  it('exits 2 with usage when no arguments given', async () => {
    const { code, stdout } = await runCLI([]);
    assert.equal(code, 2);
    assert.match(stdout, /Usage/i);
  });

  it('--npm flag forces npm ecosystem on a .txt file', async () => {
    // Write a package.json-style content but with .txt extension
    const pkg = JSON.stringify({ dependencies: { dayjs: '*' } });
    const file = writeTempFile(pkg, '.txt'); // would normally be treated as pip
    try {
      const { code } = await runCLI([file, '--npm']);
      // Should parse as npm successfully, exit 0
      assert.equal(code, 0);
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('marks packages UNKNOWN when registry returns 404', async () => {
    const pkg = JSON.stringify({ dependencies: { 'nonexistent-package-xyz': '*' } });
    const file = writeTempFile(pkg, '.json');
    try {
      const { stdout, code } = await runCLI([file]);
      // Exit 0 (UNKNOWN does not trigger exit 1)
      assert.equal(code, 0);
      assert.match(stdout, /UNKNOWN/);
    } finally {
      fs.unlinkSync(file);
    }
  });
});

// ─── Registry env override unit test ─────────────────────────────────────────

describe('registry env overrides', () => {
  it('npmRegistryBase returns default when env var is unset', () => {
    const saved = process.env.BONEYARD_NPM_REGISTRY;
    delete process.env.BONEYARD_NPM_REGISTRY;
    const { npmRegistryBase } = require('../lib/registry.js');
    const base = npmRegistryBase();
    assert.equal(base, 'https://registry.npmjs.org');
    if (saved !== undefined) process.env.BONEYARD_NPM_REGISTRY = saved;
  });

  it('npmRegistryBase returns override when env var is set', () => {
    const saved = process.env.BONEYARD_NPM_REGISTRY;
    process.env.BONEYARD_NPM_REGISTRY = 'http://localhost:9999';
    const { npmRegistryBase } = require('../lib/registry.js');
    const base = npmRegistryBase();
    assert.equal(base, 'http://localhost:9999');
    if (saved !== undefined) process.env.BONEYARD_NPM_REGISTRY = saved;
    else delete process.env.BONEYARD_NPM_REGISTRY;
  });

  it('pypiRegistryBase returns default when env var is unset', () => {
    const saved = process.env.BONEYARD_PYPI_REGISTRY;
    delete process.env.BONEYARD_PYPI_REGISTRY;
    const { pypiRegistryBase } = require('../lib/registry.js');
    const base = pypiRegistryBase();
    assert.equal(base, 'https://pypi.org/pypi');
    if (saved !== undefined) process.env.BONEYARD_PYPI_REGISTRY = saved;
  });

  it('pypiRegistryBase returns override when env var is set', () => {
    const saved = process.env.BONEYARD_PYPI_REGISTRY;
    process.env.BONEYARD_PYPI_REGISTRY = 'http://localhost:9999/pypi';
    const { pypiRegistryBase } = require('../lib/registry.js');
    const base = pypiRegistryBase();
    assert.equal(base, 'http://localhost:9999/pypi');
    if (saved !== undefined) process.env.BONEYARD_PYPI_REGISTRY = saved;
    else delete process.env.BONEYARD_PYPI_REGISTRY;
  });

  it('npmRegistryBase strips trailing slash from override', () => {
    const saved = process.env.BONEYARD_NPM_REGISTRY;
    process.env.BONEYARD_NPM_REGISTRY = 'http://localhost:9999/';
    const { npmRegistryBase } = require('../lib/registry.js');
    const base = npmRegistryBase();
    assert.equal(base, 'http://localhost:9999');
    if (saved !== undefined) process.env.BONEYARD_NPM_REGISTRY = saved;
    else delete process.env.BONEYARD_NPM_REGISTRY;
  });
});
