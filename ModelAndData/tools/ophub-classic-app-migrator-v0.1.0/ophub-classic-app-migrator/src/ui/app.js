// Browser entry point for the single-file migrator.

import JSZip from 'jszip/dist/jszip.min.js';
import reference from '../reference/reference.json';
import { convertPackage, TOOL_VERSION } from '../packageConverter.js';
import { renderReportBody, renderReportDocument } from './reportView.js';

const $ = (id) => document.getElementById(id);
const els = {
  process: $('process'), drop: $('drop'), file: $('file'), chosen: $('chosen'), chosenName: $('chosen-name'),
  chosenSize: $('chosen-size'), chooseOther: $('choose-other'), asNewApp: $('as-new-app'), convert: $('convert'),
  inputPanel: $('input-panel'), progress: $('progress'), bar: $('bar'), stage: $('stage'), error: $('error'), result: $('result'),
  resultTitle: $('result-title'), resultSub: $('result-sub'), report: $('report'), onlyWarn: $('only-warn'),
  dlPackage: $('download-package'), dlReport: $('download-report'), dlJson: $('download-json'), again: $('again'),
};

let chosenFile = null;
const objectUrls = [];

function setStages(states) {
  [...els.process.children].forEach((li, i) => { li.dataset.state = states[i]; });
}

function formatSize(bytes) {
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = false;
}

function choose(file) {
  if (!file) return;
  chosenFile = file;
  els.error.hidden = true;
  els.chosenName.textContent = file.name;
  els.chosenSize.textContent = `(${formatSize(file.size)})`;
  els.chosen.hidden = false;
  els.convert.disabled = false;
  setStages(['done', 'active', 'idle']);
  if (!/\.zip$/i.test(file.name)) showError('That file isn\'t a .zip. Choose the package you exported from Operations Hub.');
}

function urlFor(blob) {
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);
  return url;
}

/** Let the browser paint progress between synchronous chunks of work. */
function paintProgress(stage, pct) {
  els.stage.textContent = stage;
  els.bar.style.width = `${pct}%`;
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function convert() {
  if (!chosenFile) return;
  els.convert.disabled = true;
  els.error.hidden = true;
  els.result.hidden = true;
  els.progress.hidden = false;
  try {
    const bytes = await chosenFile.arrayBuffer();
    const { bytes: blob, outputFileName, report } = await convertPackage(
      { JSZip, DOMParser, XMLSerializer, reference },
      { bytes, fileName: chosenFile.name },
      { asNewApp: els.asNewApp.checked, outputType: 'blob', onProgress: paintProgress },
    );
    showResult(blob, outputFileName, report.toJSON());
  } catch (e) {
    if (e?.name !== 'PackageError') console.error(e);
    setStages(['done', 'warn', 'idle']);
    showError(e?.name === 'PackageError'
      ? e.message
      : `The conversion stopped unexpectedly: ${e?.message || e}. Nothing was changed; the original package is untouched.`);
    els.convert.disabled = false;
  } finally {
    els.progress.hidden = true;
  }
}

function showResult(blob, outputFileName, r) {
  const s = r.summary;
  setStages(['done', 'done', 'active']);
  els.resultTitle.textContent = `${r.appName} is ready for the new designer`;
  els.resultSub.textContent = `${s.pages} page${s.pages === 1 ? '' : 's'} and ${s.copied + s.mapped} widgets carried over` +
    (s.warnings ? `; ${s.warnings} item${s.warnings === 1 ? '' : 's'} to check after import.` : '. Nothing needs special attention.');

  els.dlPackage.href = urlFor(blob);
  els.dlPackage.download = outputFileName;

  const css = document.getElementById('app-styles').textContent;
  const reportName = outputFileName.replace(/\.zip$/i, '') + '_MigrationReport';
  els.dlReport.href = urlFor(new Blob([renderReportDocument(r, css)], { type: 'text/html' }));
  els.dlReport.download = `${reportName}.html`;
  els.dlJson.href = urlFor(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
  els.dlJson.download = `${reportName}.json`;

  els.report.innerHTML = renderReportBody(r);
  els.onlyWarn.checked = false;
  els.report.classList.remove('only-warn');
  els.inputPanel.hidden = true;
  els.result.hidden = false;
  els.resultTitle.setAttribute('tabindex', '-1');
  els.resultTitle.focus();
}

function reset() {
  objectUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  chosenFile = null;
  els.file.value = '';
  els.chosen.hidden = true;
  els.convert.disabled = true;
  els.result.hidden = true;
  els.error.hidden = true;
  els.inputPanel.hidden = false;
  setStages(['active', 'idle', 'idle']);
  els.drop.focus?.();
}

els.file.addEventListener('change', () => choose(els.file.files[0]));
els.chooseOther.addEventListener('click', () => els.file.click());
for (const type of ['dragenter', 'dragover']) {
  els.drop.addEventListener(type, (e) => { e.preventDefault(); els.drop.classList.add('is-over'); });
}
for (const type of ['dragleave', 'drop']) {
  els.drop.addEventListener(type, () => els.drop.classList.remove('is-over'));
}
els.drop.addEventListener('drop', (e) => { e.preventDefault(); choose(e.dataTransfer.files[0]); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
els.convert.addEventListener('click', convert);
els.again.addEventListener('click', reset);
els.onlyWarn.addEventListener('change', () => els.report.classList.toggle('only-warn', els.onlyWarn.checked));

document.title = `Classic App Migrator ${TOOL_VERSION}`;
