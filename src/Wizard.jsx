import React, { useState, useMemo } from 'react';
import { Button, SelectBox, Splitter, TabPanel } from 'devextreme-react';
import { Item as SplitterItem } from 'devextreme-react/splitter';
import { Item as TabPanelItem } from 'devextreme-react/tab-panel';
import { TreeView } from 'devextreme-react';
import { ASSET_DATA, TAGS_BY_LEVEL, ASSET_MAP, buildDescendantTree, buildSelectedAssetTree } from './assetData';
import HierarchyTree from './HierarchyTree';

const STEPS = [
  { title: 'Select Asset' },
  { title: 'Step 2: Data Selection' },
  { title: 'Step 3: Placeholder' },
  { title: 'Step 4: Placeholder' },
];



function WidgetTreeItemTemplate(item, onDblClick) {
  const isWidget = item.assetLevel === 'widget';
  return (
    <div
      className={`tree-item${isWidget ? ' tree-item--widget' : ''}`}
      draggable={isWidget}
      onDoubleClick={isWidget && onDblClick ? (e) => { e.stopPropagation(); onDblClick(item); } : undefined}
      onDragStart={isWidget ? (e) => {
        e.dataTransfer.setData('dx-widget-name', item.name);
        e.dataTransfer.setData('dx-widget-id', item.id);
        e.dataTransfer.effectAllowed = 'copy';
      } : undefined}
    >
      <span className="tree-item-name">{item.name}</span>
    </div>
  );
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
  let current = ASSET_MAP[assetId];
  // Walk up but exclude the asset itself — we want the path to the parent
  current = current?.parentId ? ASSET_MAP[current.parentId] : null;
  while (current) {
    crumbs.unshift(current.name);
    current = current.parentId ? ASSET_MAP[current.parentId] : null;
  }
  return crumbs;
}

function StepSelectAsset({ selectedAssetIds, onAssetsSelected }) {
  const [searchValue, setSearchValue] = useState('');

  const handleSelectionChanged = (e) => {
    const item = e.itemData;
    if (!item) return;
    if (e.node.selected) {
      const asset = ASSET_MAP[item.id];
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
              dataSource={ASSET_DATA}
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

  const TAG_DOMAINS = [
    'all',
    'common',
    'production',
    'derived metrics',
    'operations / control',
    'flow / wip',
    'quality',
    'events / losses',
    'stability',
    'risk / delivery',
    'diagnostics / accuracy',
  ];

  const toggleTag = (item) => {
    setSelectedTags(prev => {
      const exists = prev.find(t => t.id === item.id);
      if (exists) return prev.filter(t => t.id !== item.id);
      return [...prev, item];
    });
  };

  const treeData = groupBy === 'asset'
    ? buildSelectedAssetTree(selectedAssets || [])
    : ASSET_DATA;

  // Unique types from selected assets
  const uniqueTypes = [...new Set((selectedAssets || []).map(a => a.assetType))].sort();
  const [focusedType, setFocusedType] = useState(null);

  const focusedAsset = focusedAssetId ? ASSET_MAP[focusedAssetId] : null;

  // In type mode, derive the asset level from any asset matching the focused type
  const focusedTypeAssets = focusedType
    ? (selectedAssets || []).filter(a => a.assetType === focusedType)
    : [];
  const focusedTypeLevel = focusedTypeAssets.length > 0 ? focusedTypeAssets[0].assetLevel : null;

  // Tags shown in center depend on mode
  const centerAssetLevel = groupBy === 'type' ? focusedTypeLevel : focusedAsset?.assetLevel;
  const allFocusedTags = centerAssetLevel ? (TAGS_BY_LEVEL[centerAssetLevel] || []) : [];
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
              name: tag.tagName,
              tagDomain: tag.tagDomain,
              tagCategory: tag.tagCategory,
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
                const asset = id ? ASSET_MAP[id] : null;
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
                    name: tag.tagName,
                    tagDomain: tag.tagDomain,
                    tagCategory: tag.tagCategory,
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
                  <span className="selected-tag-name">{tag.tagName}</span>
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
              const asset = ASSET_MAP[assetId];
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
      const asset = ASSET_MAP[assetId];
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
    const asset = ASSET_MAP[assetId];
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
          onAssetSelected={(id) => onAssetsSelected(id ? [ASSET_MAP[id]] : [])}
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
