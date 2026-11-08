# Boneyard — Requirements

## Introduction

Boneyard is a dependency coroner for JavaScript (npm) and Python (pip) projects. A user supplies a manifest file (`package.json` or `requirements.txt`); Boneyard fetches metadata for each declared dependency from its upstream registry, classifies the package's lifecycle status, computes a project-level health score, and produces a report with optional replacement suggestions.

All verdicts are derived exclusively from registry metadata. Boneyard never invents, guesses, or interpolates data. When a registry is unreachable, the affected package is marked UNKNOWN and the report clearly says so.

---

## Requirements

### REQ-01 — Parse `package.json` dependencies

**User story:** As a JavaScript developer, I want to point Boneyard at my `package.json` so that all my direct dependencies are checked without me having to list them manually.

**Acceptance criteria:**

- WHEN a valid `package.json` file is provided, THE SYSTEM SHALL extract every package name listed under `dependencies`.
- WHEN a valid `package.json` file is provided, THE SYSTEM SHALL extract every package name listed under `devDependencies`.
- WHEN `dependencies` or `devDependencies` is absent from the file, THE SYSTEM SHALL treat it as an empty set and continue without error.
- WHEN the file is not valid JSON, THE SYSTEM SHALL exit with a non-zero status and emit a human-readable parse error message.
- WHEN the file is valid JSON but does not contain a root object, THE SYSTEM SHALL exit with a non-zero status and emit a human-readable error message.
- THE SYSTEM SHALL record, for each extracted package, whether it came from `dependencies` or `devDependencies` so that the report can distinguish them.
- THE SYSTEM SHALL NOT follow transitive dependencies; only direct dependencies are checked.

---

### REQ-02 — Parse `requirements.txt` dependencies

**User story:** As a Python developer, I want to point Boneyard at my `requirements.txt` so that all my declared packages are checked.

**Acceptance criteria:**

- WHEN a `requirements.txt` file is provided, THE SYSTEM SHALL extract the package name from each non-blank, non-comment line.
- WHEN a line contains a version specifier (e.g. `==1.2.3`, `>=2.0`, `~=3.1`), THE SYSTEM SHALL strip the specifier and record only the package name.
- WHEN a line begins with `#`, THE SYSTEM SHALL skip it entirely.
- WHEN a line contains an extras specifier (e.g. `requests[security]`), THE SYSTEM SHALL strip the extras and record only the bare package name (`requests`).
- WHEN a line is a URL requirement (begins with `http://`, `https://`, or `git+`), THE SYSTEM SHALL skip it and record a warning in the report that the line was skipped.
- WHEN the file does not exist or cannot be read, THE SYSTEM SHALL exit with a non-zero status and emit a human-readable error.
- THE SYSTEM SHALL handle both CRLF and LF line endings.

---

### REQ-03 — Fetch npm registry metadata

**User story:** As a user checking a JavaScript project, I want Boneyard to query the npm registry for each dependency so that its verdicts are based on current, authoritative data.

**Acceptance criteria:**

- WHEN checking an npm package, THE SYSTEM SHALL fetch the full document from `https://registry.npmjs.org/<package-name>`.
- WHEN the registry returns HTTP 200, THE SYSTEM SHALL extract: the `deprecated` field on the version object for the `latest` dist-tag; the `dist-tags` map; and the `time` map (ISO timestamps keyed by version string).
- WHEN the registry returns HTTP 404, THE SYSTEM SHALL mark the package as UNKNOWN and record the reason "not found in registry".
- WHEN the fetch times out or the network is unreachable, THE SYSTEM SHALL mark the package as UNKNOWN and record the reason "registry unreachable".
- WHEN the registry returns any other non-200 HTTP status, THE SYSTEM SHALL mark the package as UNKNOWN and record the status code in the reason.
- THE SYSTEM SHALL apply a configurable timeout (default: 10 seconds) to each registry request.
- THE SYSTEM SHALL fetch packages concurrently (up to a configurable concurrency limit, default: 5) to avoid excessive wall-clock time on large manifests.

---

### REQ-04 — Fetch PyPI registry metadata

**User story:** As a user checking a Python project, I want Boneyard to query PyPI for each dependency so that its verdicts are based on authoritative data.

**Acceptance criteria:**

- WHEN checking a PyPI package, THE SYSTEM SHALL fetch the JSON document from `https://pypi.org/pypi/<package-name>/json`.
- WHEN the registry returns HTTP 200, THE SYSTEM SHALL extract: `info.version` (latest version string); `info.yanked` (boolean); `info.yanked_reason` (string or null); the release date of the latest version from the `releases` map (the upload_time of the first file for that version); and the deprecated classifier if present in `info.classifiers`.
- WHEN the registry returns HTTP 404, THE SYSTEM SHALL mark the package as UNKNOWN with reason "not found in registry".
- WHEN the fetch times out or the network is unreachable, THE SYSTEM SHALL mark the package as UNKNOWN with reason "registry unreachable".
- WHEN the registry returns any other non-200 HTTP status, THE SYSTEM SHALL mark the package as UNKNOWN with reason including the status code.
- THE SYSTEM SHALL apply the same timeout and concurrency limits as for npm (REQ-03).

---

### REQ-05 — Classify each package

**User story:** As a developer reading the report, I want each package to carry a clear, evidence-backed status label so that I know exactly what action, if any, is needed.

**Acceptance criteria:**

- WHEN the npm registry's `deprecated` field on the resolved version is a non-empty string, THE SYSTEM SHALL classify the package as DEPRECATED and include the deprecation message in the finding.
- WHEN the PyPI package has `info.yanked === true`, THE SYSTEM SHALL classify it as DEPRECATED and include `info.yanked_reason` (if present) in the finding.
- WHEN the PyPI package's `info.classifiers` contains a string matching `"Development Status :: 7 - Inactive"`, THE SYSTEM SHALL classify the package as DEPRECATED.
- WHEN a package is not DEPRECATED and its last release date is more than 24 months before the analysis date, THE SYSTEM SHALL classify the package as ABANDONED.
- WHEN a package is not DEPRECATED and its last release date is between 12 and 24 months before the analysis date (inclusive), THE SYSTEM SHALL classify the package as STALE.
- WHEN a package is not DEPRECATED, ABANDONED, or STALE, THE SYSTEM SHALL classify it as HEALTHY.
- WHEN the registry call for a package failed for any reason (REQ-03, REQ-04), THE SYSTEM SHALL classify it as UNKNOWN.
- THE SYSTEM SHALL record, alongside each classification, the raw evidence used: the deprecated message or yanked reason, the last release date, or the error description for UNKNOWN.

---

### REQ-06 — Compute a project health score

**User story:** As a developer or tech lead, I want a single 0–100 score for my project's dependency health so that I can track improvement over time and communicate risk quickly.

**Acceptance criteria:**

- WHEN analysis is complete, THE SYSTEM SHALL compute a health score in the range [0, 100] inclusive.
- THE SYSTEM SHALL use the following weighted formula:
  - Each DEPRECATED package contributes **−20 points** to a penalty accumulator.
  - Each ABANDONED package contributes **−10 points**.
  - Each STALE package contributes **−3 points**.
  - Each UNKNOWN package contributes **−2 points**.
  - Score = max(0, 100 − total_penalty).
- THE SYSTEM SHALL include the score in both the JSON and text reports.
- THE SYSTEM SHALL include a breakdown of how many packages fall into each status category alongside the score.
- WHEN all packages are HEALTHY, THE SYSTEM SHALL return a score of 100.
- WHEN the manifest contains zero packages, THE SYSTEM SHALL return a score of 100.

---

### REQ-07 — Suggest maintained replacements

**User story:** As a developer whose project has deprecated or abandoned packages, I want Boneyard to suggest well-known replacements so I have a starting point for migration.

**Acceptance criteria:**

- THE SYSTEM SHALL maintain a curated, hard-coded replacements map. The map MUST include at minimum:
  - `moment` → `dayjs` (npm)
  - `request` → `undici` or `node-fetch` (npm)
  - `node-sass` → `sass` (npm)
  - `tslint` → `eslint` (npm)
- WHEN a package's name appears in the replacements map AND its status is DEPRECATED or ABANDONED, THE SYSTEM SHALL include the suggested replacement in the finding.
- WHEN a package's name does not appear in the replacements map, THE SYSTEM SHALL NOT include a suggestion field; it SHALL NOT leave the field null or empty — it must be absent.
- THE SYSTEM SHALL NOT suggest a replacement for HEALTHY, STALE, or UNKNOWN packages, even if a mapping exists.
- THE SYSTEM SHALL NOT algorithmically search registries for replacements; all suggestions come from the curated map only.

---

### REQ-08 — Produce a JSON report

**User story:** As a CI pipeline or tool integrator, I want Boneyard to emit machine-readable JSON so that I can parse and act on the results programmatically.

**Acceptance criteria:**

- WHEN the `--format json` flag is passed (or the output filename ends in `.json`), THE SYSTEM SHALL write a JSON document to the specified output (file or stdout).
- THE JSON document SHALL conform to the following top-level shape:
  ```json
  {
    "analysedAt": "<ISO 8601 timestamp>",
    "manifest": "<path to the manifest file>",
    "score": 0,
    "summary": { "total": 0, "deprecated": 0, "abandoned": 0, "stale": 0, "healthy": 0, "unknown": 0 },
    "findings": []
  }
  ```
- Each entry in `findings` SHALL include: `name`, `ecosystem` (`"npm"` or `"pip"`), `status`, `evidence`, and optionally `suggestion`.
- THE SYSTEM SHALL produce valid JSON that can be parsed by `JSON.parse` without error.

---

### REQ-09 — Produce a human-readable text report

**User story:** As a developer running Boneyard in a terminal, I want a clear, readable report so that I can scan the results at a glance.

**Acceptance criteria:**

- WHEN no `--format` flag is given, THE SYSTEM SHALL write a human-readable text report to stdout.
- THE text report SHALL begin with a header showing the manifest path, the analysis timestamp, and the health score.
- THE text report SHALL group findings by status (DEPRECATED first, then ABANDONED, STALE, UNKNOWN, HEALTHY).
- WHEN a finding has a suggestion, THE SYSTEM SHALL print it on the line immediately following the package finding, prefixed with `  → Consider:`.
- WHEN a finding has evidence (a deprecation message, last-release date, or error reason), THE SYSTEM SHALL print it on the line following the package name.
- THE text report SHALL end with a one-line summary of counts by status.

---

### REQ-10 — CLI exit codes

**User story:** As a CI pipeline author, I want a non-zero exit code when deprecated packages are found so that I can fail the build automatically.

**Acceptance criteria:**

- WHEN at least one package is classified DEPRECATED, THE SYSTEM SHALL exit with code `1`.
- WHEN no package is DEPRECATED (even if some are ABANDONED, STALE, or UNKNOWN), THE SYSTEM SHALL exit with code `0`.
- WHEN the manifest file cannot be parsed (REQ-01, REQ-02), THE SYSTEM SHALL exit with code `2`.
- WHEN an unexpected internal error occurs, THE SYSTEM SHALL exit with code `3` and print the error to stderr.

---

### REQ-11 — Web UI accepts a pasted manifest

**User story:** As a developer who does not want to install anything, I want to paste my manifest into a web page and get the same report in my browser.

**Acceptance criteria:**

- WHEN a user visits the web UI, THE SYSTEM SHALL present a `<textarea>` for pasting the manifest content, a selector for the manifest format (`package.json` or `requirements.txt`), and a submit button.
- WHEN the user submits the form, THE SYSTEM SHALL POST the manifest content and format to `/api/analyze` and display the results without a full page reload.
- THE web UI SHALL display the health score prominently.
- THE web UI SHALL render findings grouped by status, matching the structure of the text report.
- WHEN the API returns an error, THE SYSTEM SHALL display a human-readable error message.
- THE web UI SHALL function without JavaScript frameworks, bundlers, or CDN-hosted libraries.

---

### REQ-12 — Web API accepts and returns JSON

**User story:** As an integrator, I want a simple HTTP API so that I can call Boneyard from any environment that can make HTTP requests.

**Acceptance criteria:**

- THE SYSTEM SHALL expose a `POST /api/analyze` endpoint.
- WHEN the request body is `{ "manifest": "<string>", "format": "npm" | "pip" }`, THE SYSTEM SHALL parse the manifest string, run the full analysis pipeline, and return the JSON report (same shape as REQ-08).
- WHEN the `manifest` field is missing or empty, THE SYSTEM SHALL return HTTP 400 with a JSON error body.
- WHEN the `format` field is not `"npm"` or `"pip"`, THE SYSTEM SHALL return HTTP 400 with a JSON error body.
- THE SYSTEM SHALL return `Content-Type: application/json` on all responses from this endpoint.

---

### REQ-13 — Registry unreachable: graceful degradation

**User story:** As a developer in a restricted network environment, I want Boneyard to still produce a useful partial report even when it cannot reach the registry.

**Acceptance criteria:**

- WHEN all registry calls fail, THE SYSTEM SHALL still produce a complete report with every package marked UNKNOWN.
- WHEN some registry calls succeed and others fail, THE SYSTEM SHALL include findings for all packages — UNKNOWN for those that failed, classified for those that succeeded.
- THE SYSTEM SHALL include a `warnings` array in the JSON report listing each package that could not be fetched and the reason.
- THE SYSTEM SHALL print warnings in the text report, clearly distinguished from findings (e.g., prefixed with `[WARN]`).
- WHEN all packages are UNKNOWN, THE SYSTEM SHALL exit with code `0` (not `1`), since no package has been confirmed DEPRECATED.
