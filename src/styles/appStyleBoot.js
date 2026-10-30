// styles/appStyleBoot.js
// Imported first in index.js, for its side effect only: applies the stored
// app style and declares the DevExtreme theme links before DevExtreme's
// theme module loads (it reads them the moment it's imported).
import { bootAppStyle } from './appStyle';
import './appStyleTokens.css';

bootAppStyle();
