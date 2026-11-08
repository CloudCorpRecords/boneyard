# Boneyard — Implementation Tasks

Tasks are ordered by dependency. Each task references the requirements it satisfies. Complete tasks in order; do not skip ahead.

---

## Phase 1 — Project Scaffolding

### Task 1 — Initialise repository structure

**Requirements:** (all)

- Create `package.json` with `name: "boneyard"`, `version: "0.1.0"`, `main: "lib/index.js"`, `bin: { "boneyard": "bin/boneyard.js" }`, `engines: { "node": ">=20" }`. `dependencies` and `devDependencies` must be empty objects. Add `"scripts": { "test": "node --test test/**/*.test.js" }`.
- Create empty placeholder files (with a single comment) for every module: `lib/parse.js`, `lib/registry.js`, `lib/analyze.js`, `lib/score.js`, `lib/suggest.js`, `lib/report.js`.
- Create empty placeholder files: `bin/boneyard.js`, `api/analyze.js`, `server.js`.
- Create `public/index.html`, `public/style.css`, `public/app.js` as empty stubs.
- Create `test/fixtures/` directory with a `.gitkeep`.
- Create `test/helpers/gen.js` as an empty stub.
- Verify `node --version` is 20+.
- Verify `node --test` runs (zero tests, no error).

**Done when:** `node --test` exits 0, directory tree matches structure.md exactly.

---

## Phase 2 — Parsers + Tests

### Task 2 — Implement `lib/parse.js`

**Requirements:** REQ-01, REQ-02

- Implement `parseNpm(source)`:
  - Parse source as JSON; throw `ParseError` if invalid or not a plain object.
  - Extract `dependencies` and `devDependencies` keys; default each to `{}` if absent.
  - Return a flat `PackageRef[]` with `ecosystem: 'npm'` and the appropriate `group`.
  - Normalise names to lowercase.
- Implement `parsePip(source)`:
  - Split on `\r\n` and `\n`.
  - Skip blank lines and lines beginning with `#`.
  - Strip version specifiers (`==`, `>=`, `<=`, `~=`, `!=`, `>`  `<`) and extras (`[...]`).
  - Detect URL lines (starting with `http://`, `https://`, `git+`); add a warning string and skip.
  - Return `{ packages: PackageRef[], warnings: string[] }`.
- Export `ParseError` class with `code: 'PARSE_ERROR'`.
- Add JSDoc to every exported function and type.

**Done when:** all tests in Task 3 pass.

### Task 3 — Write tests for `lib/parse.js`

**Requirements:** REQ-01, REQ-02

Create `test/parse.test.js` using `node:test` and `node:assert/strict`.

Tests for `parseNpm`:
- Valid `package.json` with `dependencies` and `devDependencies` → correct `PackageRef[]`.
- Missing `dependencies` key → treated as empty, no error.
- Missing `devDependencies` key → treated as empty, no error.
- Empty `{}` root → returns empty array.
- Invalid JSON string → throws `ParseError`.
- JSON array root (`[]`) → throws `ParseError`.
- Scoped package name (`@org/pkg`) → name preserved as-is.

Tests for `parsePip`:
- Single package name → one `PackageRef`.
- Package with `==` version specifier → name only, no version.
- Package with extras (`requests[security]`) → `requests` only.
- Comment line → skipped, not in packages.
- Blank line → skipped.
- CRLF line endings → handled correctly.
- URL requirement → skipped, warning included.
- Mixed file (comments, blanks, URLs, packages) → correct packages and warnings.

Property-based test (using `gen.js` stubs — implement the generator minimally here):
- For N random pip-style strings, `parsePip(s).packages` never contains a name with `[`, `=`, `>`, `<`, `~`, `!`, or `#`.

**Done when:** `node --test test/parse.test.js` exits 0.

---

## Phase 3 — Registry Clients + Fixture Tests

### Task 4 — Record registry fixtures

**Requirements:** REQ-03, REQ-04

Write a one-off script `scripts/record-fixtures.js` that:
- Fetches `https://registry.npmjs.org/moment`, `https://registry.npmjs.org/request`, `https://registry.npmjs.org/lodash`, `https://registry.npmjs.org/tslint`, `https://registry.npmjs.org/node-sass`.
- Fetches `https://pypi.org/pypi/requests/json`, `https://pypi.org/pypi/flask/json`, `https://pypi.org/pypi/django/json`.
- Writes each response to the corresponding file in `test/fixtures/` (see structure.md).

Run the script once, commit the fixture files. The script is not run as part of `npm test`.

**Done when:** All 8 fixture files exist and are valid JSON.

### Task 5 — Implement `lib/registry.js`

**Requirements:** REQ-03, REQ-04

- Implement `extractNpmMeta(json)` — pure function, takes a parsed npm registry document, returns `NpmRawMeta`.
- Implement `extractPypiMeta(json)` — pure function, takes a parsed PyPI JSON document, returns `PypiRawMeta`.
- Implement `fetchNpm(name, opts)` — calls `fetch` with `AbortController` timeout, calls `extractNpmMeta`, handles all error cases, returns `NpmRawMeta | RegistryError`.
- Implement `fetchPypi(name, opts)` — same pattern for PyPI.
- Implement `fetchAll(refs, opts)` — uses a semaphore to cap concurrency at `opts.concurrency ?? 5`, resolves to a `Map<name, meta>`.
- Implement the semaphore as a simple counter + queue (no third-party library).
- Never throw from `fetchNpm`, `fetchPypi`, or `fetchAll`; always return a value.

**Done when:** all tests in Task 6 pass.

### Task 6 — Write tests for `lib/registry.js`

**Requirements:** REQ-03, REQ-04

Create `test/registry.test.js`.

- Load each fixture file with `fs.readFileSync` + `JSON.parse`.
- Test `extractNpmMeta` with:
  - `npm-moment.json` → `deprecated` field is a non-empty string.
  - `npm-lodash.json` → `deprecated` is null, `lastPublished` is a valid ISO date.
  - `npm-tslint.json` → `deprecated` is a non-empty string.
- Test `extractPypiMeta` with:
  - `pypi-requests.json` → `yanked` is false, `lastPublished` is a valid ISO date.
  - `pypi-flask.json` → `latestVersion` is a non-empty string.
- Test `RegistryError` construction: verify `{ error: true, reason: string, status: number | null }` shape.

No live network calls in any test.

**Done when:** `node --test test/registry.test.js` exits 0.

---

## Phase 4 — Analyzer + Scorer + Tests

### Task 7 — Implement `lib/analyze.js`

**Requirements:** REQ-05

- Implement `analyzePackage(ref, meta, asOf)` following the priority ordering in design.md.
- Implement `analyzeAll(refs, metaMap, asOf)` as a simple `refs.map(r => analyzePackage(r, metaMap.get(r.name), asOf))`.
- The `asOf` parameter defaults to `new Date()` but must be injectable.
- Export both functions.
- Each `PackageFinding` must have a non-empty `evidence` string; assert this in the implementation.

**Done when:** all tests in Task 8 pass.

### Task 8 — Write tests for `lib/analyze.js`

**Requirements:** REQ-05

Create `test/analyze.test.js`.

Fixed-date tests (use `asOf = new Date('2026-11-08')`):
- npm package with `deprecated: "Use X instead"` → `status: 'DEPRECATED'`, evidence contains the message.
- PyPI package with `yanked: true` → `status: 'DEPRECATED'`.
- PyPI package with `"Development Status :: 7 - Inactive"` classifier → `status: 'DEPRECATED'`.
- Package with `lastPublished` 36 months before asOf → `status: 'ABANDONED'`.
- Package with `lastPublished` exactly 25 months before asOf → `status: 'ABANDONED'`.
- Package with `lastPublished` exactly 24 months before asOf → `status: 'ABANDONED'` (boundary: >24 months means the threshold is exclusive; verify the chosen boundary exactly).
- Package with `lastPublished` 18 months before asOf → `status: 'STALE'`.
- Package with `lastPublished` exactly 12 months before asOf → boundary test.
- Package with `lastPublished` 6 months before asOf → `status: 'HEALTHY'`.
- `RegistryError` input → `status: 'UNKNOWN'`, evidence = error reason.

Property-based test: for any generated `PackageFinding`, `evidence.length > 0`.

**Done when:** `node --test test/analyze.test.js` exits 0.

### Task 9 — Implement `lib/score.js`

**Requirements:** REQ-06

- Implement `computeScore(findings)` with the formula from design.md.
- Return a `ScoreResult` with `score` as an integer (use `Math.max(0, Math.round(100 - penalty))`).
- Count each status bucket; populate `summary`.

**Done when:** all tests in Task 10 pass.

### Task 10 — Write tests for `lib/score.js`

**Requirements:** REQ-06

Create `test/score.test.js`.

Fixed cases:
- Empty findings → `{ score: 100, summary: { total: 0, ... } }`.
- All healthy → score 100.
- 1 deprecated → score 80.
- 5 deprecated → score 0.
- 1 abandoned → score 90.
- 10 abandoned → score 0.
- 1 stale → score 97.
- 1 unknown → score 98.
- Mixed: 2 deprecated + 1 abandoned + 3 stale → `100 - (40 + 10 + 9) = 41`.

Property-based tests:
- `computeScore(findings).score` is always in [0, 100].
- `computeScore([]).score === 100`.
- Adding a non-HEALTHY finding to a list weakly decreases the score.

**Done when:** `node --test test/score.test.js` exits 0.

---

## Phase 5 — Suggestions + Report + Tests

### Task 11 — Implement `lib/suggest.js`

**Requirements:** REQ-07

- Define the `REPLACEMENTS` map as a plain object constant at the top of the file.
- Implement `applySuggestions(findings)`.
- Never mutate input objects; return a new array with new objects where a suggestion is added.
- Only add `suggestion` to DEPRECATED or ABANDONED findings whose name is in the map.
- HEALTHY / STALE / UNKNOWN findings must not receive a `suggestion` property at all (not even `undefined`).

**Done when:** all tests in Task 12 pass.

### Task 12 — Write tests for `lib/suggest.js`

**Requirements:** REQ-07

Create `test/suggest.test.js`.

- `moment` with `status: 'DEPRECATED'` → `suggestion: 'dayjs'`.
- `moment` with `status: 'ABANDONED'` → `suggestion: 'dayjs'`.
- `moment` with `status: 'HEALTHY'` → no `suggestion` key.
- `request` with `status: 'DEPRECATED'` → suggestion present.
- `unknown-package` with any status → no `suggestion` key.
- `applySuggestions` does not mutate the input array or its objects.
- Output array length === input array length.

**Done when:** `node --test test/suggest.test.js` exits 0.

### Task 13 — Implement `lib/report.js`

**Requirements:** REQ-08, REQ-09, REQ-13

- Implement `toJson(findings, scoreResult, meta)` → JSON string matching the `Report` shape.
  - `analysedAt`: `meta.analysedAt.toISOString()`.
  - `manifest`: `meta.manifest`.
  - Include `warnings` array only if `meta.warnings` is non-empty.
- Implement `toText(findings, scoreResult, meta)` → formatted text string.
  - Header: `Boneyard Report — <manifest> — <date>`.
  - Score line: `Health Score: <score>/100`.
  - Findings grouped: DEPRECATED → ABANDONED → STALE → UNKNOWN → HEALTHY.
  - Each finding: `[STATUS] <name> (<ecosystem>/<group>)\n  <evidence>`.
  - Suggestion (if any): `  → Consider: <suggestion>`.
  - Warnings: `[WARN] <warning>`.
  - Footer summary: `Summary: <total> packages — <n> deprecated, <n> abandoned, <n> stale, <n> unknown, <n> healthy`.

**Done when:** all tests in Task 14 pass.

### Task 14 — Write tests for `lib/report.js`

**Requirements:** REQ-08, REQ-09, REQ-13

Create `test/report.test.js`.

- `toJson` with a known fixture list → `JSON.parse(result)` succeeds, top-level keys present, `findings` array length matches.
- `toJson` with empty findings → `findings: []`, `score: 100`.
- `toJson` with warnings → `warnings` array present in output.
- `toJson` with no warnings → `warnings` key absent.
- `toText` with deprecated + healthy package → DEPRECATED section appears before HEALTHY.
- `toText` with a suggestion → `→ Consider:` line present.
- `toText` with warnings → `[WARN]` lines present.
- `toText` score line contains `Health Score: 80/100` format.
- `toText` footer contains `Summary:`.

**Done when:** `node --test test/report.test.js` exits 0.

---

## Phase 6 — CLI

### Task 15 — Implement `bin/boneyard.js`

**Requirements:** REQ-01, REQ-02, REQ-03, REQ-04, REQ-05, REQ-06, REQ-07, REQ-08, REQ-09, REQ-10

- Parse `process.argv` for: manifest path (positional), `--format text|json` (default: text), `--output <file>` (default: stdout), `--dev` (include devDependencies, default: true).
- Detect manifest format from filename extension (`.json` → npm; `.txt` → pip) or `--format` flag.
- Read manifest file with `fs.readFileSync`; catch `ENOENT` → print error, exit 2.
- Call `parse`, `registry.fetchAll`, `analyze.analyzeAll`, `score.computeScore`, `suggest.applySuggestions`, `report.toJson` or `report.toText`.
- Write output to `--output` file or stdout.
- Exit codes: 1 if any DEPRECATED finding; 2 on parse/file error; 3 on unexpected error; 0 otherwise.
- Add shebang `#!/usr/bin/env node` as first line.
- Mark executable: `chmod +x bin/boneyard.js`.
- Print `--help` usage message if no arguments are given.

**Done when:** manual smoke test with a small `package.json` and `requirements.txt` passes; output is correct; exit codes are correct.

---

## Phase 7 — Web Layer

### Task 16 — Implement `api/analyze.js`

**Requirements:** REQ-11, REQ-12

- Export a default async function `handler(req, res)` compatible with Vercel's Node.js runtime.
- Accept only `POST` requests; return 405 for all others.
- Parse the JSON request body (`req.body` if already parsed, or read and parse the raw body stream).
- Validate `manifest` (non-empty string) and `format` (`"npm"` or `"pip"`); return 400 on validation failure.
- Run the full analysis pipeline (parse → fetchAll → analyzeAll → computeScore → applySuggestions → toJson).
- Return HTTP 200 with `Content-Type: application/json` and the report JSON.
- Return HTTP 500 with a JSON error body on unexpected errors; never leak stack traces.

**Done when:** manually testable via `curl` against `server.js`.

### Task 17 — Implement `server.js`

**Requirements:** REQ-11, REQ-12

- Create a `node:http` server.
- Route `POST /api/analyze` to the logic from `api/analyze.js` (import and call the same handler function).
- Serve all other requests as static files from `public/`, with correct `Content-Type` headers for `.html`, `.css`, `.js`.
- Return 404 for unknown paths.
- Listen on `process.env.PORT ?? 3000`.
- Log the listening URL to stderr on startup.

**Done when:** `node server.js` starts, serves `public/index.html` at `/`, and `curl -X POST /api/analyze` with a valid body returns a JSON report.

### Task 18 — Implement the web UI (`public/`)

**Requirements:** REQ-11

- `public/index.html`: semantic HTML5, `<textarea id="manifest">`, `<select id="format">` with options `package.json` / `requirements.txt`, `<button id="analyse">Analyse</button>`, `<div id="results">`.
- `public/app.js`:
  - On button click, POST `{ manifest: textarea.value, format: "npm"|"pip" }` to `/api/analyze`.
  - On success, render the score prominently and findings grouped by status.
  - On error, display the error message from the API response.
  - No `eval`, no `innerHTML` for user data (use `textContent` or `createElement`).
- `public/style.css`: minimal, readable styles; colour-code status badges (DEPRECATED = red, ABANDONED = orange, STALE = yellow, HEALTHY = green, UNKNOWN = grey).
- Verify the page works with JavaScript disabled for the form (graceful degradation is a nice-to-have; core functionality requires JS).
- Accessibility: form elements must have labels; results section must have an ARIA live region.

**Done when:** full end-to-end manual test in a browser; paste a `package.json`, submit, see report.

---

## Phase 8 — README and Final Verification

### Task 19 — Write `README.md`

- Title and one-paragraph description.
- Skeleton Crew / Kiroween 2026 badge / note.
- Requirements: Node.js 20+, zero npm install needed.
- Installation: `npm install -g .` or `npx boneyard`.
- CLI usage: basic example, `--format`, `--output`, exit codes table.
- Web UI: `node server.js`, then open browser.
- Deploy to Vercel: one-sentence note.
- How verdicts work: brief explanation of DEPRECATED / ABANDONED / STALE / HEALTHY / UNKNOWN.
- Health score formula (one paragraph).
- Contributing: how to add a replacement mapping, how to record fixtures.

### Task 20 — Final verification

- Run `node --test` → all tests pass, exit 0.
- Run `node bin/boneyard.js package.json` against the project's own `package.json` → report printed, exit 0 (no deprecated deps).
- Run with a synthetic `package.json` containing `"moment": "*"` → report shows DEPRECATED, exit 1.
- Run with an invalid JSON file → exit 2.
- Run `node server.js` and open `http://localhost:3000` → UI loads and analysis works end-to-end.
- Confirm no file under `lib/` (except `registry.js`) contains the string `fetch` or `require('node:http')`.
- Confirm `package.json` has empty `dependencies` and `devDependencies`.
- Confirm `.kiro/` is tracked by git (`git ls-files .kiro/` returns files).
