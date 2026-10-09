// Reading and writing IQP app package zips.
// Layout (both designers): <AppName>_IQPAppPackage.xml at the root, plus plugins/*.zip,
// images/, model/, favorites/, svgGraphics/ as present. Everything but the XML is copied verbatim.

const ALREADY_COMPRESSED = /\.(zip|jpe?g|png|gif|webp|mp4|woff2?)$/i;

export class PackageError extends Error {
  constructor(message) { super(message); this.name = 'PackageError'; }
}

/** Open a package zip and locate its app XML. */
export async function readPackage(JSZip, bytes) {
  let zip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (e) {
    throw new PackageError('That file is not a valid zip archive.');
  }
  const xmlEntries = Object.values(zip.files).filter((f) => !f.dir && /\.xml$/i.test(f.name));
  for (const entry of xmlEntries.sort((a, b) => a.name.split('/').length - b.name.split('/').length)) {
    const text = await entry.async('string');
    if (/<Package[\s>]/.test(text.slice(0, 2000)) && /<Apps>/.test(text)) {
      return { zip, xmlEntryName: entry.name, xmlText: text };
    }
  }
  throw new PackageError('No Operations Hub app package XML was found in that zip. Export the app from Operations Hub and choose the resulting .zip.');
}

/** typeName -> manifest.json for every plugin zip bundled in the package. */
export async function readPluginManifests(JSZip, zip) {
  const manifests = new Map();
  const zips = Object.values(zip.files).filter((f) => !f.dir && /(^|\/)plugins\/[^/]+\.zip$/i.test(f.name));
  for (const entry of zips) {
    try {
      const inner = await JSZip.loadAsync(await entry.async('uint8array'));
      const mf = Object.values(inner.files).find((f) => !f.dir && /manifest\.json$/i.test(f.name) && f.name.split('/').length <= 2);
      if (!mf) continue;
      const m = JSON.parse((await mf.async('string')).replace(/^﻿/, ''));
      if (m?.typeName) manifests.set(m.typeName, m);
    } catch {
      // A damaged plugin zip just means no manifest; the widget falls back to its own plugin data.
    }
  }
  return manifests;
}

/** Build the output zip: every original entry copied, with the app XML replaced (and renamed). */
export async function writePackage(JSZip, zip, { xmlEntryName, newXmlName, newXmlText }, { outputType = 'uint8array', onProgress } = {}) {
  const out = new JSZip();
  const folder = xmlEntryName.includes('/') ? xmlEntryName.slice(0, xmlEntryName.lastIndexOf('/') + 1) : '';
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    if (entry.name === xmlEntryName) {
      out.file(folder + newXmlName, newXmlText, { compression: 'DEFLATE', createFolders: false });
    } else {
      out.file(entry.name, await entry.async('uint8array'), {
        compression: ALREADY_COMPRESSED.test(entry.name) ? 'STORE' : 'DEFLATE',
        date: entry.date,
        createFolders: false,
      });
    }
  }
  return out.generateAsync({ type: outputType, compressionOptions: { level: 6 } }, (meta) => onProgress?.(meta.percent));
}
