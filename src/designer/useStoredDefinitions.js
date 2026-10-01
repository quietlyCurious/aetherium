// designer/useStoredDefinitions.js
// A list of saved definitions held in state and written to storage on every
// change: add, update (shallow merge) and remove. App.js holds its
// definition lists this way so every area that reads them (the definition
// areas, and Screens) sees the same list.
//
// Asset sets and connections use it (App.js wraps a connection's delete to
// refuse one that pages use).
//
//   const assetSets = useStoredDefinitions({ load, save, makeNew });
//   assetSets.items; assetSets.add(extra) → id; assetSets.update(id, changes); assetSets.remove(id)

import { useCallback, useState } from 'react';

export function useStoredDefinitions({ load, save, makeNew }) {
  const [items, setItems] = useState(() => load());

  const commit = useCallback((change) => {
    setItems(prev => {
      const next = change(prev);
      save(next);
      return next;
    });
  }, [save]);

  const add = useCallback((extra = {}) => {
    const item = makeNew(extra);
    commit(prev => [...prev, item]);
    return item.id;
  }, [commit, makeNew]);

  const update = useCallback((id, changes) => {
    commit(prev => prev.map(item => (item.id === id ? { ...item, ...changes } : item)));
  }, [commit]);

  const remove = useCallback((id) => {
    commit(prev => prev.filter(item => item.id !== id));
  }, [commit]);

  return { items, add, update, remove };
}
