// designer/screens/ScreensWorkspace.jsx
// The Screens area: the three panels, plus the pieces that float over
// them — the create wizard and the two binding popovers — and the
// canvas's keyboard shortcuts.
//
//   ScreensLeftPanel    screens, widgets, data, and the open page's tree
//   ScreenCanvas        toolbar + the page being edited
//   ScreenDetailsPanel  whatever is selected
//
// `editor` is useScreenEditor's result: App owns it (so the canvas
// survives leaving the area), this draws it. `queries` are the Queries
// area's definitions, which the Data tab offers and bindings name.
// `selectedModel` is the title bar's industry model: this area loads it
// (the same way the Operator side does) for the Data tab's Model view, the
// Create wizard, and screens that are about a type (their asset bindings
// and "Preview as" — see screenAsset.jsx).

import { useEffect, useRef, useState } from 'react';
import { Popup, Splitter } from 'devextreme-react';
import { Item as SplitterItem } from 'devextreme-react/splitter';
import { ToolbarItem } from 'devextreme-react/popup';
import WizardContent, { STEPS } from '../../Wizard';
import { unsavedChangesStore } from '../../unsavedChangesStore';
import WidgetBindingPopover from '../../WidgetBindingPopover';
import InputBindingPopover from '../../InputBindingPopover';
import { findContainerById } from '../../containerTree';
import { WIDGET_PROPERTIES } from '../../widgetData';
import { ScreensLeftPanel } from './ScreensLeftPanel';
import { ScreenCanvas } from './ScreenCanvas';
import { ScreenDetailsPanel } from './ScreenDetailsPanel';
import { useLoadedModel } from '../../model/useLoadedModel';
import { screenSelfOf } from './screenAsset';

// Ctrl/Cmd+C and Ctrl/Cmd+V copy and paste the selected container; Esc
// puts the paintbrush down and clears snap guides.
//
// Only while the Screens area is open (this used to listen on the whole
// app, which stopped copy and paste working in every text field
// everywhere), and never while typing in a field — there, the keys copy and
// paste text as usual. Reads the editor through a ref so the listener,
// added once, always acts on the current selection and clipboard.
function useCanvasShortcuts(editor) {
  const editorRef = useRef(editor);
  editorRef.current = editor;
  useEffect(() => {
    const isTypingTarget = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    const onKeyDown = (e) => {
      const ed = editorRef.current;
      if (e.key === 'Escape') { ed.setPaintbrush(null); ed.setSnapGuides(null); }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || isTypingTarget(e.target)) return;
      if (e.key === 'c' || e.key === 'C') { e.preventDefault(); ed.copySelection(); }
      if (e.key === 'v' || e.key === 'V') { e.preventDefault(); ed.paste(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}

// Lights the title-bar Save's amber dot while the canvas has unsaved
// edits — the store every area publishes to. Cleared when the area closes;
// the edits themselves stay (they live in useScreenEditor), and so does
// the dot when you come back.
function usePublishUnsaved(isDirty) {
  useEffect(() => { unsavedChangesStore.setDirty(isDirty); }, [isDirty]);
  useEffect(() => () => unsavedChangesStore.setDirty(false), []);
}

// The Create wizard (opened from the details header). Starts fresh each
// time it opens.
function useCreateWizard() {
  const [visible, setVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedAssetIds, setSelectedAssetIds] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const open = () => {
    setCurrentStep(0);
    setSelectedAssetIds([]);
    setSelectedTags([]);
    setVisible(true);
  };
  const close = () => setVisible(false);
  const next = () => {
    if (currentStep < STEPS.length - 1) setCurrentStep(s => s + 1);
    else close();
  };
  const back = () => {
    if (currentStep > 0) setCurrentStep(s => s - 1);
  };
  return {
    visible, currentStep, selectedAssetIds, setSelectedAssetIds, selectedTags, setSelectedTags,
    isLastStep: currentStep === STEPS.length - 1,
    open, close, next, back,
  };
}

function CreateWizardPopup({ wizard, model }) {
  return (
    <Popup
      visible={wizard.visible}
      onHiding={wizard.close}
      title="Create"
      width="90vw"
      height="90vh"
      showCloseButton={false}
      hideOnOutsideClick={false}
      dragEnabled={false}
      contentRender={() => (!model.loaded ? (
        <p className="step-instructions">
          {model.error ? `Couldn't load the model (${model.error}).` : 'Loading model…'}
        </p>
      ) : (
        <WizardContent
          key={model.modelId}
          currentStep={wizard.currentStep}
          selectedAssetIds={wizard.selectedAssetIds}
          onAssetsSelected={wizard.setSelectedAssetIds}
          selectedTags={wizard.selectedTags}
          onTagsChanged={wizard.setSelectedTags}
        />
      ))}
    >
      <ToolbarItem
        widget="dxButton"
        toolbar="bottom"
        location="before"
        options={{ text: 'Cancel', stylingMode: 'outlined', onClick: wizard.close }}
      />
      {wizard.currentStep > 0 && (
        <ToolbarItem
          widget="dxButton"
          toolbar="bottom"
          location="after"
          options={{ text: 'Back', stylingMode: 'outlined', onClick: wizard.back }}
        />
      )}
      <ToolbarItem
        widget="dxButton"
        toolbar="bottom"
        location="after"
        options={{
          text: wizard.isLastStep ? 'Save' : 'Next',
          type: wizard.isLastStep ? 'success' : 'default',
          stylingMode: 'contained',
          onClick: wizard.next,
        }}
      />
    </Popup>
  );
}

// Binding a widget property: an expression, or a query instance on this
// page.
function WidgetBindingEditor({ editor, queries, self }) {
  const target = editor.bindingPopoverProp;
  if (!target) return null;
  const container = findContainerById(editor.containers, target.containerId);
  if (!container) return null;
  const binding = container.bindings?.[target.propName];
  const propDef = WIDGET_PROPERTIES[container.widgetName]?.find(p => p.name === target.propName);
  return (
    <WidgetBindingPopover
      propLabel={propDef?.label || target.propName}
      propType={propDef?.type}
      binding={binding}
      x={target.x}
      y={target.y}
      pageQueryInstances={editor.pageQueryInstances}
      queries={queries}
      self={self}
      onSave={(b) => editor.setWidgetBinding(target.containerId, target.propName, b)}
      onClear={() => editor.clearWidgetBinding(target.containerId, target.propName)}
      onClose={() => editor.setBindingPopoverProp(null)}
    />
  );
}

// Binding a query instance's input to an expression.
function InputBindingEditor({ editor }) {
  const target = editor.inputBindingPopover;
  if (!target) return null;
  const inst = editor.findQueryInstance(target.instanceId);
  if (!inst) return null;
  return (
    <InputBindingPopover
      fieldName={target.fieldName}
      binding={inst.bindings?.[target.fieldName]}
      x={target.x}
      y={target.y}
      onSave={(b) => editor.setInputBinding(target.instanceId, target.fieldName, b)}
      onClear={() => editor.clearInputBinding(target.instanceId, target.fieldName)}
      onClose={() => editor.setInputBindingPopover(null)}
    />
  );
}

export function ScreensWorkspace({ editor, queries, selectedModel }) {
  const model = useLoadedModel(selectedModel);
  const self = screenSelfOf(editor, model);
  useCanvasShortcuts(editor);
  usePublishUnsaved(editor.isDirty);
  const wizard = useCreateWizard();
  return (
    <>
      <Splitter orientation="horizontal" style={{ height: '100%' }}>
        <SplitterItem size="220px" minSize="120px" resizable={true}>
          <ScreensLeftPanel editor={editor} queries={queries} model={model} self={self} />
        </SplitterItem>
        <SplitterItem resizable={true}>
          <ScreenCanvas editor={editor} self={self} />
        </SplitterItem>
        <SplitterItem size="220px" minSize="120px" resizable={true}>
          <ScreenDetailsPanel editor={editor} queries={queries} self={self} onOpenWizard={wizard.open} />
        </SplitterItem>
      </Splitter>
      <CreateWizardPopup wizard={wizard} model={model} />
      <WidgetBindingEditor editor={editor} queries={queries} self={self} />
      <InputBindingEditor editor={editor} />
    </>
  );
}
