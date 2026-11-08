# Boneyard — Repository Structure

## Directory Layout

```
boneyard/
├── .gitignore
├── .kiro/
│   ├── steering/
│   │   ├── product.md          # What Boneyard is, principles, build story
│   │   ├── tech.md             # Stack decisions, module map, test strategy
│   │   └── structure.md        # This file — layout and conventions
│   └── specs/
│       └── boneyard/
│           ├── requirements.md # Numbered requirements with EARS acceptance criteria
│           ├── design.md       # Architecture, data models, scoring formula
│           └── tasks.md        # Numbered implementation task list
├── README.md
├── package.json                # name, version, bin entry; NO dependencies
├── bin/
│   └── boneyard.js             # CLI entry point (#!/usr/bin/env node)
├── lib/
│   ├── parse.js                # Manifest parsers (package.json + requirements.txt)
│   ├── registry.js             # npm and PyPI registry fetch calls
│   ├── analyze.js              # Per-package classification logic
│   ├── score.js                # 0-100 project health score computation
│   ├── suggest.js              # Curated replacements map + lookup
│   └── report.js               # JSON and human-readable text report formatters
├── api/
│   └── analyze.js              # Vercel-style serverless handler
├── public/
│   ├── index.html              # Single-page web UI
│   ├── style.css               # Styles (no framework)
│   └── app.js                  # Frontend JS (vanilla, no bundler)
├── server.js                   # Local dev HTTP server (node:http)
└── test/
    ├── parse.test.js
    ├── analyze.test.js
    ├── score.test.js
    ├── suggest.test.js
    ├── report.test.js
    ├── registry.test.js        # Uses fixtures only — no live network
    └── fixtures/
        ├── npm-moment.json         # Recorded GET https://registry.npmjs.org/moment
        ├── npm-request.json        # Recorded GET https://registry.npmjs.org/request
        ├── npm-lodash.json         # Recorded GET https://registry.npmjs.org/lodash
        ├── npm-tslint.json         # Recorded GET https://registry.npmjs.org/tslint
        ├── npm-node-sass.json      # Recorded GET https://registry.npmjs.org/node-sass
        ├── pypi-requests.json      # Recorded GET https://pypi.org/pypi/requests/json
        ├── pypi-flask.json         # Recorded GET https://pypi.org/pypi/flask/json
        └── pypi-django.json        # Recorded GET https://pypi.org/pypi/django/json
```

## Module Conventions

### Every `lib/` module (except `registry.js`) is pure
Pure means: given the same inputs, it always returns the same outputs, and it performs no I/O. No `fetch`, no `fs`, no `process`. This makes every module trivially testable without mocks.

### `registry.js` is the only I/O boundary
All network calls live in `registry.js`. It exports async functions that accept a package name (and ecosystem) and return a plain JS object. Callers never see raw `Response` objects. Error handling (timeouts, 404s, network failures) is encapsulated here and surfaces as a structured error object, not a thrown exception.

### CommonJS, strict mode, JSDoc
Every file begins with `'use strict';`. Exports use `module.exports = { ... }`. Every exported function has a JSDoc block with `@param` and `@returns` tags describing the expected types.

### No network access in tests
Tests under `test/` must pass without an internet connection. Registry tests load fixtures from `test/fixtures/` using `node:fs`. Fixture files are committed JSON snapshots of real registry responses.

### Fixtures are real, not synthetic
Fixture files are produced by a one-off script that fetches actual registry responses and writes them to disk. They must not be manually crafted to pass tests — they must represent what the real registry returns so that the code is tested against realistic data shapes.

### Small, focused modules
Each `lib/` module exports one primary function (or a small cohesive set of related functions). Avoid large, multi-concern files. If a module grows past ~150 lines of logic, consider splitting it.

### Test file naming
Test files are named `<module>.test.js` and live directly in `test/` (not in subdirectories). They import from `../lib/<module>.js` using relative paths.

### Public directory
`public/` contains only static assets: one HTML file, one CSS file, one JS file. No build step, no bundler, no framework. The frontend calls `POST /api/analyze` and renders the JSON response directly.

## Key Invariants (enforce in code review)

1. `package.json` has no `dependencies` and no `devDependencies`.
2. `lib/parse.js`, `lib/analyze.js`, `lib/score.js`, `lib/suggest.js`, `lib/report.js` contain zero `fetch` or `require('node:http')` calls.
3. All test files pass `node --test` with no internet connection.
4. `bin/boneyard.js` exits with code `1` if and only if at least one package is DEPRECATED.
5. The `.kiro/` directory is tracked in git (not in `.gitignore`).
