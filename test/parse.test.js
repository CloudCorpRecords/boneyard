'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseNpm, parsePip, ParseError } = require('../lib/parse.js');

// ---------------------------------------------------------------------------
// parseNpm
// ---------------------------------------------------------------------------

describe('parseNpm', () => {
  it('parses dependencies and devDependencies from a valid package.json', () => {
    const src = JSON.stringify({
      dependencies: { express: '^4.0.0', lodash: '^4.17.0' },
      devDependencies: { jest: '^29.0.0' }
    });
    const refs = parseNpm(src);
    assert.equal(refs.length, 3);

    const names = refs.map(r => r.name);
    assert.ok(names.includes('express'));
    assert.ok(names.includes('lodash'));
    assert.ok(names.includes('jest'));

    const jestRef = refs.find(r => r.name === 'jest');
    assert.equal(jestRef.group, 'devDependencies');
    assert.equal(jestRef.ecosystem, 'npm');

    const expressRef = refs.find(r => r.name === 'express');
    assert.equal(expressRef.group, 'dependencies');
  });

  it('treats missing dependencies key as empty set', () => {
    const src = JSON.stringify({ devDependencies: { jest: '^29.0.0' } });
    const refs = parseNpm(src);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].name, 'jest');
    assert.equal(refs[0].group, 'devDependencies');
  });

  it('treats missing devDependencies key as empty set', () => {
    const src = JSON.stringify({ dependencies: { express: '^4.0.0' } });
    const refs = parseNpm(src);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].name, 'express');
    assert.equal(refs[0].group, 'dependencies');
  });

  it('returns empty array for empty root object {}', () => {
    const refs = parseNpm('{}');
    assert.deepEqual(refs, []);
  });

  it('throws ParseError for invalid JSON', () => {
    assert.throws(() => parseNpm('not json'), (err) => {
      assert.ok(err instanceof ParseError);
      assert.equal(err.code, 'PARSE_ERROR');
      return true;
    });
  });

  it('throws ParseError for JSON array root []', () => {
    assert.throws(() => parseNpm('[]'), (err) => {
      assert.ok(err instanceof ParseError);
      assert.equal(err.code, 'PARSE_ERROR');
      return true;
    });
  });

  it('throws ParseError for JSON null root', () => {
    assert.throws(() => parseNpm('null'), (err) => {
      assert.ok(err instanceof ParseError);
      return true;
    });
  });

  it('preserves scoped package names like @org/pkg', () => {
    const src = JSON.stringify({
      dependencies: { '@angular/core': '^16.0.0', '@types/node': '^20.0.0' }
    });
    const refs = parseNpm(src);
    assert.equal(refs.length, 2);
    const names = refs.map(r => r.name);
    assert.ok(names.includes('@angular/core'));
    assert.ok(names.includes('@types/node'));
  });

  it('normalises package names to lowercase', () => {
    const src = JSON.stringify({ dependencies: { 'MyPackage': '1.0.0' } });
    const refs = parseNpm(src);
    assert.equal(refs[0].name, 'mypackage');
  });

  it('marks devDependencies with group=devDependencies and ecosystem=npm', () => {
    const src = JSON.stringify({ devDependencies: { typescript: '^5.0.0' } });
    const refs = parseNpm(src);
    assert.equal(refs[0].group, 'devDependencies');
    assert.equal(refs[0].ecosystem, 'npm');
  });
});

// ---------------------------------------------------------------------------
// parsePip
// ---------------------------------------------------------------------------

describe('parsePip', () => {
  it('parses a single package name', () => {
    const { packages, warnings } = parsePip('requests');
    assert.equal(packages.length, 1);
    assert.equal(packages[0].name, 'requests');
    assert.equal(packages[0].ecosystem, 'pip');
    assert.equal(packages[0].group, 'direct');
    assert.equal(warnings.length, 0);
  });

  it('strips == version specifier and records only the name', () => {
    const { packages } = parsePip('Django==4.2.0');
    assert.equal(packages.length, 1);
    assert.equal(packages[0].name, 'django');
  });

  it('strips >= version specifier', () => {
    const { packages } = parsePip('flask>=2.0');
    assert.equal(packages.length, 1);
    assert.equal(packages[0].name, 'flask');
  });

  it('strips ~= version specifier', () => {
    const { packages } = parsePip('numpy~=1.24');
    assert.equal(packages.length, 1);
    assert.equal(packages[0].name, 'numpy');
  });

  it('strips != version specifier', () => {
    const { packages } = parsePip('boto3!=1.0.0');
    assert.equal(packages.length, 1);
    assert.equal(packages[0].name, 'boto3');
  });

  it('strips extras like requests[security]', () => {
    const { packages } = parsePip('requests[security]');
    assert.equal(packages.length, 1);
    assert.equal(packages[0].name, 'requests');
  });

  it('strips extras with multiple extras requests[security,socks]', () => {
    const { packages } = parsePip('requests[security,socks]');
    assert.equal(packages.length, 1);
    assert.equal(packages[0].name, 'requests');
  });

  it('skips comment lines starting with #', () => {
    const { packages } = parsePip('# This is a comment\nrequests');
    assert.equal(packages.length, 1);
    assert.equal(packages[0].name, 'requests');
  });

  it('skips blank lines', () => {
    const { packages } = parsePip('\n\nrequests\n\nflask\n\n');
    assert.equal(packages.length, 2);
  });

  it('handles CRLF line endings', () => {
    const { packages } = parsePip('requests\r\nflask\r\ndjango\r\n');
    assert.equal(packages.length, 3);
    assert.equal(packages[0].name, 'requests');
    assert.equal(packages[1].name, 'flask');
    assert.equal(packages[2].name, 'django');
  });

  it('skips http:// URL requirements and adds a warning', () => {
    const { packages, warnings } = parsePip('http://example.com/pkg.tar.gz\nrequests');
    assert.equal(packages.length, 1);
    assert.equal(packages[0].name, 'requests');
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('http://example.com/pkg.tar.gz'));
  });

  it('skips https:// URL requirements and adds a warning', () => {
    const { packages, warnings } = parsePip('https://example.com/pkg.tar.gz');
    assert.equal(packages.length, 0);
    assert.equal(warnings.length, 1);
  });

  it('skips git+ URL requirements and adds a warning', () => {
    const { packages, warnings } = parsePip('git+https://github.com/user/repo.git\nrequests');
    assert.equal(packages.length, 1);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('git+'));
  });

  it('handles a mixed file with comments, blanks, URLs, and packages', () => {
    const src = [
      '# Production dependencies',
      '',
      'requests==2.31.0',
      'flask>=2.0',
      '',
      '# Dev tools',
      'pytest==7.0.0',
      'https://example.com/pkg.tar.gz',
      'git+https://github.com/user/repo.git',
      '',
    ].join('\n');

    const { packages, warnings } = parsePip(src);
    assert.equal(packages.length, 3);
    assert.equal(warnings.length, 2);
    const names = packages.map(p => p.name);
    assert.ok(names.includes('requests'));
    assert.ok(names.includes('flask'));
    assert.ok(names.includes('pytest'));
  });

  it('normalises package names to lowercase', () => {
    const { packages } = parsePip('Django==4.2.0\nFlask>=2.0');
    assert.equal(packages[0].name, 'django');
    assert.equal(packages[1].name, 'flask');
  });

  it('strips inline comments from package lines', () => {
    const { packages } = parsePip('requests  # needed for HTTP');
    assert.equal(packages.length, 1);
    assert.equal(packages[0].name, 'requests');
  });

  it('handles version with extras combined: package[extra]==version', () => {
    const { packages } = parsePip('requests[security]==2.31.0');
    assert.equal(packages.length, 1);
    assert.equal(packages[0].name, 'requests');
  });
});

// ---------------------------------------------------------------------------
// Property-based: parsePip output names never contain invalid characters
// ---------------------------------------------------------------------------

describe('parsePip property: output names never contain version/extras chars', () => {
  const INVALID_CHARS = /[\[=><~!#]/;

  const testCases = [
    'package==1.0.0',
    'pkg[extra]>=2.0',
    'another~=3.0',
    'pkg!=1.0,>=0.5',
    'mypackage[extras,more]==4.0.0',
    '# comment',
    '',
    'simple',
    'http://example.com/pkg.tar.gz',
    'flask>=2.0  # some comment',
  ];

  for (const src of testCases) {
    it(`names from ${JSON.stringify(src)} contain no invalid characters`, () => {
      const { packages } = parsePip(src);
      for (const pkg of packages) {
        assert.ok(
          !INVALID_CHARS.test(pkg.name),
          `Name "${pkg.name}" should not contain characters like [, =, >, <, ~, !, #`
        );
      }
    });
  }
});
