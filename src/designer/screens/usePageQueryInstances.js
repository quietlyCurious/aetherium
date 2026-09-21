// designer/screens/usePageQueryInstances.js
// The query instances the Screens editor adds to pages: a page's own
// instances plus app-scoped ones shared by every page. The editing
// counterpart of usePageQueryResults, which runs them.
//
// Instance ids are page-relative (numbering restarts at 1 per page,
// matching OpHub's own flowInstanceId convention), so two pages can both
// have an instance 3. Everything here that looks an instance up by id is
// scoped to the active page (plus app-scoped instances, which belong to no
// single page) — matching by id alone could silently edit, bind or delete
// another page's instance.
//
// Every change is saved to storage straight away, inside the state
// update, so a quick run of calls always saves the final list.

import { useState } from 'react';
import { loadQueryInstances, saveQueryInstances } from '../../queryInstancesStorage';
import { nextInstanceId, DEFAULT_QUERY_INSTANCE, INSTANCE_SCOPES } from '../../dataModel';

const isOnPage = (qi, id, pageId) => qi.id === id && (qi.pageId === pageId || qi.scope === INSTANCE_SCOPES.APP);

export function findQueryInstance(queryInstances, id, activePageId) {
  return queryInstances.find(qi => isOnPage(qi, id, activePageId));
}

export function usePageQueryInstances(activePageId, queries) {
  const [queryInstances, setQueryInstances] = useState(() => loadQueryInstances());

  const change = (update) => setQueryInstances(prev => {
    const next = update(prev);
    saveQueryInstances(next);
    return next;
  });

  // Page-scoped unless instData.scope says app. Page-relative numbering
  // only means something for page-scoped instances; app-scoped ones are
  // numbered among themselves.
  const addQueryInstance = (instData = {}) => {
    const sameScopeInstances = instData.scope === INSTANCE_SCOPES.APP
      ? queryInstances.filter(qi => qi.scope === INSTANCE_SCOPES.APP)
      : queryInstances.filter(qi => qi.pageId === activePageId);
    const inst = {
      ...DEFAULT_QUERY_INSTANCE,
      ...instData,
      id: nextInstanceId(sameScopeInstances),
      pageId: instData.scope === INSTANCE_SCOPES.APP ? null : (instData.pageId ?? activePageId),
    };
    if (!inst.alias && inst.queryId) {
      // Auto-generate alias from query name
      const q = queries.find(q => q.id === inst.queryId);
      if (q) inst.alias = q.name;
    }
    change(prev => [...prev, inst]);
    return inst.id;
  };

  // Not used by any UI yet.
  const updateQueryInstance = (id, updates) => {
    change(prev => prev.map(qi => isOnPage(qi, id, activePageId) ? { ...qi, ...updates } : qi));
  };

  const deleteQueryInstance = (id) => {
    change(prev => prev.filter(qi => !isOnPage(qi, id, activePageId)));
  };

  // Page-scoped → app-scoped (shared by every page), which clears pageId.
  // Only matches the active page's own instances, never an app-scoped one
  // that happens to share the id. Not used by any UI yet.
  const promoteQueryInstance = (id) => {
    change(prev => prev.map(qi =>
      (qi.id === id && qi.pageId === activePageId) ? { ...qi, scope: INSTANCE_SCOPES.APP, pageId: null } : qi
    ));
  };

  // Bindings on an instance's INPUTS — the counterpart of widget property
  // bindings.
  const setInputBinding = (instanceId, fieldName, binding) => {
    change(prev => prev.map(qi =>
      isOnPage(qi, instanceId, activePageId)
        ? { ...qi, bindings: { ...(qi.bindings || {}), [fieldName]: binding } }
        : qi
    ));
  };

  const clearInputBinding = (instanceId, fieldName) => {
    change(prev => prev.map(qi => {
      if (!isOnPage(qi, instanceId, activePageId)) return qi;
      const nb = { ...(qi.bindings || {}) };
      delete nb[fieldName];
      return { ...qi, bindings: nb };
    }));
  };

  // A deleted page's own instances mean nothing any more; app-scoped ones
  // are untouched.
  const deleteInstancesOfPage = (pageId) => {
    change(prev => prev.filter(qi => qi.pageId !== pageId));
  };

  return {
    queryInstances,
    // The active page's own instances — what the Page Data tab lists and
    // what a widget can bind to.
    pageQueryInstances: queryInstances.filter(qi => qi.pageId === activePageId),
    findQueryInstance: (id) => findQueryInstance(queryInstances, id, activePageId),
    addQueryInstance, updateQueryInstance, deleteQueryInstance, promoteQueryInstance,
    setInputBinding, clearInputBinding, deleteInstancesOfPage,
  };
}
