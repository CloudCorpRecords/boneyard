# Boneyard — Design

## Architecture Overview

Boneyard is structured as a pure core library with three thin I/O entry points that share it.

```
                   ┌──────────────────────────────────────┐
                   │            lib/ (pure core)           │
  manifest file ──►│  parse → registry → analyze → score  │──► findings + score
   (string)        │            ↓ suggest ↓ report         │──► JSON / text
                   └──────────────────────────────────────┘
                          ▲              ▲              ▲
                   bin/boneyard.js   api/analyze.js   server.js
                   (CLI)             (serverless)     (local HTTP)
```

The three entry points differ only in how they receive a manifest (from a file path, from an HTTP request body, or from a WebSocket) and how they emit a report (to stdout, to an HTTP response). They contain zero analysis logic.

---

## Module Breakdown (`lib/`)

### `lib/parse.js`

**Purpose:** Convert a raw manifest string into a normalised array of `PackageRef` objects.

**Exports:**
```js
/**
 * @param {string} source  Raw contents of a package.json file
 * @returns {PackageRef[]}
 * @throws {ParseError}
 */
function parseNpm(source) {}

/**
 * @param {string} source  Raw contents of a requirements.txt file
 * @returns {{ packages: PackageRef[], warnings: string[] }}
 */
function parsePip(source) {}
```

**`PackageRef` shape:**
```js
{
  name: string,       // bare package name, normalised to lowercase
  ecosystem: 'npm' | 'pip',
  group: 'dependencies' | 'devDependencies' | 'direct'  // 'direct' for pip
}
```

`parseNpm` throws a `ParseError` (a plain `Error` subclass with `code: 'PARSE_ERROR'`) for invalid JSON or a non-object root. `parsePip` never throws; skipped lines (URLs, blanks, comments) are reported in the returned `warnings` array.

---

### `lib/registry.js`

**Purpose:** Fetch raw metadata from npm and PyPI. The only module allowed to call `fetch`.

**Exports:**
```js
/**
 * @param {string} name  Package name
 * @param {{ timeout?: number }} [opts]
 * @returns {Promise<NpmRawMeta | RegistryError>}
 */
async function fetchNpm(name, opts) {}

/**
 * @param {string} name  Package name
 * @param {{ timeout?: number }} [opts]
 * @returns {Promise<PypiRawMeta | RegistryError>}
 */
async function fetchPypi(name, opts) {}

/**
 * Fetch multiple packages concurrently with a concurrency cap.
 * @param {PackageRef[]} refs
 * @param {{ timeout?: number, concurrency?: number }} [opts]
 * @returns {Promise<Map<string, NpmRawMeta | PypiRawMeta | RegistryError>>}
 */
async function fetchAll(refs, opts) {}
```

**`NpmRawMeta` shape** (derived from `https://registry.npmjs.org/<name>`):
```js
{
  name: string,
  latestVersion: string,           // from dist-tags.latest
  deprecated: string | null,       // from versions[latest].deprecated
  distTags: Record<string, string>,
  lastPublished: string,           // ISO date string, from time[latestVersion]
  rawTime: Record<string, string>  // full time map, for evidence
}
```

**`PypiRawMeta` shape** (derived from `https://pypi.org/pypi/<name>/json`):
```js
{
  name: string,
  latestVersion: string,        // info.version
  yanked: boolean,              // info.yanked
  yankedReason: string | null,  // info.yanked_reason
  lastPublished: string,        // ISO date of latest version's first file upload_time
  classifiers: string[]         // info.classifiers
}
```

**`RegistryError` shape:**
```js
{
  error: true,
  reason: string,   // human-readable; e.g. "registry unreachable", "not found in registry", "HTTP 429"
  status: number | null  // HTTP status if available
}
```

`fetchAll` uses a simple semaphore (a counter + promise queue, ~20 lines) to cap concurrency. No third-party queue libraries.

**Error handling in `registry.js`:**
- Network errors (DNS failure, connection refused, `AbortController` timeout) → `RegistryError` with `reason: "registry unreachable"`.
- HTTP 404 → `RegistryError` with `reason: "not found in registry"`.
- HTTP 5xx / other → `RegistryError` with `reason: "HTTP <status>"`.
- JSON parse failure on a 200 response → `RegistryError` with `reason: "malformed registry response"`.
- All errors return a value; `fetchNpm` and `fetchPypi` never throw.

---

### `lib/analyze.js`

**Purpose:** Classify each package from its raw metadata into a `PackageFinding`.

**Exports:**
```js
/**
 * @param {PackageRef} ref
 * @param {NpmRawMeta | PypiRawMeta | RegistryError} meta
 * @param {Date} [asOf]   Analysis date (defaults to now; injectable for tests)
 * @returns {PackageFinding}
 */
function analyzePackage(ref, meta, asOf) {}

/**
 * @param {PackageRef[]} refs
 * @param {Map<string, NpmRawMeta | PypiRawMeta | RegistryError>} metaMap
 * @param {Date} [asOf]
 * @returns {PackageFinding[]}
 */
function analyzeAll(refs, metaMap, asOf) {}
```

**`PackageFinding` shape:**
```js
{
  name: string,
  ecosystem: 'npm' | 'pip',
  group: 'dependencies' | 'devDependencies' | 'direct',
  status: 'DEPRECATED' | 'ABANDONED' | 'STALE' | 'HEALTHY' | 'UNKNOWN',
  evidence: string,        // human-readable; what drove the verdict
  lastPublished: string | null,  // ISO date or null for UNKNOWN
  suggestion: string | undefined // absent unless provided by suggest.js
}
```

**Classification logic (applied in this priority order):**

1. If `meta.error === true` → `UNKNOWN`, evidence = `meta.reason`.
2. If `meta.deprecated` (npm) is a non-empty string → `DEPRECATED`, evidence = the deprecated message.
3. If `meta.yanked === true` (PyPI) → `DEPRECATED`, evidence = yanked reason or `"yanked by maintainer"`.
4. If `meta.classifiers` includes `"Development Status :: 7 - Inactive"` → `DEPRECATED`, evidence = that classifier string.
5. Compute `monthsSincePublish = months between meta.lastPublished and asOf`.
6. If `monthsSincePublish > 24` → `ABANDONED`, evidence = `"Last release ${lastPublished} (${monthsSincePublish} months ago)"`.
7. If `monthsSincePublish > 12` → `STALE`, evidence = same pattern.
8. Otherwise → `HEALTHY`, evidence = `"Last release ${lastPublished}"`.

The `asOf` parameter makes all time comparisons testable without mocking `Date.now()`.

---

### `lib/score.js`

**Purpose:** Compute the 0–100 project health score from a list of findings.

**Exports:**
```js
/**
 * @param {PackageFinding[]} findings
 * @returns {ScoreResult}
 */
function computeScore(findings) {}
```

**`ScoreResult` shape:**
```js
{
  score: number,   // integer, 0–100
  summary: {
    total: number,
    deprecated: number,
    abandoned: number,
    stale: number,
    healthy: number,
    unknown: number
  }
}
```

**Scoring formula:**
```
penalty = (deprecated × 20) + (abandoned × 10) + (stale × 3) + (unknown × 2)
score   = max(0, 100 − penalty)
```

The formula is intentionally simple and documentable. Multipliers are chosen so that:
- 5 deprecated packages → score 0 (a project that is actively decomposing).
- 10 abandoned packages → score 0.
- A mix of stale/unknown packages degrades the score gradually without hitting zero.

**Invariants (enforced by tests):**
- Score is always an integer in [0, 100].
- Empty findings → score 100.
- All healthy → score 100.
- Adding any non-HEALTHY package weakly decreases the score.

---

### `lib/suggest.js`

**Purpose:** Apply the curated replacements map.

**Exports:**
```js
/**
 * @param {PackageFinding[]} findings
 * @returns {PackageFinding[]}  New array; original objects not mutated
 */
function applySuggestions(findings) {}
```

**Curated replacements map (initial set, extend as needed):**

| Package | Ecosystem | Suggestion |
|---------|-----------|------------|
| `moment` | npm | `dayjs` |
| `request` | npm | `undici` |
| `node-sass` | npm | `sass` |
| `tslint` | npm | `eslint` |
| `jade` | npm | `pug` |
| `bower` | npm | `use npm workspaces or yarn` |
| `coffeescript` | npm | `typescript` |
| `dateutil` (python-dateutil) | pip | `arrow` |
| `nose` | pip | `pytest` |

`applySuggestions` returns a new array of `PackageFinding` objects. It adds a `suggestion` property only to findings whose `status` is `DEPRECATED` or `ABANDONED` AND whose name is in the map. All other findings are returned unchanged.

---

### `lib/report.js`

**Purpose:** Format a list of findings and a score into the final report formats.

**Exports:**
```js
/**
 * @param {PackageFinding[]} findings
 * @param {ScoreResult} scoreResult
 * @param {{ manifest: string, analysedAt: Date, warnings?: string[] }} meta
 * @returns {string}  JSON string
 */
function toJson(findings, scoreResult, meta) {}

/**
 * @param {PackageFinding[]} findings
 * @param {ScoreResult} scoreResult
 * @param {{ manifest: string, analysedAt: Date, warnings?: string[] }} meta
 * @returns {string}  Human-readable text
 */
function toText(findings, scoreResult, meta) {}
```

`toJson` serialises to the `Report` shape documented in REQ-08. `toText` formats findings grouped by status (DEPRECATED → ABANDONED → STALE → UNKNOWN → HEALTHY), prints the score header, suggestions, warnings, and summary line.

---

## Data Models (Summary)

```
PackageRef {
  name: string
  ecosystem: 'npm' | 'pip'
  group: 'dependencies' | 'devDependencies' | 'direct'
}

RegistryError {
  error: true
  reason: string
  status: number | null
}

NpmRawMeta { name, latestVersion, deprecated, distTags, lastPublished, rawTime }
PypiRawMeta { name, latestVersion, yanked, yankedReason, lastPublished, classifiers }

PackageFinding {
  name: string
  ecosystem: 'npm' | 'pip'
  group: string
  status: 'DEPRECATED' | 'ABANDONED' | 'STALE' | 'HEALTHY' | 'UNKNOWN'
  evidence: string
  lastPublished: string | null
  suggestion?: string
}

ScoreResult {
  score: number
  summary: { total, deprecated, abandoned, stale, healthy, unknown }
}

Report (JSON output) {
  analysedAt: string   // ISO 8601
  manifest: string     // path or "<pasted>"
  score: number
  summary: ScoreResult.summary
  findings: PackageFinding[]
  warnings?: string[]
}
```

---

## Error Handling

| Error type | Where caught | Behaviour |
|---|---|---|
| Invalid JSON in `package.json` | `parse.js` | Throws `ParseError`; CLI catches and exits 2 |
| Non-object root in `package.json` | `parse.js` | Throws `ParseError`; CLI catches and exits 2 |
| URL line in `requirements.txt` | `parse.js` | Adds to `warnings`, skips line; never throws |
| Registry network timeout | `registry.js` | Returns `RegistryError`; package marked UNKNOWN |
| Registry 404 | `registry.js` | Returns `RegistryError`; package marked UNKNOWN |
| Registry 5xx / other | `registry.js` | Returns `RegistryError`; package marked UNKNOWN |
| Malformed registry JSON | `registry.js` | Returns `RegistryError`; package marked UNKNOWN |
| Unexpected error in `analyze.js` / `score.js` | CLI / API layer | Caught at the top level; exit code 3 (CLI) or HTTP 500 (API) |

All errors in `registry.js` are returned as values, not thrown, to keep the pipeline composable without try/catch at every call site.

---

## Testing Strategy

### Unit tests (no network)

Every module in `lib/` except `registry.js` is tested with pure inputs. Fixtures in `test/fixtures/` hold recorded real registry responses and are loaded synchronously with `fs.readFileSync`.

`registry.js` is tested using fixtures: the test calls the parsing/extraction logic inside `registry.js` with pre-loaded JSON, not by calling `fetch`. Since `registry.js` separates the HTTP call from the metadata extraction, extraction can be tested without a network.

### Test file map

| Test file | Tests |
|---|---|
| `test/parse.test.js` | `parseNpm` — valid JSON, missing fields, invalid JSON, scoped packages; `parsePip` — comments, extras, version specifiers, URLs, blank lines, CRLF |
| `test/registry.test.js` | Extraction functions with fixture JSON: `extractNpmMeta`, `extractPypiMeta`; `RegistryError` handling |
| `test/analyze.test.js` | All 5 status paths (DEPRECATED via deprecated flag, DEPRECATED via yanked, DEPRECATED via classifier, ABANDONED, STALE, HEALTHY, UNKNOWN); date boundary conditions at exactly 12 and 24 months |
| `test/score.test.js` | Empty list → 100; all healthy → 100; mixed → correct formula; floor at 0; score is always integer 0-100 |
| `test/suggest.test.js` | Known mapping returns suggestion for DEPRECATED; known mapping does not add suggestion for HEALTHY; unknown package has no suggestion field |
| `test/report.test.js` | `toJson` produces valid JSON matching the schema; `toText` includes score, grouped findings, suggestions, warnings |

### Property-based tests

A small hand-rolled generator (~50 lines in `test/helpers/gen.js`) produces:
- Random arrays of `PackageFinding` objects with arbitrary status distributions.
- Random `requirements.txt`-like strings with mixed comment/blank/URL/package lines.

Properties tested:
- **Score invariants:** `score(findings) ∈ [0, 100]`; `score([]) === 100`; `score(moreDeprecated) <= score(lessDeprecated)`.
- **Parser round-trip:** For any string produced by the pip generator, `parsePip(s).packages.length <= totalNonBlankNonCommentNonUrlLines(s)`.
- **Analyzer completeness:** For any `PackageFinding[]` produced by the generator, every finding has a non-empty `evidence` string.

All property tests run within `node --test` using `node:test`'s `it`/`describe` API. The generator is deterministic (seeded) so failures are reproducible.
