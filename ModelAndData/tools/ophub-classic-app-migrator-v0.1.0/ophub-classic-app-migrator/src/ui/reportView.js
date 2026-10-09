// Renders a MigrationReport (as JSON) to HTML.
// Used for the results view in the tool and for the standalone report download.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const OUTCOME_LABEL = { copied: 'Copied', mapped: 'Converted', skipped: 'Skipped' };

function widgetNeedsAttention(w) { return w.notes.some((n) => n.severity === 'warn'); }
function pageWarnCount(p) {
  return p.notes.filter((n) => n.severity === 'warn').length + p.widgets.reduce((n, w) => n + w.notes.filter((x) => x.severity === 'warn').length, 0);
}

function notesList(notes) {
  if (!notes.length) return '';
  return `<ul class="notes">${notes.map((n) => `<li class="note note-${n.severity}">${esc(n.text)}</li>`).join('')}</ul>`;
}

function summaryStrip(s) {
  const cells = [
    ['Pages', s.pages], ['Cards', s.cards], ['Queries', s.queries], ['Globals', s.globals],
    ['Plugins copied', s.copied], ['Widgets converted', s.mapped], ['Skipped', s.skipped],
  ];
  return `<dl class="summary">${cells.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
    <div class="${s.warnings ? 'has-warn' : ''}"><dt>To check</dt><dd>${s.warnings}</dd></div></dl>`;
}

function attentionList(r) {
  const items = [];
  for (const n of r.notes) if (n.severity === 'warn') items.push({ where: 'App', text: n.text });
  for (const p of r.pages) {
    for (const n of p.notes) if (n.severity === 'warn') items.push({ where: p.name, text: n.text });
    for (const w of p.widgets) {
      for (const n of w.notes) if (n.severity === 'warn') items.push({ where: `${p.name} › ${w.sourceType}${w.label ? ` (${w.label})` : ''}`, text: n.text });
    }
  }
  if (!items.length) return '<p class="all-clear">Nothing needs special attention. Arrange the cards in the new designer and you\'re done.</p>';
  return `<ol class="attention">${items.map((i) => `<li><span class="where">${esc(i.where)}</span><span class="what">${esc(i.text)}</span></li>`).join('')}</ol>`;
}

function pageSection(p) {
  const warn = pageWarnCount(p);
  const counts = ['copied', 'mapped', 'skipped'].map((o) => [o, p.widgets.filter((w) => w.outcome === o).length]).filter(([, n]) => n);
  const meta = [`${p.cards.length} card${p.cards.length === 1 ? '' : 's'}`, ...counts.map(([o, n]) => `${n} ${OUTCOME_LABEL[o].toLowerCase()}`)];
  const rows = p.widgets.map((w) => `
    <tr class="${widgetNeedsAttention(w) ? 'row-warn' : ''} outcome-${w.outcome}">
      <td><span class="from">${esc(w.sourceType)}</span>${w.label ? `<span class="label">${esc(w.label)}</span>` : ''}</td>
      <td>${w.outcome === 'skipped' ? '<span class="skipped">Not migrated</span>' : esc(w.targetType)}</td>
      <td>${esc(w.cardLabel)}</td>
      <td>${notesList(w.notes)}</td>
    </tr>`).join('');
  return `<details class="page" data-warn="${warn}">
    <summary><span class="page-name">${esc(p.name)}</span><span class="page-meta">${esc(meta.join(', '))}</span>${warn ? `<span class="warn-count">${warn} to check</span>` : ''}</summary>
    ${notesList(p.notes)}
    ${p.widgets.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Classic widget</th><th>New widget</th><th>Card</th><th>Notes</th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : '<p class="muted">No widgets on this page.</p>'}
  </details>`;
}

/** Body HTML for a report (no <html> wrapper). */
export function renderReportBody(r) {
  const info = r.notes.filter((n) => n.severity !== 'warn');
  return `
    <section class="report-section">
      ${summaryStrip(r.summary)}
      ${info.length ? notesList(info) : ''}
    </section>
    <section class="report-section">
      <h3>Needs attention</h3>
      ${attentionList(r)}
    </section>
    <section class="report-section">
      <h3>Page by page</h3>
      <p class="muted">Each top-level classic container became a card; anything placed directly on the page went into an “Ungrouped widgets” card.</p>
      ${r.pages.map(pageSection).join('')}
    </section>`;
}

/** Complete standalone HTML document for download. */
export function renderReportDocument(r, css) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Migration report: ${esc(r.appName)}</title><style>${css}</style></head>
<body><main class="shell report-doc">
<h1>Migration report</h1>
<p class="lede"><strong>${esc(r.appName)}</strong> converted from <span class="file">${esc(r.sourceFileName)}</span> to <span class="file">${esc(r.outputFileName)}</span> on ${esc(new Date(r.createdAt).toLocaleString())}. Tool version ${esc(r.toolVersion)}.</p>
${renderReportBody(r)}
</main></body></html>`;
}
