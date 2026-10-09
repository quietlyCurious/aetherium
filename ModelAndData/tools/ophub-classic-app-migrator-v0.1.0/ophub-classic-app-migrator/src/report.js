// Migration report: a plain-data record of everything the converter did, page by page.
// Rendering lives in the UI (and in reportHtml.js for the downloadable copy).

export const OUTCOME = {
  COPIED: 'copied',   // plugin widget carried over as the same plugin
  MAPPED: 'mapped',   // classic native widget converted to a new-designer plugin
  SKIPPED: 'skipped', // no equivalent; left out of the new app
};

export const SEVERITY = { INFO: 'info', WARN: 'warn' };

export class PageReport {
  constructor(name) {
    this.name = name;
    this.cards = [];      // { id, label, source, widgetCount }
    this.widgets = [];    // { id, sourceType, label, targetType, outcome, cardLabel, notes: [{severity, text}] }
    this.notes = [];      // page-level { severity, text }
    this.queryCount = 0;
  }

  addCard(card) { this.cards.push(card); }

  addWidget(entry) {
    const w = { notes: [], ...entry };
    this.widgets.push(w);
    return w;
  }

  note(text, severity = SEVERITY.INFO) { this.notes.push({ severity, text }); }

  count(outcome) { return this.widgets.filter((w) => w.outcome === outcome).length; }
  warningCount() {
    return this.notes.filter((n) => n.severity === SEVERITY.WARN).length +
      this.widgets.reduce((n, w) => n + w.notes.filter((x) => x.severity === SEVERITY.WARN).length, 0);
  }
}

export class MigrationReport {
  constructor({ sourceFileName, outputFileName, toolVersion }) {
    this.sourceFileName = sourceFileName;
    this.outputFileName = outputFileName;
    this.toolVersion = toolVersion;
    this.createdAt = new Date().toISOString();
    this.appName = '';
    this.pages = [];
    this.notes = [];              // app-level { severity, text }
    this.globalCount = 0;
    this.plugins = [];            // { typeName, status: 'verified'|'unverified'|'mapped-target', zip }
  }

  page(name) {
    const p = new PageReport(name);
    this.pages.push(p);
    return p;
  }

  note(text, severity = SEVERITY.INFO) { this.notes.push({ severity, text }); }

  summary() {
    const sum = (fn) => this.pages.reduce((n, p) => n + fn(p), 0);
    return {
      pages: this.pages.length,
      cards: sum((p) => p.cards.length),
      queries: sum((p) => p.queryCount),
      globals: this.globalCount,
      copied: sum((p) => p.count(OUTCOME.COPIED)),
      mapped: sum((p) => p.count(OUTCOME.MAPPED)),
      skipped: sum((p) => p.count(OUTCOME.SKIPPED)),
      warnings: this.notes.filter((n) => n.severity === SEVERITY.WARN).length + sum((p) => p.warningCount()),
    };
  }

  toJSON() {
    return {
      sourceFileName: this.sourceFileName,
      outputFileName: this.outputFileName,
      toolVersion: this.toolVersion,
      createdAt: this.createdAt,
      appName: this.appName,
      summary: this.summary(),
      notes: this.notes,
      plugins: this.plugins,
      pages: this.pages,
    };
  }
}
