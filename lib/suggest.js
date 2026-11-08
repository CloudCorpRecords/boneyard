'use strict';

/**
 * Curated replacements map.
 *
 * Keys are exact package names (lowercased, matching what parse.js normalises to).
 * Values are brief, human-readable suggestion strings.
 *
 * Rules for inclusion:
 *  - The source package must be officially deprecated, unmaintained, or
 *    have a widely-accepted successor in the ecosystem.
 *  - The suggested replacement must itself be actively maintained.
 *  - No algorithmic search — every entry is reviewed and hand-curated.
 *
 * @type {Record<string, string>}
 */
const REPLACEMENTS = {
  // npm packages
  moment:        'dayjs (or date-fns) — moment is in legacy maintenance mode',
  request:       'undici (built into Node 18+) or node-fetch',
  'node-sass':   'sass (the official Dart Sass package)',
  tslint:        'eslint with @typescript-eslint plugins',
  jade:          'pug (jade was renamed to pug)',
  bower:         'npm workspaces, yarn workspaces, or pnpm',
  coffeescript:  'TypeScript — first-class JS with types and tooling',
  'gulp-util':   'gulp v4 built-ins (log, colors) or individual packages (fancy-log, ansi-colors)',
  'har-validator': 'joi or ajv for schema validation',
  querystring:   "node:querystring (built-in) or URLSearchParams — querystring is deprecated in Node.js",
  'left-pad':    "String.prototype.padStart() — built into JS since ES2017",
  'request-promise': 'undici or node-fetch (request-promise is abandoned alongside request)',
  xmlhttprequest: 'node built-in fetch (global since Node 18) or undici',

  // pip packages
  nose:            'pytest — the modern Python test runner',
  'python-dateutil': 'arrow or pendulum for friendlier date/time handling',
  dateutil:        'arrow or pendulum for friendlier date/time handling',
  distribute:      'setuptools — distribute was merged back into setuptools',
  'pexpect-u':     'pexpect (the maintained fork)',
};

/**
 * Apply the curated replacements map to a list of package findings.
 *
 * Adds a `suggestion` property ONLY to findings whose status is DEPRECATED or
 * ABANDONED AND whose name is present in the REPLACEMENTS map.
 *
 * HEALTHY, STALE, and UNKNOWN findings are returned unchanged (no `suggestion`
 * property, not even undefined).
 *
 * Never mutates the input array or its objects.
 *
 * @param {import('./analyze.js').PackageFinding[]} findings
 * @returns {import('./analyze.js').PackageFinding[]}  New array with suggestion fields added
 */
function applySuggestions(findings) {
  return findings.map((finding) => {
    if (finding.status !== 'DEPRECATED' && finding.status !== 'ABANDONED') {
      return finding;
    }

    const suggestion = REPLACEMENTS[finding.name];
    if (!suggestion) {
      return finding;
    }

    // Return a new object — never mutate the original
    return Object.assign({}, finding, { suggestion });
  });
}

module.exports = { applySuggestions, REPLACEMENTS };
