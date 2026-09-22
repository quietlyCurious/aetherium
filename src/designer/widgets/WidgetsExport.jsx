// designer/widgets/WidgetsExport.jsx
// Export: every saved list, merged over the shipped ones, written out as a
// complete src/widgetProperties.js — downloaded inside a .zip (a bare .js
// download tends to get blocked on locked-down laptops) or copied to the
// clipboard. Drop it into src/, commit, and on the next load any saved
// list that now matches the file stops being an override on its own.

import { useState } from 'react';
import { getAllWidgetPropertyDefs } from './widgetPropertyDefs';
import { widgetPropertiesToSource } from './widgetPropertiesSource';
import { buildZip, downloadBytes } from './zipFile';

export const EXPORT_FILE_PATH = 'src/widgetProperties.js';

export function buildWidgetPropertiesExport() {
  return widgetPropertiesToSource(getAllWidgetPropertyDefs());
}

export function downloadWidgetPropertiesZip(now = new Date()) {
  const stamp = now.toISOString().slice(0, 10);
  const zip = buildZip([{ name: EXPORT_FILE_PATH, content: buildWidgetPropertiesExport() }], now);
  downloadBytes(zip, `widgetProperties-${stamp}.zip`);
}

export function WidgetsExportButtons({ editedCount, blockedBy }) {
  const [copied, setCopied] = useState(false);
  const disabledTitle = blockedBy || (editedCount === 0 ? 'Nothing edited yet — the export would match the shipped file.' : null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildWidgetPropertiesExport());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.alert('Couldn’t copy to the clipboard — use Download instead.');
    }
  };

  return (
    <div className="widgets-export">
      <div className="widgets-export-summary">
        {editedCount === 0 ? 'No widgets edited' : `${editedCount} widget${editedCount === 1 ? '' : 's'} edited (this browser)`}
      </div>
      <div className="widgets-export-buttons" title={disabledTitle || `Writes ${EXPORT_FILE_PATH} with your saved lists`}>
        <button className="focus-mode-btn" disabled={!!disabledTitle} onClick={() => downloadWidgetPropertiesZip()}>Export .zip</button>
        <button className="focus-mode-btn" disabled={!!disabledTitle} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  );
}
