// designer/screens/ScreenCanvas.jsx
// The Screens editor's center panel: the toolbar, and the page being
// edited inside the device preview frame. The page renders through
// ContainerCard with every editing callback live — the editing twin of
// ScreenView, which renders the same containers read-only.
//
// A screen that's about a type shows one asset of it at a time: the
// toolbar's "Preview as" picks which, and the page renders inside a
// ScreenAssetProvider so its asset bindings resolve against that asset.
// `self` is screenSelfOf's answer for the open screen.

import { Button } from 'devextreme-react';
import ContainerCard from '../../ContainerCard';
import DevicePicker from '../../DevicePicker';
import { ROOT_CONTAINER_ID } from '../../containerModel';
import { findContainerById } from '../../containerTree';
import { AssetPicker } from '../AssetPicker';
import { ScreenAssetProvider } from './screenAsset';
import { fillsFrame, pageSizeOf, sizeBox } from './screenSizes';

// What the screen is about, and which asset it's showing. Nothing for a
// plain page.
function ScreenSelfControls({ self }) {
  if (self.status === 'none' || self.status === 'loading') return null;
  if (self.status !== 'ok') {
    const why = self.status === 'otherModel'
      ? `This screen is about a type in the “${self.context.modelId}” model. Switch to that model to preview it.`
      : 'This screen is about a type this model doesn’t have.';
    return <span className="screen-self-warning" title={why}>⚠ {why}</span>;
  }
  return (
    <div className="screen-self-controls">
      <span className="screen-self-label" title="What this screen is about — change it in the Page details">
        <span className="screen-self-kicker">About</span> {self.typeLabel}
      </span>
      <span className="screen-self-kicker">Preview as</span>
      <AssetPicker
        value={self.assetId}
        assetIds={self.assetIds}
        // Only a real choice counts: when the type changes, the box moves to
        // the fallback asset by itself, and that shouldn't replace the choice.
        onChange={(id, { byUser }) => { if (id && byUser) self.chooseAsset(id); }}
        clearable={false}
        width={230}
      />
    </div>
  );
}

// Buttons that act on the selection only appear while something is
// selected; the device picker and snap settings are always there.
function ScreenCanvasToolbar({ editor, self }) {
  const {
    containers, selectedContainerId, isSelectedLocked, paintbrush, clipboard,
    focusMode, showGap, coordMode, snapEnabled, snapSize,
  } = editor;
  return (
    <div className="center-toolbar">
      {/* Device picker — always visible */}
      <DevicePicker
        activeDeviceId={editor.activeDeviceId}
        activeTierId={editor.activeTierId}
        customWidth={editor.customWidth}
        customHeight={editor.customHeight}
        onDeviceSelect={editor.selectDevice}
        onCustomChange={(w, h) => { editor.setCustomWidth(w); editor.setCustomHeight(h); }}
        open={editor.devicePickerOpen}
        onToggle={() => editor.setDevicePickerOpen(o => !o)}
      />
      <div style={{ width: 1, height: 20, background: '#e0e0e0', margin: '0 4px', flexShrink: 0 }} />
      <ScreenSelfControls self={self} />
      {/* Snap toggle + threshold input — always visible, canvas-level settings */}
      <button
        className={`focus-mode-btn${snapEnabled ? ' focus-mode-btn--active' : ''}`}
        onClick={() => editor.setSnapEnabled(s => !s)}
        title={snapEnabled ? 'Snap on (grid + elements) — click to disable' : 'Snap off — click to enable'}
      >
        {snapEnabled ? '⊞ Snap' : '⊟ Snap'}
      </button>
      {snapEnabled && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <input
            type="number"
            min={1}
            max={64}
            value={snapSize}
            onChange={(e) => editor.setSnapSize(Math.max(1, Math.min(64, parseInt(e.target.value) || 8)))}
            style={{ width: 40, fontSize: 11, padding: '2px 4px', border: '1px solid #d1d1d1', borderRadius: 4, textAlign: 'center' }}
            title="Snap threshold — controls grid interval and element-snap proximity"
          />
          <span style={{ fontSize: 11, color: '#666', whiteSpace: 'nowrap' }}>px</span>
        </div>
      )}
      {selectedContainerId && (
        <>
          <Button
            text="+ Add Container"
            type="default"
            stylingMode="outlined"
            disabled={isSelectedLocked}
            onClick={editor.addContainer}
          />
          <button
            className={`focus-mode-btn${focusMode === 'stay' ? ' focus-mode-btn--active' : ''}`}
            onClick={() => editor.setFocusMode(m => m === 'follow' ? 'stay' : 'follow')}
            title={focusMode === 'follow' ? 'Follow mode: focus moves to new container' : 'Stay mode: focus stays on parent'}
          >
            {focusMode === 'follow' ? '⤵ Follow' : '📌 Stay'}
          </button>
          {(() => {
            const sel = findContainerById(containers, selectedContainerId);
            if (!sel || sel.isWidget) return null;
            const dir = sel.layout?.flexDirection || 'row';
            return (
              <button
                className={`focus-mode-btn${dir === 'column' ? ' focus-mode-btn--active' : ''}`}
                title={`Direction: ${dir} — click to toggle`}
                disabled={isSelectedLocked}
                onClick={() => editor.updateLayout(selectedContainerId, { flexDirection: dir === 'row' ? 'column' : 'row' })}
              >
                <i className={dir === 'row' ? 'dx-icon-deleterow' : 'dx-icon-deletecolumn'} style={{ marginRight: 4 }} />
                {dir}
              </button>
            );
          })()}
          <button
            className={`focus-mode-btn${!showGap ? ' focus-mode-btn--active' : ''}`}
            onClick={() => editor.setShowGap(g => !g)}
            title={showGap ? 'Gap on — click to remove spacing' : 'Gap off — click to restore spacing'}
          >
            {showGap ? '⬜ Gap' : '▣ Gap'}
          </button>
          {(() => {
            const sel = selectedContainerId ? findContainerById(containers, selectedContainerId) : null;
            const selParent = sel?.parentId ? findContainerById(containers, sel.parentId) : null;
            const isCoordChild = selParent?.layout?.layoutType === 'coordinate';
            return (
              <>
                {/* Copy button */}
                {sel && sel.id !== ROOT_CONTAINER_ID && (
                  <button className="focus-mode-btn" title="Copy (Ctrl/Cmd+C)" disabled={isSelectedLocked} onClick={editor.copySelection}>
                    ⎘ Copy
                  </button>
                )}
                {/* Paintbrush button */}
                {sel && sel.id !== ROOT_CONTAINER_ID && (
                  <button
                    className={`focus-mode-btn${paintbrush ? ' focus-mode-btn--active' : ''}`}
                    title={paintbrush ? 'Paintbrush active — click any item to apply styles. Click again to cancel.' : 'Pick up style to paint onto other items'}
                    disabled={isSelectedLocked && !paintbrush}
                    onClick={() => paintbrush ? editor.setPaintbrush(null) : editor.pickUpPaintbrush()}
                  >
                    🖌 {paintbrush ? 'Painting...' : 'Paintbrush'}
                  </button>
                )}
                {/* Cancel paintbrush if active but nothing selected */}
                {!sel && paintbrush && (
                  <button className="focus-mode-btn focus-mode-btn--active" onClick={() => editor.setPaintbrush(null)}>
                    🖌 Cancel Paint
                  </button>
                )}
                {/* Paste button — when clipboard has content */}
                {clipboard && (
                  <button
                    className="focus-mode-btn focus-mode-btn--active"
                    title="Paste (Ctrl/Cmd+V)"
                    disabled={isSelectedLocked}
                    onClick={editor.paste}
                  >
                    ⊕ Paste
                  </button>
                )}
                {/* Delete button — for any non-root selected item */}
                {sel && sel.id !== ROOT_CONTAINER_ID && (
                  <button
                    className="focus-mode-btn"
                    style={{ color: '#d00', borderColor: '#d00' }}
                    title="Delete selected container"
                    disabled={isSelectedLocked}
                    onClick={() => editor.deleteContainer(selectedContainerId)}
                  >
                    × Delete
                  </button>
                )}
                {/* Move/Reparent toggle — only for coord children */}
                {isCoordChild && (
                  <button
                    className={`focus-mode-btn${coordMode === 'reparent' ? ' focus-mode-btn--active' : ''}`}
                    disabled={isSelectedLocked}
                    onClick={() => editor.setCoordMode(m => m === 'reposition' ? 'reparent' : 'reposition')}
                    title={coordMode === 'reposition' ? 'Drag moves item — click to switch to reparent' : 'Drag reparents item — click to switch to reposition'}
                  >
                    {coordMode === 'reposition' ? '⤢ Move' : '⇄ Reparent'}
                  </button>
                )}
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}

export function ScreenCanvas({ editor, self }) {
  const { containers, previewWidth, previewHeight, paintbrush } = editor;
  // A Tile or a Card is designed at the size it will be drawn at, so the
  // canvas frames it rather than letting it fill the window — otherwise
  // you'd lay out a 220×140 tile in a 1200px space and only find out how
  // it really looks inside a repeater. A Page fills, as before, and a
  // chosen device preview wins over both: that's someone asking for a
  // particular frame on purpose.
  const sizeId = pageSizeOf(containers);
  const box = fillsFrame(sizeId) ? null : sizeBox(sizeId);
  const frameWidth = previewWidth || box?.width || null;
  const frameHeight = previewHeight || box?.height || null;
  return (
    <div className="app-panel app-panel--center">
      <ScreenCanvasToolbar editor={editor} self={self} />
      <div
        className="center-content"
        onClick={editor.clearCanvasSelection}
        style={{ cursor: paintbrush ? 'crosshair' : undefined }}
      >
        {/* Device preview wrapper */}
        <div className="aetherium-canvas-scroll" style={{
          width: '100%', height: '100%',
          overflow: 'auto',
          display: 'flex',
          alignItems: frameWidth ? 'flex-start' : 'stretch',
          justifyContent: frameWidth ? 'center' : 'stretch',
          padding: frameWidth ? 24 : 0,
          boxSizing: 'border-box',
          background: frameWidth ? '#e8e8e8' : 'transparent',
        }}>
          <div style={{
            width: frameWidth ? frameWidth : '100%',
            height: frameHeight ? frameHeight : '100%',
            flexShrink: 0,
            background: '#fff',
            boxShadow: frameWidth ? '0 2px 16px rgba(0,0,0,0.15)' : 'none',
            overflow: 'hidden',
            position: 'relative',
          }}>
            <div className={`container-canvas${editor.showGap ? '' : ' canvas-no-gap'}`} style={{ padding: 0, height: '100%', boxSizing: 'border-box' }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); editor.endDrag(); }}
            >
              <ScreenAssetProvider assetId={self.assetId}>
              {containers.map(c => (
                <ContainerCard
                  key={c.id}
                  container={c}
                  containers={containers}
                  selectedIds={editor.selectedContainerIds}
                  onSelect={editor.selectContainer}
                  onDelete={editor.deleteContainer}
                  onDragStart={editor.startDrag}
                  onDragOver={editor.dragOver}
                  onDrop={editor.dropOnCanvas}
                  onWidgetDrop={editor.dropWidget}
                  onUpdateLayout={editor.updateLayout}
                  onUpdateSlot={editor.updateSlot}
                  onUpdateCoord={editor.updateCoord}
                  onGridCellDrop={editor.dropInGridCell}
                  onSetSelectedGridCell={editor.setSelectedGridCell}
                  onMergeCellContainers={editor.mergeGridCells}
                  selectedGridCell={editor.selectedGridCell}
                  dragState={editor.dragState}
                  draggingId={editor.draggingId}
                  isDragging={!!editor.draggingId}
                  coordMode={editor.coordMode}
                  activeTierId={editor.activeTierId}
                  snapEnabled={editor.snapEnabled}
                  snapSize={editor.snapSize}
                  snapGuides={editor.snapGuides}
                  onSnapGuideChange={editor.setSnapGuides}
                />
              ))}
              </ScreenAssetProvider>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
