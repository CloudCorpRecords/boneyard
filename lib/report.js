'use strict';

/**
 * Status ordering for grouped text output.
 * Earlier in the array = printed first.
 * @type {string[]}
 */
const STATUS_ORDER = ['DEPRECATED', 'ABANDONED', 'STALE', 'UNKNOWN', 'HEALTHY'];

/**
 * Produce the JSON report string.
 *
 * The returned string deserialises to a `Report` object with this shape:
 * ```json
 * {
 *   "analysedAt": "<ISO 8601>",
 *   "manifest":   "<path or '<pasted>'>",
 *   "score":      0,
 *   "summary":    { "total": 0, "deprecated": 0, "abandoned": 0, "stale": 0, "healthy": 0, "unknown": 0 },
 *   "findings":   [],
 *   "warnings":   []   // omitted when empty
 * }
 * ```
 *
 * @param {import('./analyze.js').PackageFinding[]} findings
 * @param {import('./score.js').ScoreResult} scoreResult
 * @param {{ manifest: string, analysedAt: Date, warnings?: string[] }} meta
 * @returns {string}  Serialised JSON
 */
function toJson(findings, scoreResult, meta) {
  /** @type {Record<string, any>} */
  const report = {
    analysedAt: meta.analysedAt.toISOString(),
    manifest:   meta.manifest,
    score:      scoreResult.score,
    summary:    scoreResult.summary,
    findings:   findings.map((f) => {
      /** @type {Record<string, any>} */
      const entry = {
        name:          f.name,
        ecosystem:     f.ecosystem,
        group:         f.group,
        status:        f.status,
        evidence:      f.evidence,
        lastPublished: f.lastPublished,
      };
      if (f.suggestion !== undefined) {
        entry.suggestion = f.suggestion;
      }
      return entry;
    }),
  };

  // Only include warnings when non-empty
  if (Array.isArray(meta.warnings) && meta.warnings.length > 0) {
    report.warnings = meta.warnings;
  }

  return JSON.stringify(report, null, 2);
}

/**
 * Produce a human-readable text report.
 *
 * Format:
 * ```
 * ─────────────────────────────────────────────────────────
 * Boneyard Report — <manifest> — <date>
 * Health Score: <score>/100
 * ─────────────────────────────────────────────────────────
 *
 * ── DEPRECATED ──────────────────────────────────────────
 * [DEPRECATED] moment (npm/dependencies)
 *   moment is no longer maintained. Use dayjs instead.
 *   → Consider: dayjs (or date-fns) — moment is in legacy maintenance mode
 *
 * ── HEALTHY ─────────────────────────────────────────────
 * [HEALTHY] dayjs (npm/dependencies)
 *   Last release 2024-01-15T00:00:00.000Z
 *
 * [WARN] Skipped URL requirement: https://example.com/pkg.tar.gz
 *
 * Summary: 2 packages — 1 deprecated, 0 abandoned, 0 stale, 0 unknown, 1 healthy
 * ```
 *
 * @param {import('./analyze.js').PackageFinding[]} findings
 * @param {import('./score.js').ScoreResult} scoreResult
 * @param {{ manifest: string, analysedAt: Date, warnings?: string[] }} meta
 * @returns {string}
 */
function toText(findings, scoreResult, meta) {
  const lines = [];
  const hr = '─'.repeat(60);
  const dateStr = meta.analysedAt.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');

  lines.push(hr);
  lines.push(`Boneyard Report — ${meta.manifest} — ${dateStr}`);
  lines.push(`Health Score: ${scoreResult.score}/100`);
  lines.push(hr);

  // Group findings by status in the canonical order
  const groups = /** @type {Map<string, import('./analyze.js').PackageFinding[]>} */ (new Map());
  for (const status of STATUS_ORDER) {
    groups.set(status, []);
  }
  for (const f of findings) {
    const bucket = groups.get(f.status);
    if (bucket) bucket.push(f);
  }

  for (const status of STATUS_ORDER) {
    const bucket = groups.get(status);
    if (!bucket || bucket.length === 0) continue;

    lines.push('');
    lines.push(`── ${status} ${'─'.repeat(Math.max(0, 56 - status.length))}`);

    for (const f of bucket) {
      lines.push(`[${f.status}] ${f.name} (${f.ecosystem}/${f.group})`);
      lines.push(`  ${f.evidence}`);
      if (f.suggestion !== undefined) {
        lines.push(`  → Consider: ${f.suggestion}`);
      }
    }
  }

  // Warnings
  const warnings = Array.isArray(meta.warnings) ? meta.warnings : [];
  if (warnings.length > 0) {
    lines.push('');
    for (const w of warnings) {
      lines.push(`[WARN] ${w}`);
    }
  }

  // Summary footer
  const s = scoreResult.summary;
  lines.push('');
  lines.push(
    `Summary: ${s.total} package${s.total !== 1 ? 's' : ''} — ` +
    `${s.deprecated} deprecated, ${s.abandoned} abandoned, ` +
    `${s.stale} stale, ${s.unknown} unknown, ${s.healthy} healthy`
  );

  return lines.join('\n') + '\n';
}

module.exports = { toJson, toText };
