import React, { useState, useMemo } from 'react';
import { SelectBox, TreeView } from 'devextreme-react';
import { CURRENT_ASSET_DATA, CURRENT_ASSET_MAP, PROPERTY_CATEGORIES, PROPERTY_LABELS } from './model/modelData';
import { getAssetProperties, HMI_CATEGORY_ORDER } from './model/assetQueries';

const STEPS = [
  { title: 'Select Asset' },
  { title: 'Step 2: Data Selection' },
  { title: 'Step 3: Placeholder' },
  { title: 'Step 4: Placeholder' },
];


// ─────────────────────────────────────────────────────────────────────────────
// The loaded model, as the wizard sees it
// ─────────────────────────────────────────────────────────────────────────────
// Everything here reads whichever industry model is active (modelData.js,
// loaded by ScreensWorkspace through useLoadedModel) — the wizard used to
// read a fixed copy of the refinery hierarchy (assetData.js).
//
// A "tag" is one of an asset's properties: its key (tagName), display name
// (label) and category (tagDomain), from the model's properties.json. An
// asset's tags are the properties it has values for.

const UNCATEGORIZED = 'Uncategorized';

function tagsForAsset(assetId) {
  return Object.keys(getAssetProperties(assetId) || {}).map(key => ({
    tagName: key,
    label: PROPERTY_LABELS[key] || key,
    tagDomain: PROPERTY_CATEGORIES[key] || UNCATEGORIZED,
  }));
}

// Every tag any of these assets has, first-seen order. Instances of one
// type share their keys, so for a type this is its instances' tags.
function tagsForAssets(assets) {
  const seen = new Map();
  assets.forEach(a => tagsForAsset(a.id).forEach(t => { if (!seen.has(t.tagName)) seen.set(t.tagName, t); }));
  return [...seen.values()];
}

// The category filter's choices: the model's own categories, in the
// Operator side's category order, then any others alphabetically.
function modelTagDomains() {
  const present = new Set(Object.values(PROPERTY_CATEGORIES));
  const ordered = HMI_CATEGORY_ORDER.filter(c => present.has(c));
  const rest = [...present].filter(c => !HMI_CATEGORY_ORDER.includes(c)).sort((a, b) => a.localeCompare(b));
  return ['all', ...ordered, ...rest];
}

// A minimal tree of the selected assets plus the ancestors that connect
// them (flagged isPlaceholder), in the model's own order.
function buildSelectedAssetTree(selectedAssets) {
  const selectedIds = new Set(selectedAssets.map(a => a.id));
  const includedIds = new Set();
  selectedAssets.forEach(asset => {
    let current = CURRENT_ASSET_MAP[asset.id];
    while (current && !includedIds.has(current.id)) {
      includedIds.add(current.id);
      current = current.parentId ? CURRENT_ASSET_MAP[current.parentId] : null;
    }
  });
  return CURRENT_ASSET_DATA
    .filter(a => includedIds.has(a.id))
    .map(a => ({ ...a, nodeType: 'asset', isPlaceholder: !selectedIds.has(a.id) }));
}

function AssetTreeItemTemplate(item) {
  if (item.nodeType === 'tag') {
    return (
      <div className="tree-item">
        <span className="tree-item-name">{item.name}</span>
        <span className="tree-item-badge tree-item-badge--tag">{item.tagDomain.toLowerCase()}</span>
      </div>
    );
  }
  return (
    <div className="tree-item">
      <span className="tree-item-name">{item.name}</span>
      <span className="tree-item-badge">{item.assetType}</span>
    </div>
  );
}

function getAncestorBreadcrumb(assetId) {
  const crumbs = [];
  let current = CURRENT_ASSET_MAP[assetId];
  // Walk up but exclude the asset itself — we want the path to the parent
  current = current?.parentId ? CURRENT_ASSET_MAP[current.parentId] : null;
  while (current) {
    crumbs.unshift(current.name);
    current = current.parentId ? CURRENT_ASSET_MAP[current.parentId] : null;
  }
  return crumbs;
}

function StepSelectAsset({ selectedAssetIds, onAssetsSelected }) {
  const [searchValue, setSearchValue] = useState('');

  const handleSelectionChanged = (e) => {
    const item = e.itemData;
    if (!item) return;
    if (e.node.selected) {
      const asset = CURRENT_ASSET_MAP[item.id];
      if (asset) onAssetsSelected([...selectedAssetIds.filter(a => a.id !== asset.id), asset]);
    } else {
      onAssetsSelected(selectedAssetIds.filter(a => a.id !== item.id));
    }
  };

  return (
    <div className="step-select-asset">
      <div className="step-data-selection">
        <div className="data-selection-left">
          <p className="step-instructions">Select one or more assets.</p>
          <div className="treeview-container">
            <TreeView
              dataSource={CURRENT_ASSET_DATA}
              dataStructure="plain"
              keyExpr="id"
              parentIdExpr="parentId"
              displayExpr="name"
              itemRender={AssetTreeItemTemplate}
              selectionMode="multiple"
              selectByClick={true}
              selectNodesRecursive={false}
              expandAllEnabled={true}
              defaultExpandAll={true}
              searchEnabled={true}
              searchValue={searchValue}
              onOptionChanged={(e) => {
                if (e.name === 'searchValue') setSearchValue(e.value);
              }}
              selectedItemKeys={selectedAssetIds.map(a => a.id)}
              onItemSelectionChanged={handleSelectionChanged}
            />
          </div>
        </div>
        <div className="data-selection-right">
          <div className="selected-tags-header">
            <p className="panel-label">Selected</p>
            <span className="selected-count">{selectedAssetIds.length}</span>
          </div>
          <div className="selected-tags-list">
            {selectedAssetIds.length === 0 ? (
              <p className="step-instructions">Click an asset in the tree to select it.</p>
            ) : (
              selectedAssetIds.map(asset => {
                const crumbs = getAncestorBreadcrumb(asset.id);
                return (
                  <div key={asset.id} className="selected-tag-item selected-asset-compact">
                    <span className="selected-asset-compact-name">{asset.name}</span>
                    {crumbs.length > 0 && (
                      <span className="selected-asset-compact-crumb">› {crumbs.join(' › ')}</span>
                    )}
                    <span className="tree-item-badge" style={{ flexShrink: 0 }}>{asset.assetType}</span>
                    <button
                      className="selected-tag-remove"
                      onClick={() => onAssetsSelected(selectedAssetIds.filter(a => a.id !== asset.id))}
                      title="Remove"
                    >×</button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepDataSelection({ selectedAssetId, onAssetSelected, selectedAssets, selectedTags, onTagsChanged }) {
  const setSelectedTags = onTagsChanged;
  const [groupBy, setGroupBy] = useState('asset');
  const [viewMode, setViewMode] = useState('tree');
  const [focusedAssetId, setFocusedAssetId] = useState(null);
  const [domainFilter, setDomainFilter] = useState('all');

  const TAG_DOMAINS = useMemo(() => modelTagDomains(), []);

  const toggleTag = (item) => {
    setSelectedTags(prev => {
      const exists = prev.find(t => t.id === item.id);
      if (exists) return prev.filter(t => t.id !== item.id);
      return [...prev, item];
    });
  };

  const treeData = groupBy === 'asset'
    ? buildSelectedAssetTree(selectedAssets || [])
    : CURRENT_ASSET_DATA;

  // Unique types from selected assets
  const uniqueTypes = [...new Set((selectedAssets || []).map(a => a.assetType))].sort();
  const [focusedType, setFocusedType] = useState(null);

  const focusedAsset = focusedAssetId ? CURRENT_ASSET_MAP[focusedAssetId] : null;

  // In type mode, the selected assets of the focused type
  const focusedTypeAssets = focusedType
    ? (selectedAssets || []).filter(a => a.assetType === focusedType)
    : [];

  // Tags shown in center depend on mode
  const allFocusedTags = groupBy === 'type'
    ? tagsForAssets(focusedTypeAssets)
    : (focusedAsset ? tagsForAsset(focusedAsset.id) : []);
  const focusedTags = domainFilter === 'all'
    ? allFocusedTags
    : allFocusedTags.filter(t => t.tagDomain === domainFilter);

  // In type mode, a tag is "selected" if ALL matching assets have that tag selected
  const isTagSelectedForType = (tagName) =>
    focusedTypeAssets.length > 0 &&
    focusedTypeAssets.every(a => !!selectedTags.find(t => t.id === `${a.id}__tag__${tagName}`));

  const toggleTagForType = (tag) => {
    const allSelected = isTagSelectedForType(tag.tagName);
    setSelectedTags(prev => {
      let result = [...prev];
      focusedTypeAssets.forEach(asset => {
        const tagId = `${asset.id}__tag__${tag.tagName}`;
        if (allSelected) {
          result = result.filter(t => t.id !== tagId);
        } else {
          if (!result.find(t => t.id === tagId)) {
            result.push({
              id: tagId,
              name: tag.label,
              tagDomain: tag.tagDomain,
              nodeType: 'tag',
            });
          }
        }
      });
      return result;
    });
  };

  const centerIsFocused = groupBy === 'type' ? !!focusedType : !!focusedAsset;

  const assetItemRender = (item) => (
    <div className={`tree-item tree-item--asset${item.isPlaceholder ? ' tree-item--placeholder' : ''}`}>
      <span className="tree-item-name">{item.name}</span>
      <span className={`tree-item-badge${item.isPlaceholder ? ' tree-item-badge--placeholder' : ''}`}>
        {item.assetType}
      </span>
    </div>
  );

  return (
    <div className="step-data-selection">

      {/* Left: asset tree */}
      <div className="data-selection-left">
        <div className="step2-toolbar">
          <SelectBox
            dataSource={[
              { value: 'asset', label: 'Asset' },
              { value: 'type', label: 'Type' },
            ]}
            displayExpr="label"
            valueExpr="value"
            value={groupBy}
            onValueChanged={(e) => setGroupBy(e.value)}
            width={140}
            stylingMode="outlined"
          />
          {groupBy === 'asset' && (
            <SelectBox
              dataSource={[
                { value: 'tree', label: 'Tree' },
                { value: 'flat', label: 'Flat' },
              ]}
              displayExpr="label"
              valueExpr="value"
              value={viewMode}
              onValueChanged={(e) => setViewMode(e.value)}
              width={120}
              stylingMode="outlined"
            />
          )}
        </div>
        {groupBy === 'asset' && viewMode === 'flat' ? (
          <div className="selected-tags-list">
            {(selectedAssets || []).length === 0 ? (
              <p className="step-instructions">No assets selected on the previous step.</p>
            ) : (
              (selectedAssets || []).map(asset => {
                const crumbs = getAncestorBreadcrumb(asset.id);
                const isActive = focusedAssetId === asset.id;
                return (
                  <div
                    key={asset.id}
                    className={`selected-tag-item selected-asset-item${isActive ? ' center-tag-item--selected' : ''}`}
                    onClick={() => setFocusedAssetId(asset.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="selected-asset-info">
                      <span className="selected-tag-name">{asset.name}</span>
                      {crumbs.length > 0 && (
                        <span className="selected-asset-breadcrumb">{crumbs.join(' › ')}</span>
                      )}
                    </div>
                    <span className="tree-item-badge">{asset.assetType}</span>
                  </div>
                );
              })
            )}
          </div>
        ) : groupBy === 'type' ? (
          <div className="selected-tags-list">
            {uniqueTypes.length === 0 ? (
              <p className="step-instructions">No assets selected on the previous step.</p>
            ) : (
              uniqueTypes.map(type => {
                const isActive = focusedType === type;
                return (
                  <div
                    key={type}
                    className={`selected-tag-item${isActive ? ' center-tag-item--selected' : ''}`}
                    onClick={() => setFocusedType(type)}
                    style={{ cursor: 'pointer' }}
                  >
                    <span className="selected-tag-name">{type}</span>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="treeview-container">
            <TreeView
              dataSource={treeData}
              dataStructure="plain"
              keyExpr="id"
              parentIdExpr="parentId"
              displayExpr="name"
              itemRender={assetItemRender}
              selectionMode="single"
              selectByClick={true}
              expandAllEnabled={true}
              defaultExpandAll={true}
              selectedItemKeys={focusedAssetId ? [focusedAssetId] : []}
              onItemSelectionChanged={(e) => {
                const selected = e.component.getSelectedNodes();
                const id = selected.length > 0 ? selected[0].key : null;
                const asset = id ? CURRENT_ASSET_MAP[id] : null;
                if (asset && !asset.isPlaceholder) setFocusedAssetId(id);
              }}
            />
          </div>
        )}
      </div>

      {/* Center: properties for focused asset or type */}
      <div className="data-selection-center">
        <div className="step2-toolbar">
          <SelectBox
            dataSource={TAG_DOMAINS}
            value={domainFilter}
            onValueChanged={(e) => setDomainFilter(e.value)}
            width={200}
            stylingMode="outlined"
            disabled={!centerIsFocused}
          />
        </div>
        {centerIsFocused ? (
          <div className="selected-tags-list">
            {focusedTags.map(tag => {
              const isSelected = groupBy === 'type'
                ? isTagSelectedForType(tag.tagName)
                : !!selectedTags.find(t => t.id === `${focusedAssetId}__tag__${tag.tagName}`);

              const handleClick = groupBy === 'type'
                ? () => toggleTagForType(tag)
                : () => toggleTag({
                    id: `${focusedAssetId}__tag__${tag.tagName}`,
                    name: tag.label,
                    tagDomain: tag.tagDomain,
                    nodeType: 'tag',
                  });

              return (
                <div
                  key={tag.tagName}
                  className={`selected-tag-item center-tag-item${isSelected ? ' center-tag-item--selected' : ''}`}
                  onClick={handleClick}
                >
                  <input
                    type="checkbox"
                    className="tree-item-checkbox"
                    checked={isSelected}
                    onChange={() => {}}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="selected-tag-name">{tag.label}</span>
                  <span className="tree-item-badge tree-item-badge--tag">{tag.tagDomain.toLowerCase()}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="step-instructions">
            {groupBy === 'type'
              ? 'Click a type in the list to view its properties.'
              : 'Click an asset in the tree to view its properties.'}
          </p>
        )}
      </div>

      {/* Right: selected tags */}
      <div className="data-selection-right">
        <div className="selected-tags-header">
          <p className="panel-label">Selected</p>
          <span className="selected-count">{selectedTags.length}</span>
        </div>
        <div className="selected-tags-list">
          {selectedTags.length === 0 ? (
            <p className="step-instructions">Check a tag in the tree to select it.</p>
          ) : (
            selectedTags.map(tag => {
              const assetId = tag.id.split('__tag__')[0];
              const crumbs = getAncestorBreadcrumb(assetId);
              const asset = CURRENT_ASSET_MAP[assetId];
              const fullCrumbs = asset ? [...crumbs, asset.name] : crumbs;
              return (
                <div key={tag.id} className="selected-tag-item selected-asset-item">
                  <div className="selected-asset-info">
                    <span className="selected-tag-name">{tag.name}</span>
                    {fullCrumbs.length > 0 && (
                      <span className="selected-asset-breadcrumb">{fullCrumbs.join(' › ')}</span>
                    )}
                  </div>
                  <span className="tree-item-badge tree-item-badge--tag">{tag.tagDomain.toLowerCase()}</span>
                  <button
                    className="selected-tag-remove"
                    onClick={() => setSelectedTags(prev => prev.filter(t => t.id !== tag.id))}
                    title="Remove"
                  >×</button>
                </div>
              );
            })
          )}
        </div>
      </div>

    </div>
  );
}

function StepGrouping({ selectedTags, selectedAssets }) {
  const [groupMode, setGroupMode] = useState('asset');
  const [customGroups, setCustomGroups] = useState([]);
  const [draggedTag, setDraggedTag] = useState(null);
  const [newGroupName, setNewGroupName] = useState('');

  // --- Asset mode: group tags by their asset ---
  const groupsByAsset = useMemo(() => {
    const map = {};
    selectedTags.forEach(tag => {
      const assetId = tag.id.split('__tag__')[0];
      const asset = CURRENT_ASSET_MAP[assetId];
      if (!asset) return;
      if (!map[assetId]) map[assetId] = { asset, tags: [] };
      map[assetId].tags.push(tag);
    });
    return Object.values(map);
  }, [selectedTags]);

  // --- Category mode: group tags by tagDomain ---
  const groupsByCategory = useMemo(() => {
    const map = {};
    selectedTags.forEach(tag => {
      const domain = tag.tagDomain || 'uncategorized';
      if (!map[domain]) map[domain] = [];
      map[domain].push(tag);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [selectedTags]);

  // --- Custom mode helpers ---
  const assignedTagIds = new Set(customGroups.flatMap(g => g.tagIds));
  const unassignedTags = selectedTags.filter(t => !assignedTagIds.has(t.id));

  const addGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    setCustomGroups(prev => [...prev, { id: Date.now(), name, tagIds: [] }]);
    setNewGroupName('');
  };

  const removeGroup = (groupId) => {
    setCustomGroups(prev => prev.filter(g => g.id !== groupId));
  };

  const handleDragStart = (tag) => setDraggedTag(tag);
  const handleDragEnd = () => setDraggedTag(null);

  const handleDropOnGroup = (groupId) => {
    if (!draggedTag) return;
    setCustomGroups(prev => prev.map(g => {
      // Remove from any existing group first
      const withoutTag = { ...g, tagIds: g.tagIds.filter(id => id !== draggedTag.id) };
      if (withoutTag.id === groupId) {
        return { ...withoutTag, tagIds: [...withoutTag.tagIds, draggedTag.id] };
      }
      return withoutTag;
    }));
    setDraggedTag(null);
  };

  const handleDropOnUnassigned = () => {
    if (!draggedTag) return;
    setCustomGroups(prev => prev.map(g => ({
      ...g, tagIds: g.tagIds.filter(id => id !== draggedTag.id),
    })));
    setDraggedTag(null);
  };

  const getTagById = (id) => selectedTags.find(t => t.id === id);

  const renderTagPill = (tag, draggable = false) => {
    const assetId = tag.id.split('__tag__')[0];
    const asset = CURRENT_ASSET_MAP[assetId];
    return (
      <div
        key={tag.id}
        className="grouping-tag-pill"
        draggable={draggable}
        onDragStart={draggable ? () => handleDragStart(tag) : undefined}
        onDragEnd={draggable ? handleDragEnd : undefined}
      >
        <span className="grouping-tag-name">{tag.name}</span>
        {asset && <span className="grouping-tag-asset">{asset.name}</span>}
      </div>
    );
  };

  const renderGroupCard = (title, tags, groupId = null) => (
    <div
      key={title}
      className="grouping-card"
      onDragOver={groupId !== null ? (e) => e.preventDefault() : undefined}
      onDrop={groupId !== null ? () => handleDropOnGroup(groupId) : undefined}
    >
      <div className="grouping-card-header">
        <span className="grouping-card-title">{title}</span>
        <span className="selected-count">{tags.length}</span>
        {groupId !== null && (
          <button className="selected-tag-remove" onClick={() => removeGroup(groupId)} title="Delete group">×</button>
        )}
      </div>
      <div className="grouping-card-body">
        {tags.length === 0
          ? <p className="grouping-empty">Drop properties here</p>
          : tags.map(tag => renderTagPill(tag, groupId !== null))}
      </div>
    </div>
  );

  return (
    <div className="step-grouping">
      {/* Mode toggle */}
      <div className="step2-toolbar" style={{ marginBottom: 12 }}>
        {['asset', 'category', 'custom'].map(mode => (
          <button
            key={mode}
            className={`grouping-mode-btn${groupMode === mode ? ' grouping-mode-btn--active' : ''}`}
            onClick={() => setGroupMode(mode)}
          >
            {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>

      {/* Asset mode */}
      {groupMode === 'asset' && (
        <div className="grouping-grid">
          {groupsByAsset.length === 0
            ? <p className="step-instructions">No properties selected yet.</p>
            : groupsByAsset.map(({ asset, tags }) => {
                const crumbs = getAncestorBreadcrumb(asset.id);
                const title = crumbs.length > 0 ? `${crumbs.join(' › ')} › ${asset.name}` : asset.name;
                return renderGroupCard(title, tags);
              })}
        </div>
      )}

      {/* Category mode */}
      {groupMode === 'category' && (
        <div className="grouping-grid">
          {groupsByCategory.length === 0
            ? <p className="step-instructions">No properties selected yet.</p>
            : groupsByCategory.map(([domain, tags]) => renderGroupCard(domain, tags))}
        </div>
      )}

      {/* Custom mode */}
      {groupMode === 'custom' && (
        <div className="grouping-custom">
          <div className="grouping-custom-left">
            <div className="selected-tags-header">
              <p className="panel-label">Unassigned</p>
              <span className="selected-count">{unassignedTags.length}</span>
            </div>
            <div
              className="grouping-unassigned"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDropOnUnassigned}
            >
              {unassignedTags.length === 0
                ? <p className="grouping-empty">All properties assigned!</p>
                : unassignedTags.map(tag => renderTagPill(tag, true))}
            </div>
          </div>
          <div className="grouping-custom-right">
            <div className="grouping-add-row">
              <input
                className="grouping-name-input"
                placeholder="New group name..."
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addGroup()}
              />
              <button className="grouping-add-btn" onClick={addGroup}>+</button>
            </div>
            <div className="grouping-grid">
              {customGroups.length === 0
                ? <p className="step-instructions">Create a group to get started.</p>
                : customGroups.map(group => {
                    const tags = group.tagIds.map(getTagById).filter(Boolean);
                    return renderGroupCard(group.name, tags, group.id);
                  })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function StepPlaceholder({ step }) {
  return (
    <div className="step-placeholder">
      <p className="step-instructions">{STEPS[step].title} content goes here.</p>
    </div>
  );
}

function WizardContent({ currentStep, selectedAssetIds, onAssetsSelected, selectedTags, onTagsChanged }) {
  return (
    <div className="wizard-content">
      <div className="wizard-progress">
        <span className="wizard-step-label">Step {currentStep + 1} of {STEPS.length}</span>
        <div className="wizard-pips">
          {STEPS.map((_, i) => (
            <div key={i} className={`wizard-pip ${i <= currentStep ? 'active' : ''}`} />
          ))}
        </div>
      </div>
      <h3 className="wizard-title">{STEPS[currentStep].title}</h3>
      {currentStep === 0 && (
        <StepSelectAsset
          selectedAssetIds={selectedAssetIds}
          onAssetsSelected={onAssetsSelected}
        />
      )}
      {currentStep === 1 && (
        <StepDataSelection
          selectedAssetId={selectedAssetIds[0]?.id || null}
          onAssetSelected={(id) => onAssetsSelected(id ? [CURRENT_ASSET_MAP[id]] : [])}
          selectedAssets={selectedAssetIds}
          selectedTags={selectedTags}
          onTagsChanged={onTagsChanged}
        />
      )}
      {currentStep === 2 && (
        <StepGrouping
          selectedTags={selectedTags}
          selectedAssets={selectedAssetIds}
        />
      )}
      {currentStep > 2 && <StepPlaceholder step={currentStep} />}
    </div>
  );
}


export default WizardContent;
export { STEPS };
