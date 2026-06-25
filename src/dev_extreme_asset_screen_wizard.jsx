import React, { useMemo, useState } from "react";

const assetModel = [
  {
    id: "refinery-aurelia",
    name: "Refinery Aurelia",
    type: "Refinery",
    description: "Luminara-aligned refinery focused on purity, stability, and precision.",
    children: [
      {
        id: "aurelia-line-1",
        name: "Aurelia Line 1",
        type: "Line",
        description: "Precision crystal refinement line.",
        children: [
          { id: "aurelia-line-1-intake", name: "Intake", type: "Station" },
          { id: "aurelia-line-1-stabilization", name: "Stabilization", type: "Station" },
          { id: "aurelia-line-1-refinement", name: "Refinement", type: "Station" },
          { id: "aurelia-line-1-inspection", name: "Inspection", type: "Station" },
          { id: "aurelia-line-1-buffer", name: "Buffer", type: "Station" },
          { id: "aurelia-line-1-output", name: "Output", type: "Station" },
        ],
      },
      {
        id: "aurelia-line-2",
        name: "Aurelia Line 2",
        type: "Line",
        description: "Secondary precision refinement line.",
        children: [
          { id: "aurelia-line-2-intake", name: "Intake", type: "Station" },
          { id: "aurelia-line-2-stabilization", name: "Stabilization", type: "Station" },
          { id: "aurelia-line-2-refinement", name: "Refinement", type: "Station" },
          { id: "aurelia-line-2-inspection", name: "Inspection", type: "Station" },
          { id: "aurelia-line-2-buffer", name: "Buffer", type: "Station" },
          { id: "aurelia-line-2-output", name: "Output", type: "Station" },
        ],
      },
    ],
  },
  {
    id: "refinery-ferrum",
    name: "Refinery Ferrum",
    type: "Refinery",
    description: "Ironwind-aligned refinery focused on throughput, scale, and power output.",
    children: [
      {
        id: "ferrum-line-1",
        name: "Ferrum Line 1",
        type: "Line",
        description: "High-throughput crystal production line.",
        children: [
          { id: "ferrum-line-1-bulk-intake", name: "Bulk Intake", type: "Station" },
          { id: "ferrum-line-1-power-charge", name: "Power Charge", type: "Station" },
          { id: "ferrum-line-1-shaping", name: "Shaping", type: "Station" },
          { id: "ferrum-line-1-transfer", name: "Transfer", type: "Station" },
          { id: "ferrum-line-1-output", name: "Output", type: "Station" },
        ],
      },
      {
        id: "ferrum-line-2",
        name: "Ferrum Line 2",
        type: "Line",
        description: "Secondary high-throughput production line.",
        children: [
          { id: "ferrum-line-2-bulk-intake", name: "Bulk Intake", type: "Station" },
          { id: "ferrum-line-2-power-charge", name: "Power Charge", type: "Station" },
          { id: "ferrum-line-2-shaping", name: "Shaping", type: "Station" },
          { id: "ferrum-line-2-transfer", name: "Transfer", type: "Station" },
          { id: "ferrum-line-2-output", name: "Output", type: "Station" },
        ],
      },
    ],
  },
];

const tagDefinitionsByAssetType = {
  Refinery: [
    { id: "throughput", name: "Throughput", category: "Production", tagPath: "Production.Throughput" },
    { id: "oee", name: "OEE", category: "Derived Metrics", tagPath: "Performance.OEE" },
    { id: "energy-output", name: "Energy Output", category: "Production", tagPath: "Production.EnergyOutput" },
    { id: "quality-index", name: "Quality Index", category: "Quality", tagPath: "Quality.Index" },
    { id: "stability-index", name: "Stability Index", category: "Stability", tagPath: "Stability.Index" },
    { id: "risk-score", name: "Risk Score", category: "Risk / Delivery", tagPath: "Risk.Score" },
  ],
  Line: [
    { id: "line-rate", name: "Line Rate", category: "Production", tagPath: "Production.LineRate" },
    { id: "wip", name: "WIP", category: "Flow / WIP", tagPath: "Flow.WIP" },
    { id: "blocked-time", name: "Blocked Time", category: "Events / Losses", tagPath: "Losses.BlockedTime" },
    { id: "starved-time", name: "Starved Time", category: "Events / Losses", tagPath: "Losses.StarvedTime" },
    { id: "line-efficiency", name: "Line Efficiency", category: "Derived Metrics", tagPath: "Performance.LineEfficiency" },
    { id: "bottleneck-score", name: "Bottleneck Score", category: "Diagnostics", tagPath: "Diagnostics.BottleneckScore" },
  ],
  Station: [
    { id: "current-rate", name: "Current Rate", category: "Production", tagPath: "Production.CurrentRate" },
    { id: "status", name: "Status", category: "Operations / Control", tagPath: "Operations.Status" },
    { id: "scrap-rate", name: "Scrap Rate", category: "Quality", tagPath: "Quality.ScrapRate" },
    { id: "microstop-count", name: "Microstop Count", category: "Events / Losses", tagPath: "Losses.MicrostopCount" },
    { id: "buffer-level", name: "Buffer Level", category: "Flow / WIP", tagPath: "Flow.BufferLevel" },
    { id: "instability-score", name: "Instability Score", category: "Stability", tagPath: "Stability.InstabilityScore" },
  ],
};

const tagCategories = [
  "Production",
  "Quality",
  "Stability",
  "Flow / WIP",
  "Events / Losses",
  "Operations / Control",
  "Derived Metrics",
  "Diagnostics",
  "Risk / Delivery",
];

const categoryColors = {
  Production: {
    background: "#eff6ff",
    border: "#93c5fd",
    text: "#1d4ed8",
    selectedBackground: "#2563eb",
  },
  Quality: {
    background: "#f0fdf4",
    border: "#86efac",
    text: "#166534",
    selectedBackground: "#16a34a",
  },
  Stability: {
    background: "#faf5ff",
    border: "#c084fc",
    text: "#7e22ce",
    selectedBackground: "#9333ea",
  },
  "Flow / WIP": {
    background: "#ecfeff",
    border: "#67e8f9",
    text: "#0e7490",
    selectedBackground: "#0891b2",
  },
  "Events / Losses": {
    background: "#fff7ed",
    border: "#fdba74",
    text: "#c2410c",
    selectedBackground: "#ea580c",
  },
  "Operations / Control": {
    background: "#f8fafc",
    border: "#94a3b8",
    text: "#334155",
    selectedBackground: "#475569",
  },
  "Derived Metrics": {
    background: "#fdf4ff",
    border: "#f0abfc",
    text: "#a21caf",
    selectedBackground: "#c026d3",
  },
  Diagnostics: {
    background: "#fefce8",
    border: "#fde047",
    text: "#854d0e",
    selectedBackground: "#ca8a04",
  },
  "Risk / Delivery": {
    background: "#fef2f2",
    border: "#fca5a5",
    text: "#b91c1c",
    selectedBackground: "#dc2626",
  },
};

function getCategoryStyle(category, isSelected = false) {
  const colors = categoryColors[category] || {
    background: "#f8fafc",
    border: "#cbd5e1",
    text: "#334155",
    selectedBackground: "#337ab7",
  };

  return {
    "--category-background": isSelected ? colors.selectedBackground : colors.background,
    "--category-border": colors.border,
    "--category-text": isSelected ? "#ffffff" : colors.text,
    "--category-hover-background": colors.background,
  };
}

const wizardSteps = [
  {
    title: "Step 1",
    heading: "Select asset scope",
    description:
      "Choose the refinery, line, or station that should anchor the data experience.",
  },
  {
    title: "Step 2",
    heading: "Choose available data",
    description:
      "Select data categories to quickly choose matching tags, or manually select individual tags in the hierarchy.",
  },
  {
    title: "Step 3",
    heading: "Choose data intent",
    description:
      "Later, this step can ask whether the user wants to monitor health, diagnose problems, compare assets, or investigate quality.",
  },
  {
    title: "Step 4",
    heading: "Review and finish",
    description:
      "Later, this step can summarize the selected asset and data signals before generating the screen.",
  },
];

function findAssetById(assets, id) {
  for (const asset of assets) {
    if (asset.id === id) return asset;

    if (asset.children) {
      const match = findAssetById(asset.children, id);
      if (match) return match;
    }
  }

  return null;
}

function getAssetIcon(type) {
  switch (type) {
    case "Refinery":
      return "◆";
    case "Line":
      return "▰";
    case "Station":
      return "●";
    case "Tag":
      return "◇";
    default:
      return "•";
  }
}

function getTagNodesForAsset(asset) {
  if (!asset) return [];

  const tagDefinitions = tagDefinitionsByAssetType[asset.type] || [];

  return tagDefinitions.map((tag) => ({
    id: `${asset.id}::tag::${tag.id}`,
    name: tag.name,
    type: "Tag",
    tagPath: `${asset.name}.${tag.tagPath}`,
    category: tag.category,
    sourceAssetId: asset.id,
    sourceAssetName: asset.name,
    sourceAssetType: asset.type,
  }));
}

function buildAssetDataTree(asset) {
  if (!asset) return null;

  return {
    ...asset,
    children: [
      ...getTagNodesForAsset(asset),
      ...(asset.children?.map(buildAssetDataTree) || []),
    ],
  };
}

function collectTagDetails(node, results = []) {
  if (!node) return results;

  if (node.type === "Tag") {
    results.push(node);
  }

  node.children?.forEach((child) => collectTagDetails(child, results));
  return results;
}

function collectSelectedTagDetails(node, selectedTagIds, results = []) {
  if (!node) return results;

  if (node.type === "Tag" && selectedTagIds.includes(node.id)) {
    results.push(node);
  }

  node.children?.forEach((child) => collectSelectedTagDetails(child, selectedTagIds, results));
  return results;
}

function countSelectedTags(selectedTagIds) {
  return selectedTagIds.length;
}

function DxLikeButton({
  text,
  type = "normal",
  stylingMode = "contained",
  disabled = false,
  onClick,
}) {
  const className = [
    "dx-like-button",
    type === "default" ? "dx-like-button-default" : "",
    stylingMode === "outlined" ? "dx-like-button-outlined" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={className} disabled={disabled} onClick={onClick}>
      {text}
    </button>
  );
}

function DxLikePopup({
  visible,
  title,
  width = 640,
  showCloseButton = true,
  onHiding,
  children,
}) {
  if (!visible) return null;

  return (
    <div className="dx-like-overlay" role="presentation">
      <section
        className="dx-like-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-popup-title"
        style={{ maxWidth: width }}
      >
        <header className="dx-like-popup-titlebar">
          <h1 id="wizard-popup-title">{title}</h1>

          {showCloseButton && (
            <button
              className="dx-like-close-button"
              aria-label="Close wizard"
              onClick={onHiding}
            >
              ×
            </button>
          )}
        </header>

        <div className="dx-like-popup-content">{children}</div>
      </section>
    </div>
  );
}

function DxLikeTagBox({ categories, selectedCategories, onChange }) {
  function toggleCategory(category) {
    if (selectedCategories.includes(category)) {
      onChange(selectedCategories.filter((selectedCategory) => selectedCategory !== category));
      return;
    }

    onChange([...selectedCategories, category]);
  }

  function clearCategories() {
    onChange([]);
  }

  return (
    <div className="dx-like-tagbox-shell">
      <div className="dx-like-tagbox-label-row">
        <label className="dx-like-tagbox-label">Auto-select by category</label>
        {selectedCategories.length > 0 && (
          <button className="dx-like-tagbox-clear" onClick={clearCategories}>
            Clear
          </button>
        )}
      </div>

      <div className="dx-like-tagbox">
        {categories.map((category) => {
          const isSelected = selectedCategories.includes(category);

          return (
            <button
              key={category}
              className={["dx-like-tagbox-item", isSelected ? "selected" : ""]
                .filter(Boolean)
                .join(" ")}
              style={getCategoryStyle(category, isSelected)}
              onClick={() => toggleCategory(category)}
            >
              {category}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AssetTreeNode({ asset, level = 0, selectedAssetId, onSelectAsset }) {
  const [isExpanded, setIsExpanded] = useState(level < 1);
  const hasChildren = Boolean(asset.children?.length);
  const isSelected = selectedAssetId === asset.id;

  function toggleExpanded(event) {
    event.stopPropagation();
    if (hasChildren) {
      setIsExpanded((previous) => !previous);
    }
  }

  return (
    <div className="asset-tree-node">
      <button
        className={["asset-tree-row", isSelected ? "selected" : ""]
          .filter(Boolean)
          .join(" ")}
        style={{ paddingLeft: 10 + level * 22 }}
        onClick={() => onSelectAsset(asset.id)}
      >
        <span
          className={["asset-expand-control", hasChildren ? "visible" : ""]
            .filter(Boolean)
            .join(" ")}
          onClick={toggleExpanded}
          aria-hidden="true"
        >
          {hasChildren ? (isExpanded ? "▾" : "▸") : ""}
        </span>
        <span className="asset-type-icon">{getAssetIcon(asset.type)}</span>
        <span className="asset-tree-main-text">{asset.name}</span>
        <span className="asset-type-chip">{asset.type}</span>
      </button>

      {hasChildren && isExpanded && (
        <div className="asset-tree-children">
          {asset.children.map((child) => (
            <AssetTreeNode
              key={child.id}
              asset={child}
              level={level + 1}
              selectedAssetId={selectedAssetId}
              onSelectAsset={onSelectAsset}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DataTreeNode({ node, level = 0, selectedTagIds, onToggleTag }) {
  const [isExpanded, setIsExpanded] = useState(level < 2);
  const hasChildren = Boolean(node.children?.length);
  const isTag = node.type === "Tag";
  const isChecked = selectedTagIds.includes(node.id);

  function toggleExpanded(event) {
    event.stopPropagation();
    if (hasChildren) {
      setIsExpanded((previous) => !previous);
    }
  }

  function handleRowClick() {
    if (isTag) {
      onToggleTag(node.id);
      return;
    }

    if (hasChildren) {
      setIsExpanded((previous) => !previous);
    }
  }

  return (
    <div className="asset-tree-node">
      <button
        className={["asset-tree-row", isTag && isChecked ? "selected" : "", isTag ? "tag-row" : ""]
          .filter(Boolean)
          .join(" ")}
        style={{ paddingLeft: 10 + level * 22 }}
        onClick={handleRowClick}
      >
        <span
          className={["asset-expand-control", hasChildren ? "visible" : ""]
            .filter(Boolean)
            .join(" ")}
          onClick={toggleExpanded}
          aria-hidden="true"
        >
          {hasChildren ? (isExpanded ? "▾" : "▸") : ""}
        </span>

        {isTag ? (
          <input
            className="tag-checkbox"
            type="checkbox"
            checked={isChecked}
            onChange={() => onToggleTag(node.id)}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Select ${node.name}`}
          />
        ) : (
          <span className="asset-type-icon">{getAssetIcon(node.type)}</span>
        )}

        <span className="asset-tree-main-text">{node.name}</span>

        {isTag ? (
          <span className="asset-tag-path">{node.category}</span>
        ) : (
          <span className="asset-type-chip">{node.type}</span>
        )}
      </button>

      {hasChildren && isExpanded && (
        <div className="asset-tree-children">
          {node.children.map((child) => (
            <DataTreeNode
              key={child.id}
              node={child}
              level={level + 1}
              selectedTagIds={selectedTagIds}
              onToggleTag={onToggleTag}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AssetTreeView({
  assets,
  selectedAssetId,
  onSelectAsset,
  title = "Asset Model",
  subtitle = "Refinery → Line → Station",
}) {
  return (
    <div className="asset-tree-card">
      <div className="asset-tree-card-header">
        <div>
          <div className="asset-tree-card-title">{title}</div>
          <div className="asset-tree-card-subtitle">{subtitle}</div>
        </div>
      </div>

      <div className="asset-tree-list" role="tree" aria-label="Asset model hierarchy">
        {assets.map((asset) => (
          <AssetTreeNode
            key={asset.id}
            asset={asset}
            selectedAssetId={selectedAssetId}
            onSelectAsset={onSelectAsset}
          />
        ))}
      </div>
    </div>
  );
}

function SelectedAssetSummary({ selectedAsset }) {
  if (!selectedAsset) {
    return (
      <div className="selected-asset-panel empty">
        <div className="selected-asset-kicker">No asset selected</div>
        <h3>Select an asset to continue</h3>
        <p>
          Start by choosing a refinery, line, or station from the hierarchy. The next steps will use this selection to show relevant data.
        </p>
      </div>
    );
  }

  return (
    <div className="selected-asset-panel">
      <div className="selected-asset-kicker">Selected Asset</div>
      <h3>{selectedAsset.name}</h3>
      <div className="selected-asset-details">
        <span>{getAssetIcon(selectedAsset.type)}</span>
        <span>{selectedAsset.type}</span>
      </div>
      <p>
        {selectedAsset.description ||
          "This asset will be used as the context for choosing available signals, KPIs, and data-driven screen content."}
      </p>
    </div>
  );
}

function SelectedAssetTreeView({
  selectedAsset,
  selectedTagIds,
  selectedCategories,
  onToggleTag,
  onChangeCategories,
}) {
  if (!selectedAsset) {
    return (
      <div className="wizard-placeholder-card">
        <div className="wizard-placeholder-kicker">No asset selected</div>
        <h3>Select an asset first</h3>
        <p>
          Go back to Step 1 and choose a refinery, line, or station before choosing available data.
        </p>
      </div>
    );
  }

  const rootedAssetDataTree = buildAssetDataTree(selectedAsset);
  const selectedTagDetails = collectSelectedTagDetails(rootedAssetDataTree, selectedTagIds);

  return (
    <div className="selected-data-layout">
      <div className="asset-tree-card">
        <div className="asset-tree-card-header">
          <div>
            <div className="asset-tree-card-title">Selected Asset Data</div>
            <div className="asset-tree-card-subtitle">Asset hierarchy with available tags/properties</div>
          </div>
          <div className="selected-count-badge">
            {countSelectedTags(selectedTagIds)} selected
          </div>
        </div>

        <div className="data-selection-tools">
          <DxLikeTagBox
            categories={tagCategories}
            selectedCategories={selectedCategories}
            onChange={onChangeCategories}
          />
        </div>

        <div className="asset-tree-list data-tree-list" role="tree" aria-label="Available tags and properties">
          <DataTreeNode
            node={rootedAssetDataTree}
            selectedTagIds={selectedTagIds}
            onToggleTag={onToggleTag}
          />
        </div>
      </div>

      <div className="selected-asset-panel">
        <div className="selected-asset-kicker">Selected data</div>
        <h3>{selectedTagDetails.length ? `${selectedTagDetails.length} signals selected` : "No signals selected"}</h3>

        {selectedCategories.length > 0 && (
          <div className="selected-category-summary">
            {selectedCategories.map((category) => (
              <span key={category} style={getCategoryStyle(category, false)}>{category}</span>
            ))}
          </div>
        )}

        {selectedTagDetails.length ? (
          <ul className="selected-tag-name-list">
            {selectedTagDetails.map((tag) => (
              <li key={tag.id} style={getCategoryStyle(tag.category, false)}>
                {tag.name}
              </li>
            ))}
          </ul>
        ) : (
          <p>
            Choose one or more categories above the tree, or manually select individual properties and tags below.
          </p>
        )}
      </div>
    </div>
  );
}

function StepContent({
  currentStepIndex,
  selectedAssetId,
  onSelectAsset,
  selectedTagIds,
  selectedCategories,
  onToggleTag,
  onChangeCategories,
}) {
  const selectedAsset = findAssetById(assetModel, selectedAssetId);

  if (currentStepIndex === 0) {
    return (
      <div className="asset-selection-layout">
        <AssetTreeView
          assets={assetModel}
          selectedAssetId={selectedAssetId}
          onSelectAsset={onSelectAsset}
        />
        <SelectedAssetSummary selectedAsset={selectedAsset} />
      </div>
    );
  }

  if (currentStepIndex === 1) {
    return (
      <SelectedAssetTreeView
        selectedAsset={selectedAsset}
        selectedTagIds={selectedTagIds}
        selectedCategories={selectedCategories}
        onToggleTag={onToggleTag}
        onChangeCategories={onChangeCategories}
      />
    );
  }

  if (currentStepIndex === 3) {
    return (
      <div className="wizard-placeholder-card">
        <div className="wizard-placeholder-kicker">Current selection</div>
        <h3>{selectedAsset ? selectedAsset.name : "No asset selected yet"}</h3>
        <p>
          {selectedAsset
            ? `${selectedAsset.name} is selected as the asset context for this data-centric screen. You have selected ${selectedTagIds.length} data signal${selectedTagIds.length === 1 ? "" : "s"}.`
            : "Go back to Step 1 to select an asset scope before finishing."}
        </p>
      </div>
    );
  }

  return (
    <div className="wizard-placeholder-card">
      <p>{wizardSteps[currentStepIndex].description}</p>
    </div>
  );
}

export default function DevExtremeAssetScreenWizard() {
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [selectedAssetId, setSelectedAssetId] = useState("refinery-aurelia");
  const [selectedTagIds, setSelectedTagIds] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);

  const currentStep = wizardSteps[currentStepIndex];
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === wizardSteps.length - 1;

  const selectedAsset = findAssetById(assetModel, selectedAssetId);
  const rootedAssetDataTree = buildAssetDataTree(selectedAsset);
  const availableTagsForSelectedAsset = collectTagDetails(rootedAssetDataTree);

  const progressLabel = useMemo(() => {
    return `Step ${currentStepIndex + 1} of ${wizardSteps.length}`;
  }, [currentStepIndex]);

  function openWizard() {
    setCurrentStepIndex(0);
    setIsWizardOpen(true);
  }

  function closeWizard() {
    setIsWizardOpen(false);
  }

  function selectAsset(assetId) {
    setSelectedAssetId(assetId);
    setSelectedTagIds([]);
    setSelectedCategories([]);
  }

  function toggleSelectedTag(tagId) {
    setSelectedTagIds((previousSelectedTagIds) => {
      if (previousSelectedTagIds.includes(tagId)) {
        return previousSelectedTagIds.filter((selectedTagId) => selectedTagId !== tagId);
      }

      return [...previousSelectedTagIds, tagId];
    });
  }

  function changeSelectedCategories(nextSelectedCategories) {
    setSelectedCategories(nextSelectedCategories);

    const nextSelectedTagIds = availableTagsForSelectedAsset
      .filter((tag) => nextSelectedCategories.includes(tag.category))
      .map((tag) => tag.id);

    setSelectedTagIds(nextSelectedTagIds);
  }

  function goBack() {
    setCurrentStepIndex((previousStepIndex) =>
      Math.max(previousStepIndex - 1, 0)
    );
  }

  function goNextOrExit() {
    if (isLastStep) {
      closeWizard();
      return;
    }

    setCurrentStepIndex((previousStepIndex) =>
      Math.min(previousStepIndex + 1, wizardSteps.length - 1)
    );
  }

  return (
    <div className="app-shell">
      <DxLikeButton
        text="Create Screen"
        type="default"
        stylingMode="contained"
        onClick={openWizard}
      />

      <DxLikePopup
        visible={isWizardOpen}
        onHiding={closeWizard}
        showCloseButton={true}
        title="Create a New Screen"
        width={900}
      >
        <div className="wizard-content">
          <div className="wizard-progress-header">
            <div className="wizard-progress-label">{progressLabel}</div>

            <div className="wizard-step-indicator" aria-label={progressLabel}>
              {wizardSteps.map((step, index) => {
                const isActive = index === currentStepIndex;
                const isComplete = index < currentStepIndex;

                return (
                  <div
                    key={step.title}
                    className={[
                      "wizard-step-pill",
                      isActive ? "active" : "",
                      isComplete ? "complete" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    title={step.title}
                  />
                );
              })}
            </div>
          </div>

          <div className="wizard-body">
            <div className="wizard-step-title">{currentStep.title}</div>
            <h2>{currentStep.heading}</h2>
            <p className="wizard-step-description">{currentStep.description}</p>

            <StepContent
              currentStepIndex={currentStepIndex}
              selectedAssetId={selectedAssetId}
              onSelectAsset={selectAsset}
              selectedTagIds={selectedTagIds}
              selectedCategories={selectedCategories}
              onToggleTag={toggleSelectedTag}
              onChangeCategories={changeSelectedCategories}
            />
          </div>

          <div className="wizard-footer">
            <DxLikeButton
              text="Back"
              stylingMode="outlined"
              disabled={isFirstStep}
              onClick={goBack}
            />

            <DxLikeButton
              text={isLastStep ? "Exit" : "Next"}
              type="default"
              stylingMode="contained"
              onClick={goNextOrExit}
            />
          </div>
        </div>
      </DxLikePopup>

      <style>{`
        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
        }

        .app-shell {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f4f6f8;
          color: #1f2937;
          font-family: Arial, Helvetica, sans-serif;
        }

        .dx-like-button {
          min-width: 88px;
          min-height: 36px;
          padding: 8px 16px;
          border: 1px solid #cfd7e2;
          border-radius: 4px;
          background: #ffffff;
          color: #1f2937;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: background 120ms ease, border-color 120ms ease, opacity 120ms ease;
        }

        .dx-like-button:hover:not(:disabled) {
          background: #f2f5f9;
        }

        .dx-like-button:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .dx-like-button-default {
          border-color: #337ab7;
          background: #337ab7;
          color: #ffffff;
        }

        .dx-like-button-default:hover:not(:disabled) {
          background: #2d6da3;
          border-color: #2d6da3;
        }

        .dx-like-button-outlined {
          background: #ffffff;
          color: #374151;
        }

        .dx-like-overlay {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: rgba(17, 24, 39, 0.45);
          z-index: 1000;
        }

        .dx-like-popup {
          width: 100%;
          background: #ffffff;
          border: 1px solid #d8dee8;
          border-radius: 4px;
          box-shadow: 0 18px 45px rgba(15, 23, 42, 0.28);
          overflow: hidden;
        }

        .dx-like-popup-titlebar {
          min-height: 48px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 12px 16px;
          border-bottom: 1px solid #e2e8f0;
          background: #ffffff;
        }

        .dx-like-popup-titlebar h1 {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
          color: #1f2937;
        }

        .dx-like-close-button {
          width: 32px;
          height: 32px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: none;
          border-radius: 4px;
          background: transparent;
          color: #6b7280;
          font-size: 24px;
          line-height: 1;
          cursor: pointer;
        }

        .dx-like-close-button:hover {
          background: #f3f4f6;
          color: #1f2937;
        }

        .dx-like-popup-content {
          background: #ffffff;
        }

        .wizard-content {
          padding: 20px 24px 24px;
        }

        .wizard-progress-header {
          padding-bottom: 18px;
          border-bottom: 1px solid #e5e7eb;
        }

        .wizard-progress-label {
          margin-bottom: 10px;
          font-size: 13px;
          color: #5f6b7a;
          font-weight: 600;
        }

        .wizard-step-indicator {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
        }

        .wizard-step-pill {
          height: 8px;
          border-radius: 999px;
          background: #dbe1ea;
        }

        .wizard-step-pill.complete {
          background: #9ec5fe;
        }

        .wizard-step-pill.active {
          background: #337ab7;
        }

        .wizard-body {
          min-height: 420px;
          padding: 28px 0;
        }

        .wizard-step-title {
          margin-bottom: 8px;
          font-size: 13px;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          font-weight: 700;
        }

        .wizard-body h2 {
          margin: 0 0 10px;
          font-size: 24px;
          font-weight: 650;
          color: #1f2937;
        }

        .wizard-step-description {
          max-width: 690px;
          margin: 0 0 18px;
          line-height: 1.55;
          color: #4b5563;
        }

        .wizard-footer {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          padding-top: 18px;
          border-top: 1px solid #e5e7eb;
        }

        .asset-selection-layout,
        .selected-data-layout {
          display: grid;
          grid-template-columns: minmax(400px, 1.3fr) minmax(250px, 0.7fr);
          gap: 16px;
          align-items: stretch;
        }

        .asset-tree-card,
        .selected-asset-panel,
        .wizard-placeholder-card {
          border: 1px solid #dbe3ee;
          border-radius: 4px;
          background: #ffffff;
        }

        .asset-tree-card {
          overflow: hidden;
        }

        .asset-tree-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          border-bottom: 1px solid #e5e7eb;
          background: #f8fafc;
        }

        .asset-tree-card-title {
          font-size: 14px;
          font-weight: 700;
          color: #1f2937;
        }

        .asset-tree-card-subtitle {
          margin-top: 2px;
          font-size: 12px;
          color: #6b7280;
        }

        .data-selection-tools {
          padding: 12px 14px;
          border-bottom: 1px solid #e5e7eb;
          background: #ffffff;
        }

        .dx-like-tagbox-shell {
          display: grid;
          gap: 7px;
        }

        .dx-like-tagbox-label-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .dx-like-tagbox-label {
          color: #4b5563;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .dx-like-tagbox-clear {
          border: none;
          background: transparent;
          color: #337ab7;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
        }

        .dx-like-tagbox {
          min-height: 38px;
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 7px;
          padding: 6px;
          border: 1px solid #cfd7e2;
          border-radius: 4px;
          background: #ffffff;
        }

        .dx-like-tagbox-item {
          padding: 5px 9px;
          border: 1px solid var(--category-border);
          border-radius: 999px;
          background: var(--category-background);
          color: var(--category-text);
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
        }

        .dx-like-tagbox-item:hover {
          filter: brightness(0.97);
        }

        .dx-like-tagbox-item.selected {
          border-color: var(--category-background);
          background: var(--category-background);
          color: var(--category-text);
        }

        .asset-tree-list {
          max-height: 300px;
          overflow: auto;
          padding: 6px;
        }

        .asset-tree-row {
          width: 100%;
          min-height: 34px;
          display: flex;
          align-items: center;
          gap: 8px;
          border: 1px solid transparent;
          border-radius: 4px;
          background: transparent;
          color: #1f2937;
          font-size: 13px;
          text-align: left;
          cursor: pointer;
        }

        .asset-tree-row:hover {
          background: #f3f6fa;
        }

        .asset-tree-row.selected {
          border-color: #8db8df;
          background: #eaf3fb;
        }

        .asset-tree-row.tag-row {
          min-height: 32px;
        }

        .tag-checkbox {
          width: 15px;
          height: 15px;
          margin: 0;
          accent-color: #337ab7;
          cursor: pointer;
        }

        .asset-tag-path {
          max-width: 140px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #6b7280;
          font-size: 11px;
          font-weight: 600;
        }

        .data-tree-list {
          max-height: 300px;
        }

        .selected-count-badge {
          padding: 4px 9px;
          border: 1px solid #bfd7ef;
          border-radius: 999px;
          background: #eaf3fb;
          color: #2d6da3;
          font-size: 12px;
          font-weight: 700;
        }

        .selected-category-summary {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 12px;
        }

        .selected-category-summary span {
          padding: 4px 7px;
          border: 1px solid var(--category-border);
          border-radius: 999px;
          background: var(--category-background);
          color: var(--category-text);
          font-size: 11px;
          font-weight: 700;
        }

        .selected-tag-name-list {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
          max-height: 270px;
          overflow: auto;
          margin: 0;
          padding: 0;
          list-style: none;
          font-size: 13px;
          line-height: 1.35;
        }

        .selected-tag-name-list li {
          padding: 5px 9px;
          border: 1px solid var(--category-border);
          border-radius: 999px;
          background: var(--category-background);
          color: var(--category-text);
          font-size: 12px;
          font-weight: 700;
        }

        .asset-expand-control {
          width: 14px;
          color: #5f6b7a;
          font-size: 13px;
        }

        .asset-expand-control.visible {
          cursor: pointer;
        }

        .asset-type-icon {
          width: 16px;
          color: #337ab7;
          font-size: 12px;
          text-align: center;
        }

        .asset-tree-main-text {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 600;
        }

        .asset-type-chip {
          padding: 2px 7px;
          border: 1px solid #d6dee9;
          border-radius: 999px;
          background: #ffffff;
          color: #526071;
          font-size: 11px;
          font-weight: 600;
        }

        .selected-asset-panel,
        .wizard-placeholder-card {
          padding: 18px;
        }

        .selected-asset-panel.empty {
          background: #fbfcfe;
        }

        .selected-asset-kicker,
        .wizard-placeholder-kicker {
          margin-bottom: 8px;
          color: #6b7280;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .selected-asset-panel h3,
        .wizard-placeholder-card h3 {
          margin: 0 0 10px;
          font-size: 19px;
          color: #1f2937;
        }

        .selected-asset-details {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
          padding: 5px 9px;
          border: 1px solid #dbe3ee;
          border-radius: 999px;
          background: #f8fafc;
          color: #405268;
          font-size: 13px;
          font-weight: 600;
        }

        .selected-asset-panel p,
        .wizard-placeholder-card p {
          margin: 0;
          color: #4b5563;
          line-height: 1.5;
        }
      `}</style>
    </div>
  );
}
