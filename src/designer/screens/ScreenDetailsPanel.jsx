// designer/screens/ScreenDetailsPanel.jsx
// The Screens editor's right panel. Shows the details of whatever is
// selected — a query instance (Page Data tab), several items at once, or
// one container or widget — under a header that turns the breakpoint
// tier's color when you're editing a tier's overrides. The header's
// Create button opens the create wizard.

import { Button } from 'devextreme-react';
import QueryInstanceDetailsPanel from '../../QueryInstanceDetailsPanel';
import { BASE_TIER_ID } from '../../containerModel';
import { getTierById } from '../../breakpointConfig';
import { evaluateExpression } from '../../expressionEval';
import { MultiSelectionDetails } from './MultiSelectionDetails';
import { ContainerDetails } from './ContainerDetails';

function DetailsHeader({ activeTierId, onCreate }) {
  const isBase = activeTierId === BASE_TIER_ID;
  const tier = getTierById(activeTierId);
  return (
    <div className="details-panel-header" style={{
      background: isBase ? undefined : tier?.color,
      color: isBase ? undefined : '#fff',
      transition: 'background 0.2s',
    }}>
      <span className="panel-label" style={{ color: isBase ? undefined : '#fff', margin: 0 }}>
        {isBase ? 'Details' : `${tier?.icon} ${tier?.label} Overrides`}
      </span>
      <Button
        text="Create"
        type={isBase ? 'default' : 'normal'}
        stylingMode="outlined"
        onClick={onCreate}
        style={{ marginLeft: 'auto' }}
      />
    </div>
  );
}

function SelectedQueryInstanceDetails({ editor, queries }) {
  const { inputBindingPopover } = editor;
  const inst = editor.findQueryInstance(editor.selectedQueryInstanceId);
  if (!inst) return null;
  const q = queries.find(qq => qq.id === inst.queryId);
  return (
    <QueryInstanceDetailsPanel
      instance={inst}
      query={q}
      evaluateExpression={evaluateExpression}
      openBindingField={inputBindingPopover?.instanceId === inst.id ? inputBindingPopover.fieldName : null}
      onOpenBindingPopover={(fieldName, rect) => {
        if (inputBindingPopover?.instanceId === inst.id && inputBindingPopover?.fieldName === fieldName) {
          editor.setInputBindingPopover(null);
          return;
        }
        editor.setInputBindingPopover({ instanceId: inst.id, fieldName, x: rect.left, y: rect.top });
      }}
    />
  );
}

export function ScreenDetailsPanel({ editor, queries, onOpenWizard }) {
  const { selectedContainerId, selectedContainerIds, selectedQueryInstanceId } = editor;
  return (
    <div className="app-panel details-panel aetherium-canvas-scroll">
      <DetailsHeader activeTierId={editor.activeTierId} onCreate={onOpenWizard} />

      {editor.isSelectedLocked && (
        <div className="details-locked-banner">🔒 Locked — unlock to edit</div>
      )}

      {selectedQueryInstanceId && <SelectedQueryInstanceDetails editor={editor} queries={queries} />}

      {selectedContainerIds.length > 1 && <MultiSelectionDetails editor={editor} />}

      {selectedContainerIds.length <= 1 && selectedContainerId && <ContainerDetails editor={editor} queries={queries} />}
    </div>
  );
}
