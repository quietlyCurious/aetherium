// operator/operatorViews/workItems.js
// Work-item vocabulary and maths shared by the Work list and the task
// detail: priority order, colours and labels, the schedule margin (how
// much slack is left before an item is late) and its formatting, plus the
// group/sort helpers behind the list's controls.

import { WORK_NOW_REFERENCE } from '../../model/modelData';

const WORK_PRIORITY_ORDER = { urgent: 0, important: 1, routine: 2 };

export const WORK_PRIORITY_COLORS = { urgent: '#d64545', important: '#e0a336', routine: '#8c8c8c' };

export const WORK_PRIORITY_LABELS = { urgent: 'Urgent', important: 'Important', routine: 'Routine' };

export const WORK_SOURCE_TYPE_LABELS = { planned: 'Planned', situation: 'Unplanned' };

export function formatCreatedAt(date) {
  if (!date) return null;
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function computeMarginMinutes(item) {
  if (!item.dueAt) return null;
  return Math.round((item.dueAt.getTime() - WORK_NOW_REFERENCE.getTime()) / 60000);
}

export function formatMargin(minutes) {
  if (minutes === null) return null;
  if (minutes < 0) return `Overdue ${Math.abs(minutes)}m`;
  if (minutes === 0) return 'Due now';
  if (minutes < 60) return `Due in ${minutes}m`;
  return `Due in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function marginColor(minutes) {
  if (minutes === null) return '#aaa';
  if (minutes < 0) return '#d64545';
  if (minutes <= 15) return '#e0a336';
  return '#8c8c8c';
}

export const WORK_GROUP_BY_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'sourceType', label: 'Type' },
  { value: 'priority', label: 'Priority' },
];

export const WORK_SORT_BY_OPTIONS = [
  { value: 'margin', label: 'Time margin' },
  { value: 'priority', label: 'Priority' },
];

export function sortWorkItems(items, sortBy) {
  const sorted = [...items];
  sorted.sort((a, b) => {
    // Not-done items always float above done ones, regardless of sort
    // choice — a finished item's time margin isn't a prioritization signal
    // anymore.
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done && b.done) {
      return (b.completedAt ? b.completedAt.getTime() : 0) - (a.completedAt ? a.completedAt.getTime() : 0);
    }
    if (sortBy === 'priority') {
      return WORK_PRIORITY_ORDER[a.priority] - WORK_PRIORITY_ORDER[b.priority];
    }
    const ma = computeMarginMinutes(a);
    const mb = computeMarginMinutes(b);
    if (ma === null && mb === null) return 0;
    if (ma === null) return 1;
    if (mb === null) return -1;
    return ma - mb;
  });
  return sorted;
}

export function groupWorkItems(items, groupBy) {
  if (groupBy === 'none') {
    return [{ key: 'all', label: null, items }];
  }
  const buckets = {};
  items.forEach(item => {
    const key = groupBy === 'priority' ? item.priority : item.sourceType;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(item);
  });
  let keys = Object.keys(buckets);
  if (groupBy === 'priority') {
    keys.sort((a, b) => WORK_PRIORITY_ORDER[a] - WORK_PRIORITY_ORDER[b]);
  } else {
    keys.sort((a, b) => a.localeCompare(b));
  }
  return keys.map(key => ({
    key,
    label: groupBy === 'priority' ? WORK_PRIORITY_LABELS[key] : WORK_SOURCE_TYPE_LABELS[key],
    items: buckets[key],
  }));
}
