// One classic page -> one new-designer page.
//
// Pass 1 (planCards): walk the classic container tree, decide the cards, and flatten every
//   container into a list of widgets carrying inherited visibility. Records which nested
//   containers disappeared so show/hide actions anywhere on the page can be re-pointed.
// Pass 2 (convertPage): convert each widget, wrap it, and lay the cards out top to bottom.

import { FlowIndex } from './bindings.js';
import { buildConditions, classicConditionList } from './conditions.js';
import { buildCard, buildPageRoot, buildWidget } from './newDesignerShapes.js';
import { OUTCOME, SEVERITY } from './report.js';
import { deepClone, newId } from './util.js';
import { classicTypeName, converterFor, isClassicPlugin, SKIPPED_TYPES } from './widgets/index.js';

const GRID_COLS = 12;          // fixed grid: 12 x 100px columns
const CELL_PX = 100;
const CELL_MARGIN_PX = 15;
const CARD_PADDING_PX = 16;
const FLEX_GAP_PX = 8;
const FLOW_UI_KEYS = ['isOpen', 'editMode', 'index'];

function isContainer(c) { return c?.type === 'container'; }

/** Children of a classic container, across all of its sections, in order. */
function classicChildren(c) {
  const out = [];
  for (const s of c?.layout?.sections || []) for (const x of s.components || []) if (x && typeof x === 'object') out.push(x);
  return out;
}

function isMigratable(c) { return !!converterFor(c); }

/** Flatten a container subtree into widgets with inherited visibility. */
function flattenInto(container, inherited, groupWidgets, skipped, flattenedContainers) {
  for (const child of classicChildren(container)) {
    if (isContainer(child)) {
      const childInherited = {
        hidden: inherited.hidden || !!child.isHidden,
        conditions: [...inherited.conditions, ...classicConditionList(child)],
      };
      const before = groupWidgets.length;
      flattenInto(child, childInherited, groupWidgets, skipped, flattenedContainers);
      flattenedContainers.set(child.id, groupWidgets.slice(before).map((w) => w.classic.id));
    } else if (isMigratable(child)) {
      groupWidgets.push({ classic: child, inherited });
    } else {
      skipped.push(child);
    }
  }
}

/**
 * Decide the cards for a page.
 * @returns {{ groups: Array<{id, source, label, conditions, hidden, widgets, skipped}>, flattenedContainers: Map, unwrapped: number }}
 */
export function planCards(classicRoot) {
  let top = isContainer(classicRoot) ? classicChildren(classicRoot) : [classicRoot];
  // A lone wrapper container around everything carries no grouping information; look inside it.
  let unwrapped = 0;
  while (top.length === 1 && isContainer(top[0]) && !top[0].isHidden && !classicConditionList(top[0]).length) {
    top = classicChildren(top[0]);
    unwrapped += 1;
  }

  const flattenedContainers = new Map();
  const groups = [];
  let loose = null;
  let containerNo = 0;
  for (const item of top) {
    if (isContainer(item)) {
      containerNo += 1;
      const group = {
        id: item.id,
        source: 'container',
        label: item.name ? `Container "${item.name}"` : `Container ${containerNo}`,
        conditions: classicConditionList(item),
        hidden: !!item.isHidden,
        widgets: [],
        skipped: [],
      };
      flattenInto(item, { hidden: false, conditions: [] }, group.widgets, group.skipped, flattenedContainers);
      groups.push(group);
    } else {
      if (!loose) {
        loose = { id: newId(), source: 'loose', label: 'Ungrouped widgets', conditions: [], hidden: false, widgets: [], skipped: [] };
        groups.push(loose);
      }
      if (isMigratable(item)) loose.widgets.push({ classic: item, inherited: { hidden: false, conditions: [] } });
      else loose.skipped.push(item);
    }
  }
  return { groups, flattenedContainers, unwrapped };
}

/** Rows a card needs: simulate flex-wrap lines across the card's inner width. */
function cardRows(sizes, fill) {
  if (fill) return 6;
  const inner = GRID_COLS * CELL_PX + (GRID_COLS - 1) * CELL_MARGIN_PX - 2 * CARD_PADDING_PX;
  let lineW = 0; let lineH = 0; let total = 0;
  for (const s of sizes) {
    const w = Math.min(s.width, inner);
    if (lineW && lineW + FLEX_GAP_PX + w > inner) { total += lineH + FLEX_GAP_PX; lineW = 0; lineH = 0; }
    lineW += (lineW ? FLEX_GAP_PX : 0) + w;
    lineH = Math.max(lineH, s.height);
  }
  total += lineH + 2 * CARD_PADDING_PX;
  return Math.max(1, Math.ceil((total + CELL_MARGIN_PX) / (CELL_PX + CELL_MARGIN_PX)));
}

function cleanFlows(flows) {
  return (flows || []).map((f) => {
    const n = deepClone(f);
    for (const k of FLOW_UI_KEYS) delete n[k];
    return n;
  });
}

/**
 * @param classicPage { components, flows }
 * @param appCtx      { reference, catalog, globals: GlobalIndex, componentGlobalIds }
 * @param pageReport  PageReport
 * @returns {{ components, flows }}
 */
export function convertPage(classicPage, appCtx, pageReport) {
  const flows = cleanFlows(classicPage.flows);
  pageReport.queryCount = flows.length;

  const roots = classicPage.components || [];
  if (roots.length !== 1) pageReport.note(`Expected one root container, found ${roots.length}; all were scanned.`, SEVERITY.WARN);
  const root = roots.length === 1 ? roots[0] : { type: 'container', layout: { sections: [{ components: roots }] } };

  const plan = planCards(root);
  if (plan.unwrapped) pageReport.note(`Looked through ${plan.unwrapped} wrapper container(s) that held the whole page, to find meaningful groups.`);

  const ctx = { ...appCtx, flows: new FlowIndex(flows), flattenedContainers: plan.flattenedContainers };
  const cards = [];
  let y = 0;

  for (const group of plan.groups) {
    const fill = group.widgets.length === 1;
    const widgets = [];
    const sizes = [];

    for (const { classic, inherited } of group.widgets) {
      const conv = converterFor(classic)(classic, ctx);
      const notes = conv.notes || [];
      const conditions = buildConditions(classicConditionList(classic), inherited.conditions, notes);
      if (classic.conditions && classic.conditions.showOnlyOnCondition === false && classicConditionList(classic).length) {
        notes.push({ severity: SEVERITY.WARN, text: 'Classic "hide when conditions match" mode; the new designer shows only when conditions match. Invert the conditions.' });
      }
      const isHidden = !!classic.isHidden || inherited.hidden;
      if (inherited.hidden && !classic.isHidden) notes.push({ severity: SEVERITY.INFO, text: 'Starts hidden because its enclosing container started hidden.' });

      widgets.push(buildWidget({
        id: classic.id || newId(),
        typeName: conv.typeName,
        pluginInfo: conv.pluginInfo || ctx.catalog.pluginInfo(conv.typeName),
        data: conv.data,
        size: conv.size,
        fill,
        isHidden,
        conditions,
        multiActions: conv.multiActions,
        scopedCss: conv.scopedCss,
      }));
      sizes.push(conv.size);

      pageReport.addWidget({
        id: classic.id,
        sourceType: classicTypeName(classic),
        targetType: conv.typeName,
        outcome: isClassicPlugin(classic) ? OUTCOME.COPIED : OUTCOME.MAPPED,
        label: conv.label || '',
        cardLabel: group.label,
        notes,
      });
    }

    for (const s of group.skipped) {
      pageReport.addWidget({
        id: s.id,
        sourceType: classicTypeName(s),
        targetType: '',
        outcome: OUTCOME.SKIPPED,
        label: '',
        cardLabel: group.label,
        notes: [{ severity: SEVERITY.INFO, text: SKIPPED_TYPES[s.type] || `Classic "${s.type}" has no new-designer equivalent.` }],
      });
    }

    if (!widgets.length) {
      if (group.source === 'container') pageReport.note(`${group.label} held nothing migratable; no card created for it.`);
      continue;
    }

    const rows = cardRows(sizes, fill);
    const cardNotes = [];
    const cardConditions = buildConditions(group.conditions, [], cardNotes);
    cards.push(buildCard(appCtx.reference, {
      id: group.id, x: 0, y, cols: GRID_COLS, rows, widgets, conditions: cardConditions, isHidden: group.hidden, wrap: !fill,
    }));
    pageReport.addCard({ id: group.id, label: group.label, source: group.source, widgetCount: widgets.length });
    if (group.conditions.length) pageReport.note(`${group.label}: visibility conditions moved to its card.`);
    y += rows;
  }

  if (!cards.length) {
    const hadContent = plan.groups.some((g) => g.widgets.length || g.skipped.length);
    pageReport.note(hadContent ? 'No migratable widgets on this page; it will be empty.' : 'This page was already empty in the classic app.', hadContent ? SEVERITY.WARN : SEVERITY.INFO);
  }
  return { components: [buildPageRoot(appCtx.reference, cards, { cols: GRID_COLS, rows: Math.max(y, 5) })], flows };
}
