// shell/areaIcons.jsx
// Rail icons for the Configuration Experience's page-builder and data
// areas. Same 16px, 1.4-stroke line style as the Operator's rail icons
// (operator/icons.jsx), which Visualization uses.

const Svg = ({ children }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const ScreensRailIcon = () => (
  <Svg><rect x="1.5" y="2.5" width="13" height="9" rx="1" /><path d="M5.5 14h5M8 11.5V14" /><path d="M1.5 5.5h13" /></Svg>
);

export const WidgetsRailIcon = () => (
  <Svg><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="2.5" /><rect x="2" y="9" width="5" height="5" rx="1" /><path d="M9 11.5h5M11.5 9v5" /></Svg>
);

export const ThemeRailIcon = () => (
  <Svg>
    <path d="M8 1.8a6.2 6.2 0 1 0 0 12.4c.9 0 1.3-.6 1.3-1.2 0-.9-.8-1.1-.8-1.9 0-.7.6-1.2 1.3-1.2h1.5c1.8 0 2.9-1.3 2.9-3C14.2 4.1 11.4 1.8 8 1.8z" />
    <circle cx="4.9" cy="7.2" r=".8" /><circle cx="7.2" cy="4.6" r=".8" /><circle cx="10.4" cy="5" r=".8" />
  </Svg>
);

export const DataSourcesRailIcon = () => (
  <Svg><ellipse cx="8" cy="3.5" rx="5.5" ry="2" /><path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9" /><path d="M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" /></Svg>
);

export const EntitiesRailIcon = () => (
  <Svg><rect x="1.8" y="2.5" width="12.4" height="11" rx="1" /><path d="M1.8 6h12.4M1.8 9.5h12.4M6 6v7.5" /></Svg>
);

export const QueriesRailIcon = () => (
  <Svg><path d="M9 1.5 3.5 9h4l-1 5.5L12.5 7h-4z" /></Svg>
);

export const AssetSetsRailIcon = () => (
  <Svg><rect x="1.8" y="1.8" width="5" height="5" rx="1" /><rect x="9.2" y="1.8" width="5" height="5" rx="1" /><rect x="1.8" y="9.2" width="5" height="5" rx="1" /><path d="M9.8 11.7l1.4 1.4 2.8-3" /></Svg>
);

export const ScriptsRailIcon = () => (
  <Svg><path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3 7 13" /></Svg>
);
