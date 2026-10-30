// styles/useAppStyle.js
// The current app style and a setter that switches both layers live:
// the chrome tokens (an attribute on <html>) and the DevExtreme theme
// (themes.current swaps its stylesheet; refreshTheme redraws charts and
// gauges, which bake theme colors in when they render).
import { useCallback, useState } from 'react';
import themes from 'devextreme/ui/themes';
import { refreshTheme } from 'devextreme/viz/themes';
import { applyAppStyleTokens, findAppStyle, loadStoredAppStyle, storeAppStyle } from './appStyle';

export function useAppStyle() {
  const [appStyle, setAppStyleState] = useState(loadStoredAppStyle);

  const setAppStyle = useCallback(id => {
    const style = findAppStyle(id);
    setAppStyleState(style.id);
    storeAppStyle(style.id);
    applyAppStyleTokens(style.id);
    themes.current({ theme: style.dxTheme, loadCallback: () => refreshTheme() });
  }, []);

  return [appStyle, setAppStyle];
}
