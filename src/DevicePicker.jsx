import React from 'react';
import { DEVICE_CATEGORIES, SPECIAL_PRESETS, getTierById, getDeviceById } from './breakpointConfig';

function DevicePicker({ activeDeviceId, activeTierId, customWidth, customHeight, onDeviceSelect, onCustomChange, open, onToggle }) {
  const activeDevice = getDeviceById(activeDeviceId);
  const activeTier = getTierById(activeTierId);

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {/* Tier badge */}
      {activeTier && (
        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 10, background: activeTier.color, color: '#fff', fontWeight: 600, whiteSpace: 'nowrap' }}>
          {activeTier.icon} {activeTier.label}
        </span>
      )}

      {/* Device button */}
      <button
        className="focus-mode-btn"
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 120 }}
      >
        <span>{activeDevice?.label || 'Select Device'}</span>
        <span style={{ fontSize: 10, color: '#999' }}>
          {activeDeviceId === 'custom'
            ? `${customWidth}×${customHeight}`
            : activeDevice?.width ? `${activeDevice.width}×${activeDevice.height}` : ''}
        </span>
        <span>▾</span>
      </button>

      {/* Custom dimensions inline if custom selected */}
      {activeDeviceId === 'custom' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <input type="number" value={customWidth} onChange={e => onCustomChange(parseInt(e.target.value)||800, customHeight)}
            style={{ width: 56, fontSize: 11, padding: '2px 4px', border: '1px solid #ccc', borderRadius: 3 }} />
          <span style={{ fontSize: 11, color: '#999' }}>×</span>
          <input type="number" value={customHeight} onChange={e => onCustomChange(customWidth, parseInt(e.target.value)||600)}
            style={{ width: 56, fontSize: 11, padding: '2px 4px', border: '1px solid #ccc', borderRadius: 3 }} />
        </div>
      )}

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 1000,
          background: '#fff', border: '1px solid #e0e0e0', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 240, maxHeight: 400, overflowY: 'auto',
          marginTop: 4,
        }}>
          {/* Special presets */}
          <div style={{ padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
            {SPECIAL_PRESETS.map(preset => (
              <div key={preset.id}
                onClick={() => onDeviceSelect(preset)}
                style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: activeDeviceId === preset.id ? 600 : 400, background: activeDeviceId === preset.id ? '#f0f7ff' : 'transparent' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f5f5f5'}
                onMouseLeave={e => e.currentTarget.style.background = activeDeviceId === preset.id ? '#f0f7ff' : 'transparent'}
              >
                {preset.label}
              </div>
            ))}
          </div>

          {/* Device categories */}
          {DEVICE_CATEGORIES.map(cat => (
            <div key={cat.id}>
              <div style={{ padding: '6px 12px 2px', fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {cat.label}
              </div>
              {cat.devices.map(device => {
                const tier = getTierById(device.tier);
                return (
                  <div key={device.id}
                    onClick={() => onDeviceSelect(device)}
                    style={{ padding: '5px 12px', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: activeDeviceId === device.id ? '#f0f7ff' : 'transparent' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f5f5f5'}
                    onMouseLeave={e => e.currentTarget.style.background = activeDeviceId === device.id ? '#f0f7ff' : 'transparent'}
                  >
                    <span style={{ fontWeight: activeDeviceId === device.id ? 600 : 400 }}>{device.label}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10, color: '#999' }}>{device.width}×{device.height}</span>
                      {tier && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 8, background: tier.color, color: '#fff', fontWeight: 600 }}>{tier.label}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default DevicePicker;
