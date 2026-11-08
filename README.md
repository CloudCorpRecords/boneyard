# 🦴 Boneyard

**Dependency coroner for JavaScript and Python projects.**

Boneyard examines every package listed in your `package.json` or `requirements.txt`, queries the upstream registry (npm or PyPI), and delivers a verdict: is this package **deprecated**, **abandoned**, **stale**, or **healthy**? It scores the overall health of your dependency tree on a 0–100 scale and, where a curated mapping exists, suggests a well-maintained replacement.

> **Kiroween 2026 — Skeleton Crew** 🎃  
> Built for the Kiroween 2026 hackathon under the Skeleton Crew category.  
> See [Campaign disclosure](#campaign-disclosure) below.

---

## Quickstart

### CLI

```bash
# Install globally
npm install -g .

# Analyse a package.json
boneyard package.json

# Analyse a requirements.txt
boneyard requirements.txt

# Output JSON (e.g. for CI)
boneyard package.json --json

# Write the report to a file
boneyard package.json --output report.txt
boneyard package.json --output report.json   # auto-selects JSON format
```

No `npm install` of third-party packages needed — Boneyard has zero runtime dependencies.

### Web UI

```bash
node server.js
# → Boneyard server listening on http://localhost:3000
```

Open `http://localhost:3000`, paste your manifest, choose the ecosystem, and click **Analyse**.

### Deploy to Vercel

```bash
vercel deploy
```

The `vercel.json` routes `POST /api/analyze` to the serverless handler and serves the UI from `public/`.

---

## How verdicts work

Each package gets exactly one verdict, determined in priority order:

| Verdict | When |
|---------|------|
| **DEPRECATED** | npm's `deprecated` field is set on the latest version, OR the PyPI package is `yanked`, OR its classifiers include `Development Status :: 7 - Inactive` |
| **ABANDONED** | Last release was more than 24 months ago |
| **STALE** | Last release was between 12 and 24 months ago |
| **HEALTHY** | Last release was within the last 12 months |
| **UNKNOWN** | The registry was unreachable or returned an error |

**Honest signals only.** Boneyard never invents, guesses, or interpolates data. Every verdict is backed by raw evidence from the registry — the exact deprecation message, the last release date, or the error reason — printed alongside the finding. If a registry call fails, the package is marked UNKNOWN, not guessed at.

---

## Health score

```
penalty = (deprecated × 20) + (abandoned × 10) + (stale × 3) + (unknown × 2)
score   = max(0, 100 − penalty)
```

A project with 5 deprecated packages scores 0. Ten abandoned packages also scores 0. Stale and unknown packages degrade the score gradually. All-healthy scores 100.

The score is designed to be documentable and explainable: you can reproduce it by hand from the status counts in the report.

---

## Replacement suggestions

Boneyard maintains a small, hand-curated map of deprecated/abandoned packages to well-maintained successors. Suggestions are:

- **Only offered for DEPRECATED or ABANDONED findings** — not for STALE, HEALTHY, or UNKNOWN.
- **Never generated algorithmically** — every entry is reviewed and added by a human.
- **Clearly labelled** in the report as suggestions, not verdicts.

Current mappings include: `moment → dayjs`, `request → undici`, `node-sass → sass`, `tslint → eslint`, `jade → pug`, `nose → pytest`, and more. See `lib/suggest.js` for the full list.

---

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success — no deprecated packages (some may be abandoned, stale, or unknown) |
| `1` | At least one package is **DEPRECATED** |
| `2` | Usage error, file not found, or parse error |
| `3` | Unexpected internal error |

Exit code `1` is the CI gate. Hook it to fail your build when deprecated packages are introduced.

---

## Development

```bash
# Run the full test suite (no network required)
npm test
# or equivalently:
node --test test/**/*.test.js

# Run tests for a single module
node --test test/suggest.test.js

# Start the local web server
node server.js
```

### Adding a replacement mapping

Edit `lib/suggest.js`. Add an entry to the `REPLACEMENTS` object:

```js
'package-name': 'suggested-replacement — brief reason',
```

Rules:
1. The source package must be officially deprecated, abandoned, or have a well-known successor.
2. The suggested package must itself be actively maintained.
3. Use lowercase package names (matching what `parse.js` normalises to).
4. Keep the suggestion string concise and human-readable.

### Recording new fixtures

To add a new package to the test fixture set, run the one-off recording script:

```bash
node scripts/record-fixtures.js
```

This fetches real registry responses and writes them to `test/fixtures/`. Commit the resulting files. Fixtures are never auto-fetched during `npm test`.

---

## API reference

### POST /api/analyze

Request body:
```json
{ "kind": "npm", "text": "<manifest contents>" }
```

`kind` is `"npm"` or `"pip"`. `text` is the raw manifest string.

Response (HTTP 200):
```json
{
  "analysedAt": "2026-11-08T12:00:00.000Z",
  "manifest": "<pasted>",
  "score": 60,
  "summary": { "total": 5, "deprecated": 1, "abandoned": 1, "stale": 1, "healthy": 2, "unknown": 0 },
  "findings": [
    {
      "name": "moment",
      "ecosystem": "npm",
      "group": "dependencies",
      "status": "DEPRECATED",
      "evidence": "moment is legacy; use dayjs instead",
      "lastPublished": "2022-01-01T00:00:00.000Z",
      "suggestion": "dayjs (or date-fns) — moment is in legacy maintenance mode"
    }
  ]
}
```

---

## Built with Kiro

Boneyard was built in a Kiro-driven spec-first workflow:

1. **Steering documents** (`/.kiro/steering/`) set the product vision, tech stack constraints, and architectural principles before any code was written.

2. **Spec** (`/.kiro/specs/boneyard/`) defines numbered requirements with EARS acceptance criteria, a full architecture and data model design, and a task list that maps directly to implementation phases.

3. **Implementation sessions** used Kiro CLI to implement each phase — parsers, registry clients, analyzer, scorer, suggestions, report formatter, CLI, web layer — guided entirely by the spec. The human reviewed each artefact and made architectural decisions; Kiro wrote the code.

The result is a demonstration of Boneyard's own subject matter: identifying dead weight (manual boilerplate) and replacing it with healthy, well-maintained automation (Kiro).

---

## Kiroween 2026 — Skeleton Crew

This project is a Kiroween 2026 hackathon entry under the **Skeleton Crew** category: one human directing an AI-powered build.

### Campaign disclosure

Boneyard was built by a fleet of AI agents coordinating Kiro CLI sessions. **Rene Turcios** is the human entrant who directed the build: setting the product vision, writing the spec and steering documents, making architectural decisions, and reviewing every artefact. All application source code — every `.js` file under `lib/`, `bin/`, `api/`, `public/`, and `server.js` — was written in-session by Kiro, not by the human directly.

---

## License

MIT — see [LICENSE](./LICENSE).
