# Boneyard — Tech Stack

## Runtime

- **Node.js 20+** (LTS). No polyfills needed: `fetch`, `node:test`, `node:assert`, `node:fs/promises`, `node:path`, `node:readline`, and `node:url` are all built in.
- Target the current LTS; do not use experimental flags.

## Module System

**CommonJS** (`require` / `module.exports`). Rationale: simpler interop with the built-in test runner, no `.mjs` extensions needed, and the project has no need for ES module tree-shaking since there is no bundler. All files use `'use strict'` at the top.

## Dependencies

**Zero third-party runtime dependencies.** `package.json` will have an empty `dependencies` object. `devDependencies` will also be empty — tests run with the built-in `node:test` runner.

This is a hard constraint. If a capability is needed, implement it using the Node standard library. Acceptable Node built-ins include (non-exhaustive):
- `node:fs` / `node:fs/promises` — file I/O
- `node:path` — path manipulation
- `node:url` — URL construction
- `node:readline` — stream-based line reading (parser fallback)
- `node:http` / `node:https` — low-level HTTP (prefer global `fetch` where sufficient)
- `node:test` + `node:assert` — test runner and assertions
- `node:stream` — streaming I/O if needed

**Global `fetch`** (available since Node 18) is the primary HTTP client for registry calls. No `node-fetch`, no `axios`.

## Architecture Layers

```
bin/boneyard.js        CLI entry point (thin wrapper)
server.js              HTTP server for the web UI (dev / self-hosted)
api/analyze.js         Vercel-style serverless handler (production web)
public/                Static frontend (HTML + vanilla JS + CSS, no framework)
lib/                   Pure, testable core library (NO network I/O except registry.js)
test/                  Unit and integration tests
test/fixtures/         Recorded real registry API responses (JSON files)
```

The key invariant: **everything under `lib/` except `registry.js` is pure** — it takes plain JS values and returns plain JS values. `registry.js` is the only module that calls `fetch`. All other modules are testable without any network access and without mocking `fetch`.

## Core Library Modules (`lib/`)

| Module | Responsibility |
|---|---|
| `parse.js` | Parse `package.json` and `requirements.txt` into a normalised package list |
| `registry.js` | Fetch raw metadata from npm registry and PyPI JSON API |
| `analyze.js` | Classify each package (DEPRECATED / ABANDONED / STALE / HEALTHY / UNKNOWN) from registry metadata |
| `score.js` | Compute the 0–100 project health score from a list of findings |
| `suggest.js` | Apply the curated replacements map |
| `report.js` | Format findings + score into JSON and human-readable text |

`bin/boneyard.js`, `server.js`, and `api/analyze.js` all import from `lib/` and supply their own I/O glue. They share no duplicated logic.

## Testing

- **Test runner**: `node:test` (built-in, Node 18+).
- **Assertion library**: `node:assert/strict`.
- **No network access in unit tests.** Registry tests use pre-recorded JSON fixtures in `test/fixtures/`. Tests call the pure functions in `analyze.js`, `score.js`, `suggest.js`, `report.js`, and `parse.js` directly.
- **Fixtures** are recorded real registry responses, committed to the repository. They should be regenerated periodically as part of maintenance, but never auto-fetched during `npm test`.
- **Property-based tests** for parsers and scorer invariants are implemented using a small hand-rolled generator (a few dozen lines of pure JS) — no `fast-check` or similar.
- Tests live in `test/` with filenames matching `*.test.js`.
- Run tests with: `node --test` or `node --test test/**/*.test.js`.

## CLI

`bin/boneyard.js` is the executable entry point (shebang `#!/usr/bin/env node`). It:
- Reads the manifest path from `process.argv`.
- Calls `lib/parse.js`, `lib/registry.js`, `lib/analyze.js`, `lib/score.js`, `lib/suggest.js`, `lib/report.js` in sequence.
- Writes the report to stdout (default: human-readable text) or to a file (`--output` flag, JSON when filename ends in `.json`).
- Exits with code `1` if any package is classified DEPRECATED; exits `0` otherwise (including when packages are UNKNOWN due to registry errors).

## Web Layer

- `public/index.html` — single-page UI: a `<textarea>` for the manifest, a format selector (npm / pip), a submit button, and a results section. Vanilla JS only. No build step.
- `api/analyze.js` — Vercel-compatible serverless handler (`export default async function handler(req, res)`). Accepts a POST with `{ manifest, format }`, calls the same `lib/` modules, returns JSON.
- `server.js` — A lightweight `node:http` server that serves `public/` as static files and routes `POST /api/analyze` to the same handler logic. Used for local development and self-hosted deployments.

## Code Style

- `'use strict'` at the top of every file.
- JSDoc on every exported function: `@param`, `@returns`, and `@throws` where applicable.
- No TypeScript (keeps the zero-dependency constraint clean and avoids a build step). Types are documented via JSDoc only.
- Prefer explicit, flat code over clever abstractions. This is a small tool; readability beats brevity.
- Maximum line length: 100 characters (soft limit).
