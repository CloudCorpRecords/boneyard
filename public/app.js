'use strict';

// ─── Sample manifests ─────────────────────────────────────────────────────────

const SAMPLE_NPM = JSON.stringify({
  name: "my-project",
  version: "1.0.0",
  dependencies: {
    "moment":   "^2.29.4",
    "request":  "^2.88.2",
    "dayjs":    "^1.11.10",
    "node-sass":"^9.0.0"
  },
  devDependencies: {
    "tslint":   "^6.1.3"
  }
}, null, 2);

const SAMPLE_PIP =
  "# Python project requirements\n" +
  "requests==2.31.0\n" +
  "flask>=3.0.0\n" +
  "nose==1.3.7\n";

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const manifestEl     = document.getElementById('manifest');
const formatEl       = document.getElementById('format');
const toggleNpmEl    = document.getElementById('toggle-npm');
const togglePipEl    = document.getElementById('toggle-pip');
const sampleNpmEl    = document.getElementById('sample-npm');
const samplePipEl    = document.getElementById('sample-pip');
const analyseBtn     = document.getElementById('analyse-btn');
const loadingEl      = document.getElementById('loading-indicator');
const resultsEl      = document.getElementById('results');

// ─── Ecosystem toggle ─────────────────────────────────────────────────────────

function setEcosystem(eco) {
  formatEl.value = eco;
  if (eco === 'npm') {
    toggleNpmEl.classList.add('active');
    toggleNpmEl.setAttribute('aria-pressed', 'true');
    togglePipEl.classList.remove('active');
    togglePipEl.setAttribute('aria-pressed', 'false');
  } else {
    togglePipEl.classList.add('active');
    togglePipEl.setAttribute('aria-pressed', 'true');
    toggleNpmEl.classList.remove('active');
    toggleNpmEl.setAttribute('aria-pressed', 'false');
  }
}

toggleNpmEl.addEventListener('click', () => setEcosystem('npm'));
togglePipEl.addEventListener('click', () => setEcosystem('pip'));

// ─── Sample buttons ───────────────────────────────────────────────────────────

sampleNpmEl.addEventListener('click', () => {
  setEcosystem('npm');
  manifestEl.value = SAMPLE_NPM;
});

samplePipEl.addEventListener('click', () => {
  setEcosystem('pip');
  manifestEl.value = SAMPLE_PIP;
});

// ─── Rendering helpers ────────────────────────────────────────────────────────

const STATUS_ORDER = ['DEPRECATED', 'ABANDONED', 'STALE', 'UNKNOWN', 'HEALTHY'];

/**
 * Compute a CSS class suffix for the score value.
 * @param {number} score
 * @returns {string}
 */
function scoreClass(score) {
  if (score === 100) return 'score-100';
  if (score >= 80)   return 'score-hi';
  if (score >= 50)   return 'score-mid';
  if (score >= 20)   return 'score-lo';
  return 'score-crit';
}

/**
 * Create an element with optional text content and CSS class.
 * @param {string} tag
 * @param {string} [cls]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Render the score card.
 * @param {object} report
 * @returns {HTMLElement}
 */
function renderScoreCard(report) {
  const card = el('div', 'score-card');

  const circle = el('div', 'score-circle ' + scoreClass(report.score));
  circle.textContent = report.score;
  const circLabel = el('div', 'score-label', '/100');
  const circWrap = el('div');
  circWrap.appendChild(circle);
  circWrap.appendChild(circLabel);
  card.appendChild(circWrap);

  const detail = el('div');
  const s = report.summary;
  const legend = el('div', 'score-legend');

  const stats = [
    { label: 'deprecated', count: s.deprecated, cls: 'deprecated' },
    { label: 'abandoned',  count: s.abandoned,  cls: 'abandoned' },
    { label: 'stale',      count: s.stale,      cls: 'stale' },
    { label: 'unknown',    count: s.unknown,    cls: 'unknown' },
    { label: 'healthy',    count: s.healthy,    cls: 'healthy' },
  ];

  for (const stat of stats) {
    const item = el('div', 'legend-item');
    const count = el('span');
    count.style.color = `var(--${stat.cls})`;
    count.textContent = String(stat.count);
    item.appendChild(count);
    item.appendChild(document.createTextNode(' ' + stat.label));
    legend.appendChild(item);
  }

  const totalLine = el('p', null);
  totalLine.style.cssText = 'font-size:0.82rem;color:var(--text-muted);margin-bottom:0.5rem';
  totalLine.textContent = `${s.total} package${s.total !== 1 ? 's' : ''} analysed`;
  detail.appendChild(totalLine);
  detail.appendChild(legend);
  card.appendChild(detail);

  return card;
}

/**
 * Render a single finding row.
 * @param {object} finding
 * @returns {HTMLElement}
 */
function renderFinding(finding) {
  const row = el('div', 'finding-row');

  const header = el('div', 'finding-header');
  const chip = el('span', `chip chip-${finding.status}`, finding.status);
  const name = el('span', 'finding-name', finding.name);
  const group = el('span', 'finding-group', `(${finding.ecosystem}/${finding.group})`);
  header.appendChild(chip);
  header.appendChild(name);
  header.appendChild(group);
  row.appendChild(header);

  if (finding.evidence) {
    row.appendChild(el('div', 'finding-evidence', finding.evidence));
  }

  if (finding.suggestion) {
    row.appendChild(el('div', 'finding-suggestion', finding.suggestion));
  }

  return row;
}

/**
 * Render the full results section.
 * @param {object} report
 * @returns {DocumentFragment}
 */
function renderReport(report) {
  const frag = document.createDocumentFragment();

  frag.appendChild(renderScoreCard(report));

  // Group findings by status
  const groups = new Map(STATUS_ORDER.map((s) => [s, []]));
  for (const f of report.findings) {
    const bucket = groups.get(f.status);
    if (bucket) bucket.push(f);
  }

  for (const status of STATUS_ORDER) {
    const bucket = groups.get(status);
    if (!bucket || bucket.length === 0) continue;

    const section = el('div', 'status-group');
    const heading = el('div', 'status-heading');
    heading.appendChild(el('span', `chip chip-${status}`, status));
    heading.appendChild(document.createTextNode(` — ${bucket.length} package${bucket.length !== 1 ? 's' : ''}`));
    section.appendChild(heading);

    for (const finding of bucket) {
      section.appendChild(renderFinding(finding));
    }

    frag.appendChild(section);
  }

  // Warnings
  if (Array.isArray(report.warnings) && report.warnings.length > 0) {
    const warnSection = el('div', 'warnings-section');
    warnSection.appendChild(el('div', 'warnings-heading', 'Warnings'));
    for (const w of report.warnings) {
      warnSection.appendChild(el('div', 'warning-item', w));
    }
    frag.appendChild(warnSection);
  }

  return frag;
}

/**
 * Render an error message.
 * @param {string} message
 * @returns {HTMLElement}
 */
function renderError(message) {
  const banner = el('div', 'error-banner');
  banner.appendChild(el('strong', null, 'Error: '));
  banner.appendChild(document.createTextNode(message));
  return banner;
}

// ─── Main analyse handler ─────────────────────────────────────────────────────

analyseBtn.addEventListener('click', async () => {
  const text = manifestEl.value.trim();
  const kind = formatEl.value;

  if (!text) {
    resultsEl.hidden = false;
    resultsEl.innerHTML = '';
    resultsEl.appendChild(renderError('Please paste a manifest before analysing.'));
    return;
  }

  analyseBtn.disabled = true;
  loadingEl.hidden = false;
  resultsEl.hidden = true;
  resultsEl.innerHTML = '';

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Use textContent to avoid XSS — values are plain strings, not HTML
      body: JSON.stringify({ kind, text }),
    });

    const data = await response.json();

    resultsEl.hidden = false;

    if (!response.ok) {
      resultsEl.appendChild(renderError(data.message || 'Analysis failed. Please try again.'));
      return;
    }

    resultsEl.appendChild(renderReport(data));
  } catch (err) {
    resultsEl.hidden = false;
    resultsEl.appendChild(renderError('Network error: could not reach the analysis API.'));
  } finally {
    analyseBtn.disabled = false;
    loadingEl.hidden = true;
  }
});
