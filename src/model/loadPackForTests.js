// model/loadPackForTests.js
// Loads a real industry pack from public/data into modelData.js the same
// way the app does (activateLoadedModel), for tests that exercise the model
// readers against real data. Node-only (reads files) — tests use it, the
// app never imports it.

import fs from 'fs';
import path from 'path';
import { activateLoadedModel } from './modelData';
import { DEFAULT_FILES, OPTIONAL_ROLES } from './modelRegistry';

const DATA = path.join(__dirname, '../../public/data');

export function loadPackForTests(modelId) {
  const entry = JSON.parse(fs.readFileSync(path.join(DATA, 'models.json'), 'utf8')).find(m => m.id === modelId);
  const model = {
    ...entry,
    levels: entry.levels.map(l => (typeof l === 'string' ? { id: l, label: l } : l)),
  };
  const roles = { ...DEFAULT_FILES, ...(entry.files || {}) };
  const files = Object.entries(roles);
  const results = files.map(([role, file]) => {
    const p = path.join(DATA, modelId, file);
    if (!fs.existsSync(p) && OPTIONAL_ROLES.has(role)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  });
  activateLoadedModel(model, files, results);
}
