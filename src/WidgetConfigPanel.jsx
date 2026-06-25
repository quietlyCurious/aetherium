import React from 'react';
import WIDGET_CONFIGS from './widgetConfigs';

function WidgetConfigPanel({ widgetName }) {
  const config = WIDGET_CONFIGS[widgetName];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #e0e0e0', flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{widgetName} — Full Configuration</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {config ? (
          <pre style={{ fontSize: 11, color: '#333', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
            {JSON.stringify(config, null, 2)}
          </pre>
        ) : (
          <p style={{ fontSize: 12, color: '#999', fontStyle: 'italic' }}>No Entry</p>
        )}
      </div>
    </div>
  );
}

export default WidgetConfigPanel;
