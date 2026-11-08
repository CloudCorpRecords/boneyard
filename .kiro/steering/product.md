# Boneyard — Product

## What It Is

Boneyard is a **dependency coroner** for JavaScript and Python projects. Given a `package.json` or a `requirements.txt`, Boneyard examines every listed dependency against its upstream registry and delivers a verdict: is this package dead, abandoned, stale, or healthy? It then scores the project's overall dependency health on a 0–100 scale and, where a curated mapping exists, suggests a well-maintained replacement.

Boneyard ships as:
- A **CLI tool** (`boneyard`) that reads a manifest file and writes a report to stdout (text) or a file (JSON).
- A **web UI** (static frontend + serverless API handler) where a user pastes a manifest and receives the same report in the browser.

## Who It Is For

- **Individual developers** who have inherited an old codebase and want to know what they are sitting on.
- **Tech leads and architects** doing dependency audits before a migration or a security review.
- **Open-source maintainers** who want a quick signal on whether their dependency tree has rotted.
- **DevOps / platform teams** who want a lightweight, zero-install check they can drop into a CI pipeline.

Boneyard is not a vulnerability scanner (use `npm audit` / `pip-audit` for that). It is specifically about lifecycle health: deprecation, abandonment, and maintenance activity.

## Skeleton Crew Build Story (Kiroween 2026)

Boneyard was built for the **Kiroween 2026 hackathon** under the **Skeleton Crew** category. The entry is one human directing a Kiro-driven build: the human sets the vision, makes architectural decisions, writes the spec, and reviews every artefact. Kiro writes the code. The human never writes application source directly — the human's contribution is design, judgement, and curation.

This approach is itself a demonstration of Boneyard's subject matter: knowing which parts of your stack are dead weight (manual toil) and which are healthy and active (AI-assisted implementation).

## Product Principles

### Honest signals only
Boneyard **never invents registry data**. Every verdict (DEPRECATED, ABANDONED, STALE, HEALTHY, UNKNOWN) must be derived exclusively from metadata returned by the npm registry or the PyPI JSON API. If a registry call fails or times out, the package is marked UNKNOWN — not guessed at, not interpolated from other packages.

### Every verdict must be traceable
Each finding in the report includes the raw evidence: the `deprecated` field value, the date of the last release, the dist-tag map, or the yanked flag. A user should be able to look at the report and independently verify every verdict without re-running the tool.

### Graceful behaviour when a registry is unreachable
Network failures are a first-class case. If a registry endpoint returns an error or does not respond within the configured timeout, Boneyard marks the affected package(s) as UNKNOWN, continues processing the rest of the manifest, and surfaces a clear warning in the report. It exits with a non-zero status only when there are DEPRECATED packages — not merely because some packages are UNKNOWN.

### Zero third-party dependencies
Boneyard uses nothing from npm or PyPI. This makes it bootstrappable from a bare Node.js 20 install, removes supply-chain risk from the tool itself, and is appropriate for a tool whose job is to audit other people's dependencies.

### Suggestions are curated, not generated
The replacements map is hand-written and conservative. Boneyard only suggests a replacement when the mapping is well-established and the suggested package is itself actively maintained. It never generates suggestions algorithmically or from registry search results.
