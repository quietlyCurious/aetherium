// model/useLoadedModel.js
// Makes a model the active one, for whichever area needs it: the Operator
// Experience and Visualization (OperatorWorkspace), and the Screens area
// (its Data tab's Model view and the Create wizard). Lived inside
// OperatorWorkspace until Screens needed the loaded model too.
//
// Fetches the model's files (listed by modelRegistry.js) and hands them to
// activateLoadedModel, which fills the module-level variables in
// modelData.js. Only one model is ever active — the one the title-bar
// switcher picked — so a model that's already active isn't fetched again:
// moving between Screens and the Operator on the same model is instant.
//
//   const { loaded, error, modelId } = useLoadedModel(selectedModel);
//
// `loaded` is true once `selectedModel` is the active model. `modelId` is
// the model that's loaded (null until then) — use it as a React key or a
// memo dependency, since nothing subscribes to modelData itself.

import { useEffect, useState } from 'react';
import { loadModelRegistry, getModelDataFiles } from './modelRegistry';
import { activateLoadedModel, CURRENT_MODEL } from './modelData';

// Fetches every file a model lists. An optional file that's missing (or,
// from a dev server, answered with index.html) comes back as null.
function fetchModelFiles(files) {
  return Promise.all(
    files.map(([, url, optional]) =>
      fetch(url).then(r => {
        if (!r.ok) {
          if (optional) return null;
          throw new Error(`${url} — ${r.status}`);
        }
        return optional ? r.json().catch(() => null) : r.json();
      }, err => {
        if (optional) return null;
        throw err;
      })
    )
  );
}

function stateFor(modelId) {
  return CURRENT_MODEL === modelId
    ? { loaded: true, error: null, modelId }
    : { loaded: false, error: null, modelId: null };
}

export function useLoadedModel(selectedModel) {
  const [state, setState] = useState(() => stateFor(selectedModel));

  useEffect(() => {
    if (CURRENT_MODEL === selectedModel) {
      setState(prev => (prev.loaded && prev.modelId === selectedModel ? prev : stateFor(selectedModel)));
      return undefined;
    }
    let cancelled = false;
    setState({ loaded: false, error: null, modelId: null });
    let model = null;
    let files = [];
    loadModelRegistry()
      .then(models => {
        model = models.find(m => m.id === selectedModel);
        if (!model) throw new Error(`model "${selectedModel}" is not listed in /data/models.json`);
        files = getModelDataFiles(model);
        return fetchModelFiles(files);
      })
      .then(results => {
        // A newer switch has taken over: don't make this model active.
        if (cancelled) return;
        activateLoadedModel(model, files, results);
        setState({ loaded: true, error: null, modelId: selectedModel });
      })
      .catch(err => {
        if (!cancelled) setState({ loaded: false, error: err.message, modelId: null });
      });
    return () => { cancelled = true; };
  }, [selectedModel]);

  // The state can lag the prop by one render after a switch; never report
  // the previous model as loaded for the new one.
  return state.modelId === selectedModel || !state.loaded ? state : { loaded: false, error: null, modelId: null };
}
