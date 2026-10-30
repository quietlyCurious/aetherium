// styles/AppStyleSwitcher.jsx
// The title bar's Style menu: switches the whole app between the styles in
// appStyles.json. The choice is remembered per browser.
import React from 'react';
import { TitlebarMenu } from '../shell/TitlebarMenu';
import { APP_STYLES, findAppStyle } from './appStyle';
import { useAppStyle } from './useAppStyle';

export function AppStyleSwitcher() {
  const [appStyle, setAppStyle] = useAppStyle();
  return (
    <TitlebarMenu
      label={findAppStyle(appStyle).label}
      title="Switch the app's style"
      items={APP_STYLES}
      activeId={appStyle}
      onSelect={setAppStyle}
      align="right"
    />
  );
}
