#!/usr/bin/env node
'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const { parseNpm, parsePip, ParseError } = require('../lib/parse.js');
const { fetchAll }                        = require('../lib/registry.js');
const { analyzeAll }                      = require('../lib/analyze.js');
const { computeScore }                    = require('../lib/score.js');
const { applySuggestions }               = require('../lib/suggest.js');
const { toJson, toText }                  = require('../lib/report.js');

// ─── Usage ───────────────────────────────────────────────────────────────────

const USAGE = `
Boneyard — dependency coroner for JS/Python projects

Usage:
  boneyard <manifest>  [options]

Arguments:
  <manifest>    Path to package.json or requirements.txt

Options:
  --json        Output JSON report instead of human-readable text
  --output <f>  Write output to file <f> (default: stdout)
  --npm         Force npm ecosystem (overrides filename detection)
  --pip         Force pip ecosystem (overrides filename detection)
  --help, -h    Show this help message

Exit codes:
  0  Success — no DEPRECATED packages found
  1  At least one DEPRECATED package found
  2  Usage error or file/parse error
  3  Unexpected internal error
`.trim();

// ─── Argument parsing ─────────────────────────────────────────────────────────

/**
 * Parse process.argv into a structured options object.
 *
 * @param {string[]} argv
 * @returns {{ manifest: string|null, json: boolean, output: string|null, ecosystem: 'npm'|'pip'|null, help: boolean }}
 */
function parseArgs(argv) {
  const args = argv.slice(2); // strip 'node' and script path
  let manifestPath = null;
  let json = false;
  let output = null;
  let ecosystem = null;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--npm') {
      ecosystem = 'npm';
    } else if (arg === '--pip') {
      ecosystem = 'pip';
    } else if (arg === '--output') {
      i++;
      output = args[i] || null;
    } else if (!arg.startsWith('-')) {
      manifestPath = arg;
    }
    // Unknown flags are silently ignored for forward compatibility
  }

  return { manifest: manifestPath, json, output, ecosystem, help };
}

// ─── Ecosystem detection ──────────────────────────────────────────────────────

/**
 * Detect the ecosystem from the manifest filename.
 *
 * @param {string} filename
 * @returns {'npm'|'pip'|null}
 */
function detectEcosystem(filename) {
  const base = path.basename(filename).toLowerCase();
  if (base === 'package.json' || base.endsWith('.json')) return 'npm';
  if (base === 'requirements.txt' || base.endsWith('.txt')) return 'pip';
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help || !opts.manifest) {
    process.stdout.write(USAGE + '\n');
    process.exit(opts.help ? 0 : 2);
  }

  // Resolve manifest path
  const manifestPath = path.resolve(opts.manifest);

  // Read the manifest file
  let source;
  try {
    source = fs.readFileSync(manifestPath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      process.stderr.write(`boneyard: error: file not found: ${manifestPath}\n`);
    } else {
      process.stderr.write(`boneyard: error: could not read file: ${err.message}\n`);
    }
    process.exit(2);
  }

  // Detect ecosystem
  const ecosystem = opts.ecosystem || detectEcosystem(manifestPath);
  if (!ecosystem) {
    process.stderr.write(
      `boneyard: error: cannot determine ecosystem from filename "${path.basename(manifestPath)}".\n` +
      `Use --npm or --pip to specify explicitly.\n`
    );
    process.exit(2);
  }

  // Parse the manifest
  let refs;
  let warnings = [];
  try {
    if (ecosystem === 'npm') {
      refs = parseNpm(source);
    } else {
      const parsed = parsePip(source);
      refs = parsed.packages;
      warnings = parsed.warnings;
    }
  } catch (err) {
    if (err instanceof ParseError) {
      process.stderr.write(`boneyard: parse error: ${err.message}\n`);
      process.exit(2);
    }
    process.stderr.write(`boneyard: unexpected error during parsing: ${err.message}\n`);
    process.exit(3);
  }

  // Fetch registry metadata (live)
  let metaMap;
  try {
    metaMap = await fetchAll(refs, { timeout: 15000, concurrency: 5 });
  } catch (err) {
    process.stderr.write(`boneyard: unexpected error fetching registry data: ${err.message}\n`);
    process.exit(3);
  }

  // Build analysis, score, suggestions
  let findings;
  let scoreResult;
  try {
    const rawFindings = analyzeAll(refs, metaMap);
    findings = applySuggestions(rawFindings);
    scoreResult = computeScore(findings);
  } catch (err) {
    process.stderr.write(`boneyard: unexpected error during analysis: ${err.message}\n`);
    process.exit(3);
  }

  // Compose the registry-error warnings
  for (const [name, meta] of metaMap.entries()) {
    if (meta && meta.error === true) {
      warnings.push(`${name}: ${meta.reason}`);
    }
  }

  // Format the report
  const meta = {
    manifest: opts.manifest,
    analysedAt: new Date(),
    warnings,
  };

  let output;
  try {
    // Use JSON if --json flag or if output filename ends in .json
    const useJson = opts.json || (opts.output && opts.output.endsWith('.json'));
    output = useJson ? toJson(findings, scoreResult, meta) : toText(findings, scoreResult, meta);
  } catch (err) {
    process.stderr.write(`boneyard: unexpected error formatting report: ${err.message}\n`);
    process.exit(3);
  }

  // Write output
  try {
    if (opts.output) {
      fs.writeFileSync(opts.output, output, 'utf8');
    } else {
      process.stdout.write(output);
    }
  } catch (err) {
    process.stderr.write(`boneyard: error writing output: ${err.message}\n`);
    process.exit(3);
  }

  // Exit code: 1 if any DEPRECATED finding
  const hasDeprecated = findings.some((f) => f.status === 'DEPRECATED');
  process.exit(hasDeprecated ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`boneyard: fatal: ${err.message}\n${err.stack}\n`);
  process.exit(3);
});
